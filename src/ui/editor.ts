/** 标签编辑模式:圆点长在标签上(永不分离);仅支持 新建/改名/删除 标签 */
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { ManualState } from '../scene/manual';
import type { CampusData } from '../data/loader';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class LabelEditor {
  active = false;
  /** 标签覆盖变化后由 main 重建标签层,并回调 attachDots 重新挂编辑圆点 */
  onLabelOverridesChange?: () => void;
  setCampus(id: string): void {
    this.campusId = id;
    this.select(null);
    this.rebuildMarkerLayer();
    if (this.active) this.attachDots();
  }

  private campusId = 'yibin'; // 导出文件名用
  private selectedId: string | null = null; // 'label:<osmId>' | 'marker:<id>'
  private markerLayer = new THREE.Group(); // 仅放新增的标注(圆点+文字一体,可拖)
  private dragging: string | null = null;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private panel: HTMLElement;
  private inputs: Record<string, HTMLInputElement> = {};

  constructor(
    private getManual: () => ManualState,
    private getData: () => CampusData,
    private getLabels: () => THREE.Group | null,
    private camera: THREE.PerspectiveCamera,
    private controls: OrbitControls,
  ) {
    this.panel = document.getElementById('editor-panel')!;
    this.bindPanel();
    this.bindDrag();
  }

  /** 给每条建筑标签元素插入编辑圆点(圆点属于标签元素,相对关系固定) */
  attachDots(): void {
    if (!this.active) return;
    const group = this.getLabels();
    if (!group) return;
    group.traverse((o) => {
      if (!(o instanceof CSS2DObject) || !o.element || o.element.querySelector('.ed-dot')) return;
      const labelId = o.userData.labelId as string | undefined;
      if (!labelId) return; // 非建筑标签(如水域)不挂
      const dot = document.createElement('span');
      dot.className = 'ed-dot';
      if (this.selectedId === `label:${labelId}`) dot.classList.add('selected');
      dot.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this.select(`label:${labelId}`);
      });
      o.element.insertBefore(dot, o.element.firstChild);
    });
  }

  toggle(): void {
    this.active = !this.active;
    this.panel.classList.toggle('hidden', !this.active);
    this.markerLayer.visible = this.active;
    if (this.active) {
      this.attachDots();
      this.select(null);
    } else {
      this.detachDots();
      this.select(null);
    }
  }

  private detachDots(): void {
    const group = this.getLabels();
    group?.traverse((o) => {
      if (o instanceof CSS2DObject && o.element) {
        o.element.querySelectorAll('.ed-dot').forEach((d) => d.remove());
      }
    });
  }

  select(id: string | null): void {
    this.selectedId = id;
    // 高亮:建筑标签圆点
    this.getLabels()?.traverse((o) => {
      if (o instanceof CSS2DObject && o.element) {
        o.element.querySelector('.ed-dot')?.classList.toggle('selected', this.selectedId === `label:${o.userData.labelId}`);
      }
    });
    // 标注高亮
    this.markerLayer.children.forEach((o) => {
      if (o instanceof CSS2DObject) o.element.classList.toggle('selected', this.selectedId === `marker:${(o.userData as { markerId?: string }).markerId}`);
    });
    this.fillInspector();
  }

  private findMarker(id: string) {
    return (this.getManual().markers ?? []).find((m) => m.id === id);
  }

  private fillInspector(): void {
    const nameInput = this.inputs['name'];
    const delBtn = document.getElementById('ed-delete')!;
    if (!this.selectedId) {
      this.panel.querySelector('#ed-name')!.textContent = '(未选中)';
      nameInput.value = '';
      nameInput.parentElement?.classList.add('hidden');
      delBtn.classList.add('hidden');
      return;
    }
    nameInput.parentElement?.classList.remove('hidden');
    delBtn.classList.remove('hidden');
    if (this.selectedId.startsWith('label:')) {
      const osmId = this.selectedId.slice(6);
      const f = this.getData().buildings.find((x) => x.properties.osm_id === osmId);
      const ov = this.getManual().labelOverrides?.[osmId] ?? {};
      this.panel.querySelector('#ed-name')!.textContent = f?.properties.name || osmId;
      nameInput.value = ov.name ?? f?.properties.name ?? '';
      delBtn.textContent = '删除该标签';
    } else {
      const marker = this.findMarker(this.selectedId.slice(7));
      this.panel.querySelector('#ed-name')!.textContent = '标注';
      nameInput.value = marker?.name ?? '';
      delBtn.textContent = '删除该标注';
    }
  }

  private applyRename(value: string): void {
    if (!this.selectedId || !value.trim()) return;
    if (this.selectedId.startsWith('label:')) {
      const osmId = this.selectedId.slice(6);
      const state = this.getManual();
      state.labelOverrides = state.labelOverrides ?? {};
      (state.labelOverrides[osmId] ??= {}).name = value;
      this.onLabelOverridesChange?.();
      this.attachDots();
    } else {
      const marker = this.findMarker(this.selectedId.slice(7));
      if (marker) {
        marker.name = value;
        const obj = this.markerLayer.children.find(
          (o) => o instanceof CSS2DObject && (o.userData as { markerId?: string }).markerId === this.selectedId!.slice(7),
        );
        if (obj) {
          const el = (obj as CSS2DObject).element;
          const textNode = [...el.childNodes].find((n) => n.nodeType === 3); // TEXT_NODE
          if (textNode) textNode.textContent = value;
        }
      }
    }
    this.fillInspector();
  }

  private deleteSelected(): void {
    if (!this.selectedId) return;
    if (this.selectedId.startsWith('label:')) {
      const osmId = this.selectedId.slice(6);
      const state = this.getManual();
      state.labelOverrides = state.labelOverrides ?? {};
      (state.labelOverrides[osmId] ??= {}).hidden = true;
      this.onLabelOverridesChange?.();
      this.attachDots();
    } else {
      const markerId = this.selectedId.slice(7);
      const state = this.getManual();
      state.markers = (state.markers ?? []).filter((m) => m.id !== markerId);
      const obj = this.markerLayer.children.find(
        (o) => o instanceof CSS2DObject && (o.userData as { markerId?: string }).markerId === markerId,
      );
      if (obj) {
        const css = obj as CSS2DObject;
        if (css.element.parentElement) css.element.parentElement.removeChild(css.element);
        this.markerLayer.remove(css);
      }
    }
    this.select(null);
  }

  private addMarker(): void {
    const state = this.getManual();
    state.markers = state.markers ?? [];
    let i = 1;
    while (state.markers.some((m) => m.id === `marker-${i}`)) i++;
    const id = `marker-${i}`;
    const target = this.controls.target;
    state.markers.push({ id, name: `标注${i}`, x: Math.round(target.x), z: Math.round(target.z) });
    const obj = this.makeMarker(state.markers[state.markers.length - 1]);
    this.markerLayer.add(obj);
    this.select(`marker:${id}`);
  }

  private makeMarker(m: { id: string; name: string; x: number; z: number }): CSS2DObject {
    const el = document.createElement('div');
    el.className = 'map-label map-label-marker';
    const dot = document.createElement('span');
    dot.className = 'marker-dot';
    el.appendChild(dot);
    el.appendChild(document.createTextNode(m.name));
    const obj = new CSS2DObject(el);
    obj.position.set(m.x, 8, m.z);
    obj.userData.markerId = m.id;
    this.bindMarkerDrag(obj);
    return obj;
  }

  private bindPanel(): void {
    const nameInput = document.getElementById('ed-name-input') as HTMLInputElement;
    this.inputs['name'] = nameInput;
    nameInput.addEventListener('change', () => this.applyRename(nameInput.value));
    document.getElementById('ed-delete')!.addEventListener('click', () => this.deleteSelected());
    document.getElementById('ed-add-marker')!.addEventListener('click', () => this.addMarker());
    document.getElementById('ed-close')!.addEventListener('click', () => this.setActive(false));
    // 隐藏与标签编辑无关的控件
    for (const id of ['ed-rot', 'ed-x', 'ed-z']) {
      const wrap = document.getElementById(`ed-${id}`)?.parentElement;
      if (wrap) wrap.classList.add('hidden');
    }
    document.getElementById('ed-extra')?.classList.add('hidden');
    for (const id of ['ed-add-gate', 'ed-add-court', 'ed-add-hall']) {
      document.getElementById(id)?.classList.add('hidden');
    }
    document.getElementById('ed-export')!.addEventListener('click', () => {
      const json = JSON.stringify(this.getManual(), null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `manual-${this.campusId}.json`;
      a.click();
      navigator.clipboard?.writeText(json).catch(() => {});
      const btn = document.getElementById('ed-export')!;
      btn.textContent = '已下载并复制 ✓';
      setTimeout(() => (btn.textContent = '导出 manual.json(复制+下载)'), 2000);
    });
  }

  setActive(active: boolean): void {
    this.active = active;
    this.panel.classList.toggle('hidden', !active);
    this.markerLayer.visible = active;
    if (active) {
      this.attachDots();
      this.select(null);
    } else {
      this.detachDots();
      this.select(null);
    }
  }

  private bindMarkerDrag(obj: CSS2DObject): void {
    obj.element.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.select(`marker:${(obj.userData as { markerId?: string }).markerId}`);
      this.dragging = (obj.userData as { markerId?: string }).markerId!;
      this.controls.enabled = false;
    });
  }

  private bindDrag(): void {
    // 仅新增的标注可拖拽定位(圆点+文字一体移动)
    this.markerLayer.children.forEach(() => {});
    const findMarkerObj = (markerId: string) =>
      this.markerLayer.children.find(
        (o) => o instanceof CSS2DObject && (o.userData as { markerId?: string }).markerId === markerId,
      ) as CSS2DObject | undefined;

    window.addEventListener('pointermove', (e) => {
      if (!this.active || !this.dragging) return;
      this.pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const hit = new THREE.Vector3();
      if (!this.raycaster.ray.intersectPlane(this.groundPlane, hit)) return;
      const marker = this.findMarker(this.dragging);
      const obj = findMarkerObj(this.dragging);
      if (!marker || !obj) return;
      marker.x = Math.round(hit.x);
      marker.z = Math.round(hit.z);
      obj.position.set(marker.x, 8, marker.z);
    });
    window.addEventListener('pointerup', () => {
      if (this.dragging) {
        this.dragging = null;
        this.controls.enabled = true;
      }
    });
  }

  /** 按当前校区状态重建标注层 */
  rebuildMarkerLayer(): void {
    for (const o of [...this.markerLayer.children]) {
      if (o instanceof CSS2DObject && o.element.parentElement) o.element.parentElement.removeChild(o.element);
      this.markerLayer.remove(o);
    }
    for (const m of this.getManual().markers ?? []) {
      const obj = this.makeMarker(m);
      this.markerLayer.add(obj);
    }
  }

  get markerLayerGroup(): THREE.Group {
    return this.markerLayer;
  }

  get state(): ManualState {
    return this.getManual();
  }
}
