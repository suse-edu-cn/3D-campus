/** 地面:大范围底面 + 校区内部色块 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PALETTE } from './palette';
import { polygonShapes, flatGeometry } from './geo';
import type { Feature, BoundaryProps } from '../data/loader';

export function buildGround(boundaries: Feature<BoundaryProps>[]): THREE.Group {
  const group = new THREE.Group();

  // 只保留校区周边范围,以外交给天空与雾
  const base = new THREE.Mesh(
    new THREE.PlaneGeometry(2100, 2100),
    new THREE.MeshStandardMaterial({ color: PALETTE.groundContext, roughness: 1 }),
  );
  base.rotation.x = -Math.PI / 2;
  base.receiveShadow = true;
  group.add(base);

  // 校区内部地面略浅,勾出校园范围
  const suse = boundaries.find((f) => f.properties.is_suse);
  if (suse) {
    const geoms: THREE.BufferGeometry[] = [];
    for (const shape of polygonShapes(suse.geometry)) {
      const g = flatGeometry(shape);
      if (g) geoms.push(g);
    }
    const merged = geoms.length ? mergeGeometries(geoms) : null;
    if (merged) {
      merged.translate(0, 0.06, 0);
      const mesh = new THREE.Mesh(
        merged,
        new THREE.MeshStandardMaterial({ color: PALETTE.groundCampus, roughness: 1 }),
      );
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
  return group;
}

