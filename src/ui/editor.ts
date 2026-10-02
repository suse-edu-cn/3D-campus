/** 场景编辑模式:手工设施 + 建筑标签 的选中/拖拽/改名/增删/导出 */
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { ManualFeatures, type ManualState, type LabelOverride } from '../scene/manual';
import type { CampusData } from '../data/loader';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const TARGETS: { key: keyof ManualState; label: string; prefix: string; defaults: Record<string, unknown> }[] = [
  { key: 'gates', label: '校门', prefix: 'gate', defaults: { rot: 0 } },
  { key: 'pitches', label: '网球场', prefix: 'court', defaults: { kind: 'tennis', cols: 1, rows: 1, bw: 37, bd: 20, w: 36, d: 19.5, rot: 0 } },
  { key: 'buildings', label: '场馆建筑', prefix: 'hall', defaults: { kind: 'gym', w: 90, d: 50, rot: 0, height: 15, levels: 2 } },
  { key: 'markers', label: '标注', prefix: 'marker', defaults: {} },
];

export class ManualEditor {
  active = false;
  /** 标签覆盖变化后由 main 重建标签层 */
  onLabelOverridesChange?: () => void;
  setMetaProvider(fn: () => { center: { lat: number; lon: number } }): void {
    this.getMeta = fn;
  }
  private getMeta?: () => { center: { lat: number; lon: number } };

  private campusId = 'yibin';
  private markerLayer = new THREE.Group();
  private markers = new Map<string, CSS2DObject>();
  private selectedId: string | null = null;
  private draggingId: string | null = null;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private inputs: Record<string, HTMLInputElement | HTMLInputElement> = {};
  private panel: HTMLElement;

  constructor(
    private getManual: () => ManualFeatures,
    private getData: () => CampusData,
    private camera: THREE.PerspectiveCamera,
    private controls: OrbitControls,
  ) {
    this.panel = document.getElementById('editor-panel')!;
    this.bindInspector();
    this.bindDrag();
  }

  setCampus(id: string): void {
    this.campusId = id;
    this.select(null);
    this.refreshMarkers();
  }

  toggle(): void {
    this.active = !this.active;
    this.markerLayer.visible = this.active;
    this.panel.classList.toggle('hidden', !this.active);
    if (this.active) {
      this.refreshMarkers();
      this.select(null);
    }
  }

  private project(lon: number, lat: number): { x: number; z: number } {
    const center = this.getMeta?.()?.center ?? { lat: 28.808876, lon: 104.668727 };
    const mLon = 111320 * Math.cos((center.lat * Math.PI) / 180);
    return { x: (lon - center.lon) * mLon, z: -(lat - center.lat) * 110540 };
  }

  /** 建筑标签基准锚点(质心 + 层顶,不含偏移) */
  private labelBase(f: CampusData['buildings'][number]): { pos: THREE.Vector3; centroid: { x: number; z: number } } {
    const g = f.geometry;
    const ring = g.type === 'Polygon' ? (g.coordinates as number[][][])[0] : (g.coordinates as number[][][][])[0][0];
    let lon = 0, lat = 0;
    for (const pt of ring) { lon += pt[0]; lat += pt[1]; }
    lon /= ring.length; lat /= ring.length;
    const { x, z } = this.project(lon, lat);
    return {
      pos: new THREE.Vector3(x, f.properties.height_m + 7, z),
      centroid: { x, z },
    };
  }

