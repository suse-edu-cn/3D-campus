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

/** 把 ExtrudeGeometry 按组拆成 盖面/侧壁 两个几何(用于无分组合并) */
function splitCapWall(g: THREE.BufferGeometry): { cap: THREE.BufferGeometry; wall: THREE.BufferGeometry } {
  const pos = g.getAttribute('position');
  const norm = g.getAttribute('normal');
  const uv = g.getAttribute('uv');
  const mk = (grp: { start: number; count: number }) => {
    const pg = new THREE.BufferGeometry();
    const slice = (attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, item: number) =>
      Array.from(attr.array.slice(grp.start * item, (grp.start + grp.count) * item));
    pg.setAttribute('position', new THREE.Float32BufferAttribute(slice(pos, 3), 3));
    if (norm) pg.setAttribute('normal', new THREE.Float32BufferAttribute(slice(norm, 3), 3));
    if (uv) pg.setAttribute('uv', new THREE.Float32BufferAttribute(slice(uv, 2), 2));
    return pg;
  };
  const groups = g.groups;
  // ExtrudeGeometry:组 0 = 盖面,组 1 = 侧壁(顶点区间连续)
  return { cap: mk(groups.find((x) => x.materialIndex === 0) ?? groups[0]), wall: mk(groups.find((x) => x.materialIndex === 1) ?? groups[groups.length - 1]) };
}

export function buildBuildings(data: CampusData): THREE.Group {
  const group = new THREE.Group();
  const contextCaps: THREE.BufferGeometry[] = [];
  const contextWalls: THREE.BufferGeometry[] = [];

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
      for (const g of geoms) {
        const { cap, wall } = splitCapWall(g);
        contextCaps.push(cap);
        contextWalls.push(wall);
      }
    }
  }

  // 周边(校区外)建筑:盖面/侧壁分别合并,避免 useGroups 打乱材质索引
  const [ctxRoof, ctxWall] = buildingMaterials('other', 'other');
  if (contextCaps.length) {
    const merged = mergeGeometries(contextCaps);
    if (merged) {
      const mesh = new THREE.Mesh(merged, ctxRoof);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
  if (contextWalls.length) {
    const merged = mergeGeometries(contextWalls);
    if (merged) {
      const mesh = new THREE.Mesh(merged, ctxWall);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
  return group;
}
