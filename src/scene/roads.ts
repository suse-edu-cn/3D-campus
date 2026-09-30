/** 道路:按等级分色的定宽绦带,合并绘制 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PALETTE } from './palette';
import { ribbonGeometry } from './geo';
import type { CampusData } from '../data/loader';

const WIDTHS: Record<string, number> = { major: 11, minor: 6.5, path: 2.4, axis: 12 };
const Y: Record<string, number> = { major: 0.3, minor: 0.22, path: 0.14, axis: 0.18 };
const COLORS: Record<string, number> = {
  major: PALETTE.roadMajor,
  minor: PALETTE.roadMinor,
  path: PALETTE.roadPath,
  axis: 0xd6cdaa,
};

export function buildRoads(data: CampusData): THREE.Group {
  const byCls: Record<string, THREE.BufferGeometry[]> = { major: [], minor: [], path: [], axis: [] };
  for (const f of data.roads) {
    const cls = f.properties.cls;
    if (f.properties.tunnel) continue;
    const g = ribbonGeometry(f.geometry.coordinates as number[][], WIDTHS[cls] ?? 6);
    if (g) byCls[cls].push(g);
  }

  const group = new THREE.Group();
  for (const cls of Object.keys(byCls)) {
    if (!byCls[cls].length) continue;
    const merged = mergeGeometries(byCls[cls]);
    if (!merged) continue;
    merged.translate(0, Y[cls], 0);
    const mesh = new THREE.Mesh(
      merged,
      new THREE.MeshStandardMaterial({ color: COLORS[cls], roughness: 1 }),
    );
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}