  refreshMarkers(): void {
    for (const m of this.markers.values()) {
      if (m.element.parentElement) m.element.parentElement.removeChild(m.element);
      m.removeFromParent();
    }
    this.markers.clear();
    const state = this.getManual().state;
    const overrides = state.labelOverrides ?? {};
    const add = (id: string, label: string, pos: THREE.Vector3) => {
      const el = document.createElement('div');
      el.className = 'editor-marker';
      el.dataset.id = id;
      el.title = label;
      el.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this.select(id);
        this.draggingId = id;
        this.controls.enabled = false; // 拖拽期间锁定轨道
      });
      const obj = new CSS2DObject(el);
      obj.position.copy(pos);
      this.markerLayer.add(obj);
      this.markers.set(id, obj);
    };
    for (const g of state.gates) add(g.id, g.name, new THREE.Vector3(g.x, 2, g.z));
    for (const p of state.pitches) add(p.id, p.name, new THREE.Vector3(p.cx ?? 0, 1, p.cz ?? 0));
    for (const b of state.buildings) add(b.id, b.name, new THREE.Vector3(b.x, 2, b.z));
    for (const m of state.markers ?? []) add(m.id, m.name, new THREE.Vector3(m.x, 6, m.z));
    // 建筑标签标记
    for (const f of this.getData().buildings) {
      const p = f.properties;
      if (p.campus !== 'suse' || !p.name || p.height_m < 8) continue;
      const ov = overrides[p.osm_id];
      if (ov?.hidden) continue;
      const base = this.labelBase(f);
      const el = document.createElement('div');
      el.className = 'editor-marker editor-marker-label';
      el.dataset.id = `label:${p.osm_id}`;
      el.title = p.name;
      el.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this.select(`label:${p.osm_id}`);
        this.draggingId = `label:${p.osm_id}`;
        this.controls.enabled = false;
        (el as unknown as { _base?: unknown })._base = base;
      });
      const obj = new CSS2DObject(el);
      obj.position.copy(base.pos).add(new THREE.Vector3(ov?.dx ?? 0, ov?.dz ?? 0, 0));
      this.markerLayer.add(obj);
      this.markers.set(`label:${p.osm_id}`, obj);
    }
  }

  private findItem(id: string): Record<string, unknown> | null {
    for (const key of ['gates', 'pitches', 'buildings', 'markers'] as const) {
      const item = (this.getManual().state[key] as unknown as Record<string, unknown>[]).find((x) => x.id === id);
      if (item) return item;
    }
    return null;
  }

  select(id: string | null): void {
    this.selectedId = id;
    for (const [fid, marker] of this.markers) {
      marker.element.classList.toggle('selected', fid === id);
    }
    if (!id) {
      this.panel.querySelector('#ed-name')!.textContent = '(未选中)';
      return;
    }
    this.fillInspector(id);
  }

  private fillInspector(id: string): void {
    const setName = (v: string) => {
      (this.inputs['name'] ??= document.getElementById('ed-name-input') as HTMLInputElement).value = v;
    };
    const set = (key: string, val: string) => {
      (this.inputs[key] ??= document.getElementById(`ed-${key}`) as HTMLInputElement).value = val;
    };
    const extra = this.panel.querySelector('#ed-extra')!;
    const hiddenBox = document.getElementById('ed-hidden') as HTMLInputElement;
    const addInput = (key: string, label: string, val: number, isInt = false) => {
      const wrap = document.createElement('label');
      wrap.className = 'ed-field';
      wrap.innerHTML = `<span>${label}</span>`;
      const input = document.createElement('input');
      input.type = 'number';
      input.step = isInt ? '1' : '0.5';
      input.value = String(val);
      input.addEventListener('change', () => this.applyInput(key, parseFloat(input.value)));
      wrap.appendChild(input);
      this.inputs[key] = input;
      extra.appendChild(wrap);
    };
    extra.innerHTML = '';
    hiddenBox.parentElement?.classList?.add('hidden');
    hiddenBox.checked = false;

    if (id.startsWith('label:')) {
      // —— 建筑标签编辑 ——
      const osmId = id.slice(6);
      const f = this.getData().buildings.find((x) => x.properties.osm_id === osmId);
      if (!f) return;
      const ov = this.getManual().state.labelOverrides?.[osmId] ?? {};
      this.panel.querySelector('#ed-name')!.textContent = f.properties.name || osmId;
      setName(ov.name ?? f.properties.name ?? '');
      const base = this.labelBase(f);
      set('x', String(Math.round(base.pos.x + (ov.dx ?? 0))));
      set('z', String(Math.round(base.pos.z + (ov.dz ?? 0))));
      set('rot', '-');
      (this.inputs['rot'] as HTMLInputElement).disabled = true;
      addInput('dx', '标签偏移X', ov.dx ?? 0);
      addInput('dz', '标签偏移Z', ov.dz ?? 0);
      hiddenBox.parentElement?.classList?.remove('hidden');
      hiddenBox.checked = !!ov.hidden;
      return;
    }

    const item = this.findItem(id);
    if (!item) return;
    (this.inputs['rot'] as HTMLInputElement).disabled = false;
    this.panel.querySelector('#ed-name')!.textContent = String(item.name ?? id);
    setName(String(item.name ?? ''));
    const xVal = item.cx !== undefined ? item.cx : item.x;
    const zVal = item.cz !== undefined ? item.cz : item.z;
    set('x', String(xVal ?? ''));
    set('z', String(zVal ?? ''));
    set('rot', String(item.rot ?? 0));
    if (item.cols !== undefined) {
      addInput('cols', '列数', item.cols as number, true);
      addInput('rows', '行数', item.rows as number, true);
      addInput('bw', '列间距', item.bw as number);
      addInput('bd', '行间距', item.bd as number);
    }
    if (item.w !== undefined) addInput('w', '长(米)', item.w as number);
    if (item.d !== undefined) addInput('d', '宽(米)', item.d as number);
    if (item.height !== undefined) addInput('height', '高度(米)', item.height as number);
  }

  private applyLabelInput(prop: string, value: number | string | boolean): void {
    const osmId = this.selectedId!.slice(6);
    const state = this.getManual().state;
    state.labelOverrides = state.labelOverrides ?? {};
    const ov: LabelOverride = (state.labelOverrides[osmId] ??= {});
    const f = this.getData().buildings.find((x) => x.properties.osm_id === osmId);
    if (!f) return;
    const base = this.labelBase(f);
    if (prop === 'name') ov.name = String(value);
    else if (prop === 'hidden') ov.hidden = Boolean(value);
    else if (prop === 'dx') ov.dx = value as number;
    else if (prop === 'dz') ov.dz = value as number;
    else if (prop === 'x') { ov.dx = (value as number) - base.pos.x; }
    else if (prop === 'z') { ov.dz = (value as number) - base.pos.z; }
    this.onLabelOverridesChange?.();
    this.refreshMarkers();
    this.select(this.selectedId);
  }

  private applyInput(prop: string, val: number | string): void {
    if (!this.selectedId) return;
    if (this.selectedId.startsWith('label:')) {
      this.applyLabelInput(prop, val);
      return;
    }
    const item = this.findItem(this.selectedId);
    if (!item) return;
    if (prop === 'name') item.name = String(val);
    else if (typeof val === 'number' && !Number.isNaN(val)) {
      if (prop === 'x' && item.cx !== undefined) item.cx = val;
      else if (prop === 'z' && item.cz !== undefined) item.cz = val;
      else item[prop] = val;
    } else return;
    this.getManual().rebuild(this.selectedId);
    this.refreshMarkerPos(this.selectedId);
    this.fillInspector(this.selectedId);
  }

  private refreshMarkerPos(id: string): void {
    const marker = this.markers.get(id);
    if (!marker) return;
    const item = this.findItem(id);
    if (item) {
      const itemId = String(item.id ?? '');
      const x = Number(item.cx ?? item.x ?? 0);
      const zz = Number(item.cz ?? item.z ?? 0);
      const y = Number(itemId.startsWith('gate') ? 2 : item.cx !== undefined ? 1 : 6);
      marker.position.set(x, y, zz);
    }
  }

  private bindInspector(): void {
    for (const key of ['x', 'z', 'rot']) {
      const input = document.getElementById(`ed-${key}`) as HTMLInputElement;
      this.inputs[key] = input;
      input.addEventListener('change', () => this.applyInput(key, parseFloat(input.value)));
    }
    const nameInput = document.getElementById('ed-name-input') as HTMLInputElement;
    this.inputs['name'] = nameInput;
    nameInput.addEventListener('change', () => this.applyInput('name', nameInput.value));
    const hiddenBox = document.getElementById('ed-hidden') as HTMLInputElement;
    hiddenBox.addEventListener('change', () => this.applyInput('hidden', hiddenBox.checked ? 1 : 0));
    document.getElementById('ed-delete')!.addEventListener('click', () => {
      if (!this.selectedId) return;
      if (this.selectedId.startsWith('label:')) {
        this.applyLabelInput('hidden', true);
        return;
      }
      this.getManual().delete(this.selectedId);
      this.refreshMarkers();
      this.select(null);
    });
    document.getElementById('ed-close')!.addEventListener('click', () => this.toggle());
    for (const t of TARGETS) {
      document.getElementById(`ed-add-${t.prefix}`)!.addEventListener('click', () => {
        const id = this.getManual().nextId(t.prefix);
        const target = this.controls.target;
        const item: Record<string, unknown> = {
          id, name: `${t.label}${id.slice(-2)}`, x: Math.round(target.x), z: Math.round(target.z), ...structuredClone(t.defaults),
        };
        if (t.key === 'pitches') { item.cx = item.x; item.cz = item.z; }
        (this.getManual().state[t.key] as unknown as Record<string, unknown>[]).push(item);
        this.getManual().rebuild(id);
        this.refreshMarkers();
        this.select(id);
      });
    }
    document.getElementById('ed-export')!.addEventListener('click', () => {
      const json = JSON.stringify(this.getManual().state, null, 2);
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

  private bindDrag(): void {
    window.addEventListener('pointermove', (e) => {
      if (!this.active || !this.draggingId) return;
      this.pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const hit = new THREE.Vector3();
      if (!this.raycaster.ray.intersectPlane(this.groundPlane, hit)) return;
      const item = this.findItem(this.draggingId);
      if (this.draggingId.startsWith('label:')) {
        // 拖标签:更新覆盖偏移
        const osmId = this.draggingId.slice(6);
        const f = this.getData().buildings.find((x) => x.properties.osm_id === osmId);
        if (!f) return;
        const base = this.labelBase(f);
        const state = this.getManual().state;
        state.labelOverrides = state.labelOverrides ?? {};
        const ov: LabelOverride = (state.labelOverrides[osmId] ??= {});
        ov.dx = Math.round(hit.x - base.pos.x);
        ov.dz = Math.round(hit.z - base.pos.z);
        this.onLabelOverridesChange?.();
        const marker = this.markers.get(this.draggingId);
        if (marker) marker.position.set(hit.x, base.pos.y + ov.dz, hit.z);
        this.fillInspector(this.draggingId);
        return;
      }
      if (!item) return;
      const x = Math.round(hit.x);
      const z = Math.round(hit.z);
      if (item.cx !== undefined) { item.cx = x; item.cz = z; } else { item.x = x; item.z = z; }
      this.getManual().rebuild(this.draggingId);
      this.refreshMarkerPos(this.draggingId);
      this.fillInspector(this.draggingId);
    });
    window.addEventListener('pointerup', () => {
      if (this.draggingId) {
        this.draggingId = null;
        this.controls.enabled = true;
      }
    });
  }

  get markerGroup(): THREE.Group {
    return this.markerLayer;
  }

  get state(): ManualState {
    return this.getManual().state;
  }
}
