/** 名称标签:CSS2D 渲染,按相机距离淡出 */
import * as THREE from 'three';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { metersFromLonLat } from '../data/projection';
import type { CampusData, Feature, PoiProps, BuildingProps, KindProps } from '../data/loader';

export function createLabelRenderer(container: HTMLElement): CSS2DRenderer {
  const renderer = new CSS2DRenderer();
  renderer.setSize(container.clientWidth, container.clientHeight);
  const el = renderer.domElement;
  el.style.position = 'absolute';
  el.style.inset = '0';
  el.style.pointerEvents = 'none';
  el.style.zIndex = '5';
  container.appendChild(el);
  return renderer;
}

function centroid(f: Feature<BuildingProps | KindProps | PoiProps>): [number, number] {
  const g = f.geometry;
  let ring: number[][];
  if (g.type === 'Point') ring = [g.coordinates];
  else if (g.type === 'LineString') ring = g.coordinates;
  else if (g.type === 'Polygon') ring = g.coordinates[0];
  else ring = g.coordinates[0][0];
  let lon = 0, lat = 0;
  for (const p of ring) { lon += p[0]; lat += p[1]; }
  const { x, z } = metersFromLonLat({ lon: lon / ring.length, lat: lat / ring.length });
  return [x, z];
}

const entries: { obj: CSS2DObject; el: HTMLElement; base: number }[] = [];

function addLabel(group: THREE.Group, text: string, x: number, y: number, z: number, cls: string) {
  const el = document.createElement('div');
  el.className = `map-label ${cls}`;
  el.textContent = text;
  const obj = new CSS2DObject(el);
  obj.position.set(x, y, z);
  group.add(obj);
  entries.push({ obj, el, base: 1 });
}

export function buildLabels(data: CampusData): THREE.Group {
  entries.length = 0;
  const group = new THREE.Group();
  group.name = 'labels';

  // 校区名
  const bound = data.boundary.find((f) => f.properties.is_suse);
  if (bound) {
    const [x, z] = centroid(bound as Feature<KindProps>);
    addLabel(group, '四川轻化工大学宜宾校区', x, 30, z, 'map-label-campus');
  }

  // 校区建筑(有名称的)
  for (const f of data.buildings) {
    const p = f.properties;
    if (p.campus !== 'suse' || !p.name || p.height_m < 8) continue;
    const [x, z] = centroid(f as Feature<BuildingProps>);
    addLabel(group, p.name.length > 14 ? p.name.slice(0, 13) + '…' : p.name, x, p.height_m + 7, z, 'map-label-building');
  }

  // 校门
  for (const f of data.poi) {
    if (f.properties.kind !== 'gate') continue;
    const [x, z] = centroid(f as Feature<PoiProps>);
    addLabel(group, f.properties.name.replace(/\(.*\)/, ''), x, 14.5, z, 'map-label-gate');
  }

  // 水域名称
  for (const f of data.water) {
    if (!f.properties.name) continue;
    const [x, z] = centroid(f as Feature<KindProps>);
    addLabel(group, f.properties.name, x, 2, z, 'map-label-water');
  }

  return group;
}

/** 每帧调用:按距离淡出 */
export function updateLabels(_group: THREE.Group, camera: THREE.Camera): void {
  const cp = camera.position;
  for (const { obj, el } of entries) {
    if (!obj.visible) continue;
    const d = obj.position.distanceTo(cp);
    const fade = Math.min(1, Math.max(0, 1.25 - d / 1000));
    el.style.opacity = fade.toFixed(2);
    el.style.display = fade <= 0.02 ? 'none' : 'block';
  }
}
