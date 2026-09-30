/** 低多边形树木:绿地内确定性随机散布,InstancedMesh 绘制 */
import * as THREE from 'three';
import { metersFromLonLat } from '../data/projection';
import type { CampusData } from '../data/loader';

type Pt = [number, number];

function ringToMeters(ring: number[][]): Pt[] {
  return ring.map(([lon, lat]) => {
    const { x, z } = metersFromLonLat({ lon, lat });
    return [x, z];
  });
}

function pip(x: number, z: number, ring: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** 种子随机(可复现) */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DENSITY: Record<string, number> = { wood: 1 / 130, park: 1 / 380, grass: 1 / 850 };
const MAX_TREES = 3200;

export function buildTrees(data: CampusData): THREE.Group {
  const rng = mulberry32(20260930);

  // 禁止种树的区域:广场 + 球场(外环)
  const blocked: Pt[][] = [];
  type PolyGeom = typeof data.plaza[number]['geometry'];
  const asPolys = (g: PolyGeom): number[][][][] =>
    g.type === 'Polygon' ? [g.coordinates as number[][][]] : (g.coordinates as number[][][][]);
  for (const f of data.plaza) {
    for (const rs of asPolys(f.geometry)) blocked.push(ringToMeters(rs[0]));
  }
  for (const f of data.pitch) {
    for (const rs of asPolys(f.geometry)) blocked.push(ringToMeters(rs[0]));
  }
  const isBlocked = (x: number, z: number) => blocked.some((r) => pip(x, z, r));

  // 在绿地内采样
  const spots: { x: number; z: number; s: number }[] = [];
  for (const f of data.green) {
    const density = DENSITY[f.properties.kind ?? ''] ?? 1 / 600;
    for (const rings of asPolys(f.geometry)) {
      const outer = ringToMeters(rings[0]);
      let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
      for (const [x, z] of outer) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
      }
        const step = 1 / Math.sqrt(density);
      for (let gz = minZ; gz < maxZ; gz += step) {
        for (let gx = minX; gx < maxX; gx += step) {
          const x = gx + (rng() - 0.5) * step * 0.9;
          const z = gz + (rng() - 0.5) * step * 0.9;
          if (!pip(x, z, outer)) continue;
          if (isBlocked(x, z)) continue;
          spots.push({ x, z, s: 0.75 + rng() * 0.7 });
        }
      }
    }
  }
  // 洗牌后截断,避免超量
  for (let i = spots.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [spots[i], spots[j]] = [spots[j], spots[i]];
  }
  const chosen = spots.slice(0, MAX_TREES);

  // 树干 + 树冠(几何中心已抬到地面以上)
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.3, 2.4, 5);
  trunkGeo.translate(0, 1.2, 0);
  const crownGeo = new THREE.IcosahedronGeometry(1.8, 0);
  crownGeo.scale(1, 1.3, 1);
  crownGeo.translate(0, 3.6, 0);

  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x7d5f43, roughness: 1, flatShading: true });
  const crownMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true });

  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, chosen.length);
  const crowns = new THREE.InstancedMesh(crownGeo, crownMat, chosen.length);
  trunks.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  crowns.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  crowns.castShadow = true;

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const col = new THREE.Color();
  const up = new THREE.Vector3(0, 1, 0);
  chosen.forEach((sp, i) => {
    q.setFromAxisAngle(up, rng() * Math.PI * 2);
    pos.set(sp.x, 0, sp.z);
    scl.set(sp.s, sp.s * (0.9 + rng() * 0.3), sp.s);
    m.compose(pos, q, scl);
    trunks.setMatrixAt(i, m);
    crowns.setMatrixAt(i, m);
    col.setHSL(0.26 + rng() * 0.08, 0.42 + rng() * 0.18, 0.3 + rng() * 0.14);
    crowns.setColorAt(i, col);
  });
  trunks.instanceMatrix.needsUpdate = true;
  crowns.instanceMatrix.needsUpdate = true;

  const group = new THREE.Group();
  group.add(trunks, crowns);
  return group;
}
