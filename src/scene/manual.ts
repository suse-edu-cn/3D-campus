/** 手工设施(校门/网球场/室内馆/广场/中轴步道):由 data/manual.json 驱动,支持单个重建 */
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getWindowTexture, scaleWallUVs } from './windows';

export interface ManualGate { id: string; name: string; x: number; z: number; rot: number }
export interface ManualPitch {
  id: string; name: string; kind: string;
  cx: number; cz: number; cols: number; rows: number; bw: number; bd: number;
  w: number; d: number; rot: number;
}
export interface ManualBuilding {
  id: string; name: string; kind: string;
  x: number; z: number; w: number; d: number; rot: number; height: number; levels: number;
}
export interface ManualPlaza { id: string; name: string; kind: string; ring: [number, number][] }
export interface ManualRoad { id: string; name: string; cls: string; waypoints: [number, number][] }
export interface ManualState {
  gates: ManualGate[]; pitches: ManualPitch[]; buildings: ManualBuilding[];
  plazas: ManualPlaza[]; roads: ManualRoad[];
}

const PITCH_COLORS: Record<string, number> = {
  tennis: 0x4a8fc4, basketball: 0xc98d55, soccer: 0x4e9e4a,
  track: 0xc05a4e, badminton: 0x58b0a0, multi: 0x8fbf6b,
};

/** 局部米制旋转矩形 → 世界 XZ 顶点序列(闭合) */
function rectCorners(x: number, z: number, w: number, d: number, rot: number): THREE.Vector2[] {
  const r = (rot * Math.PI) / 180;
  const cos = Math.cos(r), sin = Math.sin(r);
  return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([dx, dz]) =>
    new THREE.Vector2(x + dx * cos - dz * sin, -(z + dx * sin + dz * cos)),
  );
}

/** 旋转矩形平面几何(法线朝上,放在高度 y) */
function rectGeometry(x: number, z: number, w: number, d: number, rot: number, y: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(rectCorners(x, z, w, d, rot).map((v) => new THREE.Vector2(v.x, v.y)));
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  g.computeVertexNormals();
  return g;
}

export class ManualFeatures {
  group = new THREE.Group();
  /** 可拾取的室内馆等建筑网格(供信息面板射线) */
  buildingMeshes: THREE.Mesh[] = [];
  private registry = new Map<string, { type: 'gate' | 'pitch' | 'building' | 'plaza' | 'road'; node: THREE.Object3D }>();

  constructor(public state: ManualState) {
    this.rebuildAll();
  }

  rebuildAll(): void {
    for (const g of this.state.gates) this.rebuild(g.id);
    for (const p of this.state.pitches) this.rebuild(p.id);
    for (const b of this.state.buildings) this.rebuild(b.id);
    for (const p of this.state.plazas) this.rebuild(p.id);
    for (const r of this.state.roads) this.rebuild(r.id);
  }

  anchorOf(id: string): THREE.Vector3 {
    const node = this.registry.get(id)?.node;
    if (!node) return new THREE.Vector3();
    const box = new THREE.Box3().setFromObject(node);
    const c = box.getCenter(new THREE.Vector3());
    c.y = 0;
    return c;
  }

  rebuild(id: string): void {
    const old = this.registry.get(id);
    if (old) {
      this.group.remove(old.node);
      this.registry.delete(id);
    }
    let node: THREE.Object3D | null = null;
    let type: 'gate' | 'pitch' | 'building' | 'plaza' | 'road' = 'gate';
    if (this.state.gates.find((g) => g.id === id)) {
      type = 'gate';
      node = this.buildGate(this.state.gates.find((g) => g.id === id)!);
    } else if (this.state.pitches.find((p) => p.id === id)) {
      type = 'pitch';
      node = this.buildPitch(this.state.pitches.find((p) => p.id === id)!);
    } else if (this.state.buildings.find((b) => b.id === id)) {
      type = 'building';
      node = this.buildBuilding(this.state.buildings.find((b) => b.id === id)!);
    } else if (this.state.plazas.find((p) => p.id === id)) {
      type = 'plaza';
      node = this.buildPlaza(this.state.plazas.find((p) => p.id === id)!);
    } else if (this.state.roads.find((r) => r.id === id)) {
      type = 'road';
      node = this.buildRoad(this.state.roads.find((r) => r.id === id)!);
    }
    if (node) {
      this.group.add(node);
      this.registry.set(id, { type, node });
    }
  }

  delete(id: string): void {
    const old = this.registry.get(id);
    if (old) {
      this.group.remove(old.node);
      this.registry.delete(id);
    }
    this.state.gates = this.state.gates.filter((g) => g.id !== id);
    this.state.pitches = this.state.pitches.filter((p) => p.id !== id);
    this.state.buildings = this.state.buildings.filter((b) => b.id !== id);
    this.state.plazas = this.state.plazas.filter((p) => p.id !== id);
    this.state.roads = this.state.roads.filter((r) => r.id !== id);
  }

  /** 生成不重复 id */
  nextId(prefix: string): string {
    let i = 1;
    while (this.registry.has(`${prefix}-${i}`) || this.state.gates.some((g) => g.id === `${prefix}-${i}`)) i++;
    return `${prefix}-${i}`;
  }

