/** 场景编辑模式:选中/拖拽手工设施,修改位置旋转尺寸,导出 manual.json */
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { ManualFeatures, type ManualState } from '../scene/manual';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const TARGETS: { key: keyof ManualState; label: string; prefix: string; defaults: Record<string, unknown> }[] = [
  { key: 'gates', label: '校门', prefix: 'gate', defaults: { rot: 0 } },
  { key: 'pitches', label: '网球场', prefix: 'court', defaults: { kind: 'tennis', cols: 1, rows: 1, bw: 37, bd: 20, w: 36, d: 19.5, rot: 0 } },
  { key: 'buildings', label: '场馆建筑', prefix: 'hall', defaults: { kind: 'gym', w: 90, d: 50, rot: 0, height: 15, levels: 2 } },
];

export class ManualEditor {
  active = false;
  onRebuild?: (id: string) => void;

  private markerLayer = new THREE.Group();
  private markers = new Map<string, CSS2DObject>();
  private selectedId: string | null = null;
  private draggingId: string | null = null;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  private panel: HTMLElement;
  private inputs: Record<string, HTMLInputElement> = {};

  private isWalkMode = () => false;

  /** 由 main 注入:判断是否处于步行漫游(此时不归还相机控制权) */
  setWalkModeProbe(fn: () => boolean): void {
    this.isWalkMode = fn;
  }

  constructor(
    private manual: ManualFeatures,
    private camera: THREE.PerspectiveCamera,
    private controls: OrbitControls,
  ) {
    this.panel = document.getElementById('editor-panel')!;
    this.bindInspector();
    this.bindDrag();
  }

  toggle(): void {
    this.active = !this.active;
    this.markerLayer.visible = this.active;
    this.panel.classList.toggle('hidden', !this.active);
    if (this.active) {
      this.refreshMarkers();
      this.select(this.manual.state.gates[0]?.id ?? null);
    } else {
      this.select(null);
    }
  }

  private refreshMarkers(): void {
    // 移除旧标记
    for (const m of this.markers.values()) m.removeFromParent();
    this.markers.clear();
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
    for (const g of this.manual.state.gates) add(g.id, g.name, new THREE.Vector3(g.x, 2, g.z));
    for (const p of this.manual.state.pitches) add(p.id, p.name, new THREE.Vector3(p.cx, 1, p.cz));
    for (const b of this.manual.state.buildings) add(b.id, b.name, new THREE.Vector3(b.x, 2, b.z));
  }

  select(id: string | null): void {
    this.selectedId = id;
    for (const [fid, marker] of this.markers) {
      marker.element.classList.toggle('selected', fid === id);
    }
    const panel = this.panel;
    if (!id) {
      panel.querySelector('#ed-name')!.textContent = '(未选中)';
      return;
    }
    this.fillInspector(id);
  }

  private findItem(id: string): Record<string, unknown> | null {
    for (const key of ['gates', 'pitches', 'buildings'] as const) {
      const item = (this.manual.state[key] as unknown as Record<string, unknown>[]).find((x) => x.id === id);
      if (item) return item;
    }
    return null;
  }

