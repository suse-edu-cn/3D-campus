/** 校门门楼:两柱一梁的低多边形结构,位于道路与边界交汇处 */
import * as THREE from 'three';
import { metersFromLonLat } from '../data/projection';
import type { CampusData } from '../data/loader';

export function buildGates(data: CampusData): THREE.Group {
  const group = new THREE.Group();
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.8 });
  const beamMat = new THREE.MeshStandardMaterial({ color: 0x2e6e9e, roughness: 0.7 });
  const beamMatAlt = new THREE.MeshStandardMaterial({ color: 0xb5443c, roughness: 0.7 });

  for (const f of data.poi) {
    if (f.properties.kind !== 'gate') continue;
    const p = f.properties;
    const [lon, lat] = f.geometry.coordinates as [number, number];
    const { x, z } = metersFromLonLat({ lon, lat });

    const gate = new THREE.Group();
    const span = 18; // 两柱间距
    for (const side of [-1, 1]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(2.2, 10, 2.2), pillarMat);
      pillar.position.set((side * span) / 2, 5, 0);
      pillar.castShadow = true;
      gate.add(pillar);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(span + 4, 2.4, 3), p.name.startsWith('西大门') ? beamMatAlt : beamMat);
    beam.position.y = 10.4;
    beam.castShadow = true;
    gate.add(beam);

    gate.position.set(x, 0, z);
    gate.rotation.y = -((p.rot ?? 0) * Math.PI) / 180;
    group.add(gate);
  }
  return group;
}
