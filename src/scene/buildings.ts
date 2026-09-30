/** 建筑图层:校区内逐栋独立网格(便于拾取),周边建筑按材质合并 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { polygonShapes } from './geo';
import { getWindowTexture, scaleWallUVs } from './windows';
import {
  WALL_COLORS,
  ROOF_COLORS,
  CONTEXT_WALL,
  CONTEXT_ROOF,
} from './palette';
import type { CampusData } from '../data/loader';

const matCache = new Map<string, [THREE.MeshStandardMaterial, THREE.MeshStandardMaterial]>();

/** [屋顶, 墙面] 双材质;ExtrudeGeometry 的盖面 materialIndex=0,侧壁=1 */
function buildingMaterials(kind: string, campus: string): [THREE.MeshStandardMaterial, THREE.MeshStandardMaterial] {
  const key = `${campus}:${kind}`;
  let mats = matCache.get(key);
  if (!mats) {
    const suse = campus === 'suse';
    const wall = suse ? (WALL_COLORS[kind] ?? 0xdedbd3) : CONTEXT_WALL;
    const roof = suse ? (ROOF_COLORS[kind] ?? 0xa5a29a) : CONTEXT_ROOF;
    mats = [
      new THREE.MeshStandardMaterial({ color: roof, roughness: 0.9 }),
      new THREE.MeshStandardMaterial({ color: wall, roughness: 0.85, map: getWindowTexture() }),
    ];
    matCache.set(key, mats);
  }
  return mats;
}

export function buildBuildings(data: CampusData): THREE.Group {
  const group = new THREE.Group();
  const contextGeoms: THREE.BufferGeometry[] = [];

  for (const f of data.buildings) {
    const p = f.properties;
    if (!p.height_m || p.height_m <= 0) continue;
    const shapes = polygonShapes(f.geometry);
    if (!shapes.length) continue;

    const geoms: THREE.BufferGeometry[] = [];
    for (const shape of shapes) {
      try {
        const g = new THREE.ExtrudeGeometry(shape, { depth: p.height_m, bevelEnabled: false });
        g.rotateX(-Math.PI / 2);
        scaleWallUVs(g);
        geoms.push(g);
      } catch {
        /* 跳过无法三角化的面 */
      }
    }
    if (!geoms.length) continue;

    if (p.campus === 'suse') {
      const mats = buildingMaterials(p.kind, p.campus);
      for (const g of geoms) {
        const mesh = new THREE.Mesh(g, mats);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData = p;
        group.add(mesh);
      }
    } else {
      contextGeoms.push(...geoms);
    }
  }

  if (contextGeoms.length) {
    const merged = mergeGeometries(contextGeoms, true);
    if (merged) {
      const mesh = new THREE.Mesh(merged, buildingMaterials('other', 'other'));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
  return group;
}
