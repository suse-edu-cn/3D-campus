/** 平铺面图层(水体/绿地/球场)的通用构建:按颜色合并几何 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { polygonShapes, flatGeometry } from './geo';
import type { Feature, KindProps } from '../data/loader';

export function buildFlatLayer(
  features: Feature<KindProps>[],
  colorOf: (kind: string, name?: string) => number,
  y: number | ((kind: string) => number),
  materialOpts: { roughness?: number; metalness?: number } = {},
): THREE.Group {
  const byKey = new Map<string, { color: number; y: number; geoms: THREE.BufferGeometry[] }>();
  for (const f of features) {
    const kind = f.properties.kind || '';
    const color = colorOf(kind, f.properties.name);
    const fy = typeof y === 'function' ? y(kind) : y;
    const key = `${color}|${fy}`;
    for (const shape of polygonShapes(f.geometry)) {
      const g = flatGeometry(shape);
      if (!g) continue;
      if (!byKey.has(key)) byKey.set(key, { color, y: fy, geoms: [] });
      byKey.get(key)!.geoms.push(g);
    }
  }

  const group = new THREE.Group();
  for (const { color, y: fy, geoms } of byKey.values()) {
    const merged = mergeGeometries(geoms);
    if (!merged) continue;
    merged.translate(0, fy, 0);
    const mesh = new THREE.Mesh(
      merged,
      new THREE.MeshStandardMaterial({
        color,
        roughness: materialOpts.roughness ?? 0.95,
        metalness: materialOpts.metalness ?? 0,
      }),
    );
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}
