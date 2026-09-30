/** 地面:大范围底面 + 校区内部色块 + 卫星底图纹理 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PALETTE } from './palette';
import { polygonShapes, flatGeometry } from './geo';
import { bboxToMeters, metersFromLonLat } from '../data/projection';
import type { Feature, BoundaryProps } from '../data/loader';

export function buildGround(boundaries: Feature<BoundaryProps>[]): THREE.Group {
  const group = new THREE.Group();

  const base = new THREE.Mesh(
    new THREE.PlaneGeometry(4000, 4000),
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

/** 卫星底图:把影像纹理按 WGS bbox 精确贴到地面(GCJ 偏移已在生成时校正) */
export function buildSatelliteGround(
  meta: { bbox: { minLon: number; maxLon: number; minLat: number; maxLat: number } },
  maxAnisotropy = 8,
): THREE.Mesh {
  const m = bboxToMeters(meta.bbox);
  const w = m.maxX - m.minX;
  const h = m.maxZ - m.minZ;
  const center = metersFromLonLat({
    lon: (meta.bbox.minLon + meta.bbox.maxLon) / 2,
    lat: (meta.bbox.minLat + meta.bbox.maxLat) / 2,
  });

  const tex = new THREE.TextureLoader().load('./assets/satellite-ground.webp');
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;

  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(center.x, 0.04, center.z);
  mesh.receiveShadow = true;
  return mesh;
}