  // ---------- 各类构建 ----------
  private buildGate(g: ManualGate): THREE.Group {
    const gate = new THREE.Group();
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.8 });
    const isMain = g.name.startsWith('西大门');
    const beamMat = new THREE.MeshStandardMaterial({ color: isMain ? 0xb5443c : 0x2e6e9e, roughness: 0.7 });
    const span = 18;
    for (const side of [-1, 1]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(2.2, 10, 2.2), pillarMat);
      pillar.position.set((side * span) / 2, 5, 0);
      pillar.castShadow = true;
      gate.add(pillar);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(span + 4, 2.4, 3), beamMat);
    beam.position.y = 10.4;
    beam.castShadow = true;
    gate.add(beam);

    const labelEl = document.createElement('div');
    labelEl.className = 'map-label map-label-gate';
    labelEl.textContent = g.name;
    const label = new CSS2DObject(labelEl);
    label.position.set(0, 13.5, 0);
    gate.add(label);

    gate.position.set(g.x, 0, g.z);
    gate.rotation.y = -(g.rot * Math.PI) / 180;
    return gate;
  }

  private buildPitch(p: ManualPitch): THREE.Group {
    const group = new THREE.Group();
    const color = PITCH_COLORS[p.kind] ?? PITCH_COLORS.multi;
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.9 });
    const cos = Math.cos((p.rot * Math.PI) / 180), sin = Math.sin((p.rot * Math.PI) / 180);
    const geoms: THREE.BufferGeometry[] = [];
    for (let c = 0; c < p.cols; c++) {
      for (let r = 0; r < p.rows; r++) {
        const u = (c - (p.cols - 1) / 2) * p.bw;
        const v = (r - (p.rows - 1) / 2) * p.bd;
        geoms.push(rectGeometry(p.cx + u * cos - v * sin, p.cz + u * sin + v * cos, p.w, p.d, p.rot, 0.26));
      }
    }
    const mesh = new THREE.Mesh(mergeGeometries(geoms)!, mat);
    mesh.receiveShadow = true;
    group.add(mesh);
    return group;
  }

  private buildBuilding(b: ManualBuilding): THREE.Group {
    const group = new THREE.Group();
    const shape = new THREE.Shape(
      rectCorners(0, 0, b.w, b.d, b.rot).map((v) => new THREE.Vector2(v.x, v.y)),
    );
    const geo = new THREE.ExtrudeGeometry(shape, { depth: b.height, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);
    scaleWallUVs(geo);
    const wallColor = b.kind === 'gym' ? 0xdfe5e9 : 0xe8e2d4;
    const roofColor = b.kind === 'gym' ? 0xa9b6bf : 0xa8a49a;
    const roofMat = new THREE.MeshStandardMaterial({ color: roofColor, roughness: 0.9 });
    const wallMat = new THREE.MeshStandardMaterial({ color: wallColor, roughness: 0.85, map: getWindowTexture() });
    const mesh = new THREE.Mesh(geo, [roofMat, wallMat]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.set(b.x, 0, b.z);
    mesh.userData = {
      osm_id: `manual/${b.id}`, name: b.name, campus: 'suse', kind: b.kind,
      levels: b.levels, height_m: b.height, desc: '手工校准设施',
    };
    group.add(mesh);
    this.buildingMeshes.push(mesh);

    const labelEl = document.createElement('div');
    labelEl.className = 'map-label map-label-building';
    labelEl.textContent = b.name;
    const label = new CSS2DObject(labelEl);
    label.position.set(b.x, b.height + 7, b.z);
    group.add(label);
    return group;
  }

  private buildPlaza(p: ManualPlaza): THREE.Group {
    const group = new THREE.Group();
    const shape = new THREE.Shape(p.ring.map(([x, z]) => new THREE.Vector2(x, -z)));
    const g = new THREE.ShapeGeometry(shape);
    g.rotateX(-Math.PI / 2);
    g.translate(0, 0.1, 0);
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xdcd4a8, roughness: 0.95 }));
    mesh.receiveShadow = true;
    group.add(mesh);
    return group;
  }

  private buildRoad(r: ManualRoad): THREE.Group {
    const group = new THREE.Group();
    const width = r.cls === 'axis' ? 12 : 6;
    const pts = r.waypoints.map(([x, z]) => new THREE.Vector2(x, -z));
    // 简易折线绦带(相邻段法线平均)
    const normals: THREE.Vector2[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const dir = pts[i + 1].clone().sub(pts[i]).normalize();
      normals.push(new THREE.Vector2(-dir.y, dir.x));
    }
    const pos: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const n = new THREE.Vector2();
      if (i > 0) n.add(normals[i - 1]);
      if (i < normals.length) n.add(normals[i]);
      if (n.lengthSq() < 1e-6) n.copy(normals[Math.max(0, i - 1)]);
      n.normalize().multiplyScalar(width / 2);
      pos.push(pts[i].x + n.x, pts[i].y + n.y, 0);
      pos.push(pts[i].x - n.x, pts[i].y - n.y, 0);
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, b, c, b, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.rotateX(-Math.PI / 2);
    g.translate(0, 0.18, 0);
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(
      g,
      new THREE.MeshStandardMaterial({ color: r.cls === 'axis' ? 0xd6cdaa : 0x76808a, roughness: 1 }),
    );
    mesh.receiveShadow = true;
    group.add(mesh);
    return group;
  }
}
