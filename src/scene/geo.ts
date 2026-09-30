/** GeoJSON 几何 → Three.js 几何的转换工具 */
import * as THREE from 'three';
import { metersFromLonLat } from '../data/projection';
import type { Geometry } from '../data/loader';

type Ring = number[][];

/** 单个环 → Shape(shape 平面里 y = 北向距离,配合 rotateX(-π/2) 映射到世界 -Z=北) */
function ringToPath(ring: Ring): THREE.Path {
  const path = new THREE.Path();
  ring.forEach((pt, i) => {
    const { x, z } = metersFromLonLat({ lon: pt[0], lat: pt[1] });
    if (i === 0) path.moveTo(x, -z);
    else path.lineTo(x, -z);
  });
  path.closePath();
  return path;
}

/** 一个 Polygon(首环外轮廓 + 其余内环洞)→ Shape */
function polyToShape(rings: Ring[]): THREE.Shape {
  const shape = new THREE.Shape(ringToPath(rings[0]).getPoints());
  for (let i = 1; i < rings.length; i++) shape.holes.push(ringToPath(rings[i]));
  return shape;
}

/** Polygon / MultiPolygon → Shape 数组(带洞) */
export function polygonShapes(geom: Geometry): THREE.Shape[] {
  const shapes: THREE.Shape[] = [];
  if (geom.type === 'Polygon') {
    if (geom.coordinates[0]?.length >= 3) shapes.push(polyToShape(geom.coordinates));
  } else if (geom.type === 'MultiPolygon') {
    for (const poly of geom.coordinates) {
      if (poly[0]?.length >= 3) shapes.push(polyToShape(poly));
    }
  }
  return shapes;
}

/**
 * 折线 → 定宽绦带几何(世界 XZ 平面,法线朝上)。
 * 转角处用相邻段法线平均,避免尖刺。
 */
export function ribbonGeometry(coords: number[][], width: number): THREE.BufferGeometry | null {
  const pts: THREE.Vector2[] = [];
  for (const c of coords) {
    const { x, z } = metersFromLonLat({ lon: c[0], lat: c[1] });
    const v = new THREE.Vector2(x, -z);
    if (!pts.length || v.distanceToSquared(pts[pts.length - 1]) > 0.04) pts.push(v);
  }
  if (pts.length < 2) return null;

  const half = width / 2;
  // 每段的左法线
  const segNormals: THREE.Vector2[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const dir = pts[i + 1].clone().sub(pts[i]).normalize();
    segNormals.push(new THREE.Vector2(-dir.y, dir.x));
  }
  // 每个顶点的偏移向量 = 相邻段法线平均
  const offsets: THREE.Vector2[] = [];
  for (let i = 0; i < pts.length; i++) {
    const n = new THREE.Vector2();
    if (i > 0) n.add(segNormals[i - 1]);
    if (i < segNormals.length) n.add(segNormals[i]);
    if (n.lengthSq() < 1e-6) n.copy(segNormals[Math.max(0, i - 1)]);
    n.normalize().multiplyScalar(half);
    offsets.push(n);
  }

  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    pos.push(pts[i].x + offsets[i].x, pts[i].y + offsets[i].y, 0);
    pos.push(pts[i].x - offsets[i].x, pts[i].y - offsets[i].y, 0);
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.rotateX(-Math.PI / 2);
  g.computeVertexNormals();
  return g;
}

/** ShapeGeometry → 世界 XZ 平面(法线朝上) */
export function flatGeometry(shape: THREE.Shape): THREE.BufferGeometry | null {
  try {
    const g = new THREE.ShapeGeometry(shape);
    g.rotateX(-Math.PI / 2);
    g.computeVertexNormals();
    return g;
  } catch {
    return null;
  }
}