  private fillInspector(id: string): void {
    const item = this.findItem(id);
    if (!item) return;
    this.panel.querySelector('#ed-name')!.textContent = String(item.name ?? id);
    const set = (key: string, val: string) => {
      (this.inputs[key] ??= document.getElementById(`ed-${key}`) as HTMLInputElement).value = val;
    };
    // 球场群使用中心点 cx/cz,面板统一映射到 X/Z 输入框
    const xVal = item.cx !== undefined ? item.cx : item.x;
    const zVal = item.cz !== undefined ? item.cz : item.z;
    set('x', String(xVal ?? ''));
    set('z', String(zVal ?? ''));
    set('rot', String(item.rot ?? 0));
    // 类型相关字段
    const extra = this.panel.querySelector('#ed-extra')!;
    extra.innerHTML = '';
    const addInput = (key: string, label: string, val: number) => {
      const wrap = document.createElement('label');
      wrap.className = 'ed-field';
      wrap.innerHTML = `<span>${label}</span>`;
      const input = document.createElement('input');
      input.type = 'number';
      input.step = '1';
      input.value = String(val);
      input.addEventListener('change', () => this.applyInput(key, key, parseFloat(input.value)));
      wrap.appendChild(input);
      this.inputs[key] = input;
      extra.appendChild(wrap);
    };
    if (item.cols !== undefined) {
      addInput('cols', '列数', item.cols as number);
      addInput('rows', '行数', item.rows as number);
      addInput('bw', '列间距', item.bw as number);
      addInput('bd', '行间距', item.bd as number);
    }
    if (item.w !== undefined) addInput('w', '长(米)', item.w as number);
    if (item.d !== undefined) addInput('d', '宽(米)', item.d as number);
    if (item.height !== undefined) addInput('height', '高度(米)', item.height as number);
  }

  private applyInput(_key: string, prop: string, val: number): void {
    if (!this.selectedId || Number.isNaN(val)) return;
    const item = this.findItem(this.selectedId);
    if (!item) return;
    if (prop === 'x' && item.cx !== undefined) item.cx = val;
    else if (prop === 'z' && item.cz !== undefined) item.cz = val;
    else item[prop] = val;
    this.manual.rebuild(this.selectedId);
    this.refreshMarkerPos(this.selectedId);
  }

  private refreshMarkerPos(id: string): void {
    const marker = this.markers.get(id);
    if (marker) marker.position.copy(this.manual.anchorOf(id));
  }

  private bindInspector(): void {
    for (const key of ['x', 'z', 'rot']) {
      const input = document.getElementById(`ed-${key}`) as HTMLInputElement;
      this.inputs[key] = input;
      input.addEventListener('change', () => this.applyInput(key, key, parseFloat(input.value)));
    }
    document.getElementById('ed-delete')!.addEventListener('click', () => {
      if (!this.selectedId) return;
      this.manual.delete(this.selectedId);
      this.refreshMarkers();
      this.select(null);
    });
    document.getElementById('ed-close')!.addEventListener('click', () => this.toggle());
    for (const t of TARGETS) {
      document.getElementById(`ed-add-${t.prefix}`)!.addEventListener('click', () => {
        const id = this.manual.nextId(t.prefix);
        const target = this.controls.target;
        const item: Record<string, unknown> = {
          id, name: `${t.label}${id.slice(-2)}`, x: Math.round(target.x), z: Math.round(target.z), ...structuredClone(t.defaults),
        };
        if (t.key === 'pitches') { item.cx = item.x; item.cz = item.z; }
        (this.manual.state[t.key] as unknown as Record<string, unknown>[]).push(item);
        this.manual.rebuild(id);
        this.refreshMarkers();
        this.select(id);
      });
    }
    document.getElementById('ed-export')!.addEventListener('click', () => {
      const json = JSON.stringify(this.manual.state, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'manual.json';
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
      if (!item) return;
      const x = Math.round(hit.x);
      const z = Math.round(hit.z);
      if (item.cx !== undefined) { item.cx = x; item.cz = z; } else { item.x = x; item.z = z; }
      this.manual.rebuild(this.draggingId);
      this.refreshMarkerPos(this.draggingId);
      const set = (key: string, val: string) => {
        (this.inputs[key] ??= document.getElementById(`ed-${key}`) as HTMLInputElement).value = val;
      };
      set('x', String(x));
      set('z', String(z));
    });
    window.addEventListener('pointerup', () => {
      if (this.draggingId) {
        this.draggingId = null;
        this.controls.enabled = !this.isWalkMode();
      }
    });
  }

  get markerGroup(): THREE.Group {
    return this.markerLayer;
  }

  get state(): ManualState {
    return this.manual.state;
  }
}
