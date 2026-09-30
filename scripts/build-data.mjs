/**
 * 把 data/raw/campus-full.osm 转换为渲染用分层 GeoJSON。
 *
 * 产出(public/data/):
 *   buildings.geojson  建筑(含类型/层数/高度/简介)
 *   roads.geojson      道路(major / minor / path 三级)
 *   water.geojson      水域
 *   green.geojson      绿地(草地/林地/公园)
 *   pitch.geojson      运动场地(按运动类型)
 *   boundary.geojson   校园边界面(含周边高校)
 *   poi.geojson        兴趣点(公交站/商铺/设施)
 *   meta.json          中心点/bbox/统计
 *
 * 用法: npm run data:build
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import osmtogeojson from 'osmtogeojson';
import { DOMParser } from '@xmldom/xmldom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT_DIR = resolve(ROOT, 'public/data');

// ---------- 1. 解析 ----------
const xml = readFileSync(resolve(ROOT, 'data/raw/campus-full.osm'), 'utf8');
const gj = osmtogeojson(new DOMParser().parseFromString(xml, 'text/xml'));

// ---------- 2. 校区边界与中心 ----------
const suseBoundary = gj.features.find(
  (f) =>
    f.properties.amenity === 'university' &&
    (f.properties.name || '').includes('四川轻化工大学'),
);
if (!suseBoundary) throw new Error('未找到四川轻化工大学宜宾校区边界面');

const boundRing = suseBoundary.geometry.coordinates[0];
let minLon = 180, minLat = 90, maxLon = -180, maxLat = -90;
for (const [lon, lat] of boundRing) {
  minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
  minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
}
const CENTER = {
  lon: +(((minLon + maxLon) / 2).toFixed(6)),
  lat: +(((minLat + maxLat) / 2).toFixed(6)),
};

/** 射线法:点是否在校区边界内 */
function inCampus(lon, lat) {
  let inside = false;
  for (let i = 0, j = boundRing.length - 1; i < boundRing.length; j = i++) {
    const [xi, yi] = boundRing[i];
    const [xj, yj] = boundRing[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function centroid(f) {
  const ring =
    f.geometry.type === 'Polygon'
      ? f.geometry.coordinates[0]
      : f.geometry.coordinates[0][0];
  let lon = 0, lat = 0;
  for (const p of ring) { lon += p[0]; lat += p[1]; }
  return { lon: lon / ring.length, lat: lat / ring.length };
}

// ---------- 3. 建筑分类与高度 ----------
// 名称模式 → 类别(按匹配顺序,先命中先得)
const KIND_PATTERNS = [
  [/食堂|令雅|器美|静苑/, 'canteen'],
  [/图书馆/, 'library'],
  [/游泳馆|体育馆/, 'gym'],
  [/实训厂房|厂房/, 'factory'],
  [/宿舍|育秀苑|留学生|^B\d/, 'dormitory'],
  [/实验楼|基础化学|中试基地|工程实践|酿酒生物/, 'lab'],
  [/会堂/, 'hall'],
  [/^A\d|学院|^一教/, 'teaching'],
  [/综合楼|研发楼|勤工楼|励志楼/, 'office'],
];
// 校区建筑命名模式(用于判定建筑归属,即便质心略在边界外)
const SUSE_NAME = /A\d|^B\d|B1[0-4]|育秀苑|留学生|一教|一食堂|品正|令雅|器美|静苑|勤工楼|励志楼|科学会堂|综合楼|研发楼|实验楼|基础化学|工程实践|实训厂房|中试基地|酿酒|白酒学院|四川轻化工大学图书馆|游泳馆|体育馆/;

const KIND_DEFAULTS = {
  teaching:  { levels: 5, floor: 4.0 },
  dormitory: { levels: 6, floor: 3.3 },
  canteen:   { levels: 2, floor: 4.5 },
  library:   { levels: 5, floor: 5.0 },
  gym:       { levels: 2, height: 13 },
  factory:   { levels: 1, height: 9 },
  lab:       { levels: 4, floor: 4.0 },
  hall:      { levels: 3, floor: 4.5 },
  office:    { levels: 5, floor: 3.6 },
  service:   { levels: 1, floor: 4.0 },
  other:     { levels: 4, floor: 3.4 },
};

// 逐栋校准:OSM id 或名称精确匹配(层数/绝对高度/类别/简介)
const OVERRIDES = {
  'relation/9700404': { levels: 7, desc: '一号教学楼,校区最高教学建筑,7 层' },
  'relation/9700405': { levels: 6, desc: '研发楼' },
  'relation/9700406': { levels: 5, desc: '实验楼' },
  'relation/9700407': { levels: 3, desc: '静苑(后勤服务)' },
  'way/738400645': { levels: 5, desc: '四川轻化工大学图书馆,位于校园中轴线北端' },
  'way/723632029': { height: 12, desc: '实训厂房 B' },
  'way/723632028': { height: 9, desc: '实训厂房 A' },
  'way/871558795': { levels: 2, floor: 5.5, desc: '工程实践中心' },
  'way/738400651': { levels: 2, floor: 5.5, desc: '工程实践中心' },
  'way/724835630': { kind: 'service', levels: 1 },
  'way/946212465': { kind: 'service', levels: 2 },
  'way/1280194221': { kind: 'service', levels: 1 },
  'way/1280194224': { kind: 'service', levels: 1 },
  'way/1280194225': { kind: 'service', levels: 1 },
  'way/1280194226': { kind: 'service', levels: 1 },
  'way/738400642': { kind: 'service', levels: 2 },
  'way/1120360583': { kind: 'other', levels: 10, desc: '恒旭国际大酒店(校区外)' },
  'way/1204674535': { kind: 'hall', levels: 4, desc: '宜宾市博物馆(校区外)' },
  'way/1204674536': { kind: 'hall', levels: 4, desc: '宜宾市文化馆(校区外)' },
  'way/1231620469': { kind: 'hall', levels: 4, desc: '宜宾科技馆(校区外)' },
  'way/1280194246': { kind: 'hall', levels: 3, desc: '宜宾市竹文化博物馆(校区外)' },
  'way/815580287': { kind: 'other', levels: 2, desc: '宜宾水街商业街区(校区外)' },
};

function classifyBuilding(f) {
  const p = f.properties;
  const name = p.name || p['name:zh'] || '';
  const ov = OVERRIDES[f.id] || {};
  let kind = ov.kind;
  if (!kind) for (const [re, k] of KIND_PATTERNS) if (re.test(name)) { kind = k; break; }
  if (!kind) kind = p.building === 'dormitory' ? 'dormitory' : 'other';

  const campus =
    ov.campus ??
    (SUSE_NAME.test(name) || inCampus(...(() => [centroid(f).lon, centroid(f).lat])()) ? 'suse' : 'other');

  const def = KIND_DEFAULTS[kind];
  const levels = ov.levels ?? (p['building:levels'] ? +p['building:levels'] : def.levels);
  const height = ov.height ?? def.height ?? +(levels * (ov.floor ?? def.floor)).toFixed(1);

  return {
    osm_id: f.id,
    name: name || undefined,
    campus,
    kind,
    levels,
    height_m: height,
    desc: ov.desc,
  };
}

// ---------- 3.1 手工补充:OSM 缺失但实际存在的设施 ----------
// 位置/尺寸/朝向由已对齐的卫星底图纹理实测(scripts/locate-features.mjs,PCA 主轴角)。
// 坐标为局部米制(x 东 z 南)。grid: cols×rows 片场地,单格 bw×bd,场地 w×d。
const MANUAL_PITCHES = [
  {
    kind: 'tennis', name: '五粮液国际网球中心A区',
    grid: { cx: -392, cz: 3, cols: 3, rows: 2, bw: 37.3, bd: 20.5, w: 36, d: 19.5, rot: -46.3 },
  },
  {
    kind: 'tennis', name: '五粮液国际网球中心北侧场',
    grid: { cx: -422, cz: -83, cols: 1, rows: 1, bw: 26, bd: 15.5, w: 24, d: 14, rot: -45.4 },
  },
];

const MANUAL_BUILDINGS = [
  {
    // 网球场西侧的大跨度场馆(卫星影像实测,标注图未单独命名)
    name: '西区室内场馆', kind: 'gym',
    x: -411, z: -45, w: 80, d: 38, rot: -48, height: 15, levels: 2,
  },
  {
    // 官方标注图「网球场(室内)」:白色大屋顶场馆,位于室外球场群东南
    name: '网球场(室内)', kind: 'gym',
    x: -204, z: 202, w: 95, d: 48, rot: -45, height: 15, levels: 2,
  },
];

// 中心广场(官方标注图黄色区域)+ 中轴步行道(虚线)
const MANUAL_PLAZAS = [
  {
    name: '中心广场', kind: 'plaza',
    ring: [[-41, -62], [186, -69], [201, 227], [-26, 234]],
  },
];
const AXIS_WAYPOINTS = [
  [2, -170], [47, -65],    // 北段:图书馆前
  [109, 234], [173, 320], [224, 410], [264, 504], // 南段:广场 → 南门
];

// 手工道路:中轴步行道
const MANUAL_ROADS = [
  { cls: 'axis', waypoints: AXIS_WAYPOINTS },
];

// 校门:道路×边界交点(OSM 实测)+ 官方标注图命名,rot 为门楼朝向(度)
// 顺序以南门为起点顺时针:南门 → 西大门 → 西门(外卖) → 东门 → 东南门
// 东门位置来自标注图配准解算(原 OSM 交点偏了约 400m)
const MANUAL_GATES = [
  { name: '南门', x: 270, z: 510, rot: 0 },
  { name: '西大门(学校正门)', x: -291, z: 372, rot: 40 },
  { name: '西门(外卖/次要用出入口)', x: -325, z: 358, rot: 40 },
  { name: '东门', x: 312, z: -491, rot: -40 },
  { name: '东南门', x: 554, z: 155, rot: -75 },
];

function wgsFromLocal(x, z) {
  return [
    +(CENTER.lon + x / (111320 * Math.cos((CENTER.lat * Math.PI) / 180))).toFixed(6),
    +(CENTER.lat - z / 110540).toFixed(6),
  ];
}

/** 局部米制矩形(可旋转)→ 闭合 WGS 环 */
function rectRing(x, z, w, d, rotDeg) {
  const rot = (rotDeg * Math.PI) / 180;
  const cos = Math.cos(rot), sin = Math.sin(rot);
  const corners = [
    [-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2],
  ].map(([dx, dz]) => wgsFromLocal(x + dx * cos - dz * sin, z + dx * sin + dz * cos));
  corners.push(corners[0]); // 闭合环
  return corners;
}

function manualPitchFeatures() {
  const features = [];
  const push = (kind, name, x, z, w, d, rot) =>
    features.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [rectRing(x, z, w, d, rot)] },
      properties: { kind, name, manual: 1 },
    });
  for (const m of MANUAL_PITCHES) {
    if (m.grid) {
      const { cx, cz, cols, rows, bw, bd, w, d, rot } = m.grid;
      const cos = Math.cos((rot * Math.PI) / 180), sin = Math.sin((rot * Math.PI) / 180);
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          const u = (c - (cols - 1) / 2) * bw;
          const v = (r - (rows - 1) / 2) * bd;
          push(m.kind, m.name, cx + u * cos - v * sin, cz + u * sin + v * cos, w, d, rot);
        }
      }
    } else {
      push(m.kind, m.name, m.x, m.z, m.w, m.d, m.rot);
    }
  }
  return features;
}

function manualBuildingFeatures() {
  return MANUAL_BUILDINGS.map((m) => ({
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [rectRing(m.x, m.z, m.w, m.d, m.rot)] },
    properties: {
      osm_id: `manual/${m.name}`, name: m.name, campus: 'suse', kind: m.kind,
      levels: m.levels, height_m: m.height, manual: 1,
    },
  }));
}

// ---------- 4. 图层拆分 ----------
const layers = {
  buildings: [],
  roads: [],
  water: [],
  green: [],
  pitch: [],
  plaza: [],
  boundary: [],
  poi: [],
};

// 道路只保留校区周边 300m 内的部分,超出 bbox 的长路按折线截断
const ROAD_MARGIN = 0.0027; // ≈300m
const roadBBox = {
  minLat: minLat - ROAD_MARGIN, maxLat: maxLat + ROAD_MARGIN,
  minLon: minLon - ROAD_MARGIN, maxLon: maxLon + ROAD_MARGIN,
};
function clipLineToBBox(coords) {
  const runs = [];
  let cur = [];
  for (const c of coords) {
    const inside =
      c[1] >= roadBBox.minLat && c[1] <= roadBBox.maxLat &&
      c[0] >= roadBBox.minLon && c[0] <= roadBBox.maxLon;
    if (inside) cur.push(c);
    else if (cur.length > 1) runs.push(cur);
    cur = inside ? cur : [];
  }
  if (cur.length > 1) runs.push(cur);
  return runs;
}

// Sutherland–Hodgman 多边形裁剪(对矩形凸裁剪窗),用于把超大面积的公园/林地面裁到周边范围
const CLIP_EDGES = [
  { axis: 0, limit: roadBBox.minLon, keep: (v, l) => v >= l },
  { axis: 0, limit: roadBBox.maxLon, keep: (v, l) => v <= l },
  { axis: 1, limit: roadBBox.minLat, keep: (v, l) => v >= l },
  { axis: 1, limit: roadBBox.maxLat, keep: (v, l) => v <= l },
];

function clipRingToBBox(ring) {
  let poly = ring;
  for (const { axis, limit, keep } of CLIP_EDGES) {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const cur = poly[i];
      const prev = poly[(i + poly.length - 1) % poly.length];
      const ci = keep(cur[axis], limit);
      const pi = keep(prev[axis], limit);
      const cross = () => {
        const t = (limit - prev[axis]) / (cur[axis] - prev[axis]);
        return [prev[0] + (cur[0] - prev[0]) * t, prev[1] + (cur[1] - prev[1]) * t];
      };
      if (ci) {
        if (!pi) out.push(cross());
        out.push(cur);
      } else if (pi) {
        out.push(cross());
      }
    }
    poly = out;
    if (poly.length < 3) return [];
  }
  return poly;
}

/** 裁剪 Polygon/MultiPolygon 到周边 bbox,返回裁剪后的 Polygon 数组(外环+内环) */
function clipPolygonGeometry(geom) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
  const outPolys = [];
  for (const rings of polys) {
    const outer = clipRingToBBox(rings[0]);
    if (outer.length < 3) continue;
    const clipped = [outer];
    for (let i = 1; i < rings.length; i++) {
      const hole = clipRingToBBox(rings[i]);
      if (hole.length >= 3) clipped.push(hole);
    }
    outPolys.push(clipped);
  }
  return outPolys;
}

function clippedGeom(geom) {
  const polys = clipPolygonGeometry(geom);
  if (!polys.length) return null;
  return polys.length === 1
    ? { type: 'Polygon', coordinates: polys[0] }
    : { type: 'MultiPolygon', coordinates: polys };
}

/** 多边形球面面积近似(平方米),用于大场地面判定 */
function polygonArea(geom) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  let total = 0;
  for (const rings of polys) {
    const r = rings[0];
    let a = 0;
    for (let i = 0; i < r.length - 1; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1];
    total += Math.abs(a / 2) * 111320 * 110540 * Math.cos((CENTER.lat * Math.PI) / 180);
  }
  return total;
}

const ROAD_CLASS = {
  major: ['primary', 'secondary', 'tertiary', 'trunk', 'primary_link', 'secondary_link', 'tertiary_link', 'trunk_link'],
  minor: ['residential', 'unclassified', 'service', 'living_street'],
  path: ['footway', 'path', 'pedestrian', 'steps', 'cycleway'],
};
function roadClass(hw) {
  for (const [cls, list] of Object.entries(ROAD_CLASS)) if (list.includes(hw)) return cls;
  return null;
}

const PITCH_KIND = {
  basketball: 'basketball', soccer: 'soccer', football: 'soccer',
  tennis: 'tennis', badminton: 'badminton', volleyball: 'volleyball',
  table_tennis: 'table_tennis', multi: 'multi', athletics: 'track', running: 'track',
};

for (const f of gj.features) {
  const p = f.properties;
  const geom = f.geometry;
  if (!geom) continue;

  // amenity=college 在本数据中用于标注 A 区教学楼建筑轮廓(而非 building=*)
  if ((p.building || p['building:part'] || p.amenity === 'college') && (geom.type === 'Polygon' || geom.type === 'MultiPolygon')) {
    layers.buildings.push({ type: 'Feature', geometry: geom, properties: classifyBuilding(f) });
    continue;
  }
  if (p.highway && geom.type === 'LineString') {
    const cls = roadClass(p.highway);
    if (cls) {
      const props = { cls, highway: p.highway, name: p.name, tunnel: p.tunnel ? 1 : undefined, bridge: p.bridge ? 1 : undefined };
      for (const run of clipLineToBBox(geom.coordinates)) {
        layers.roads.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: run }, properties: { ...props } });
      }
    }
    continue;
  }
  if (p.natural === 'water' && (geom.type === 'Polygon' || geom.type === 'MultiPolygon')) {
    const cg = clippedGeom(geom);
    if (cg) layers.water.push({ type: 'Feature', geometry: cg, properties: { name: p.name } });
    continue;
  }
  if ((p.landuse === 'grass' || p.natural === 'wood' || p.leisure === 'park' || p.leisure === 'garden') && (geom.type === 'Polygon' || geom.type === 'MultiPolygon')) {
    const cg = clippedGeom(geom);
    if (cg) layers.green.push({ type: 'Feature', geometry: cg, properties: { kind: p.natural === 'wood' ? 'wood' : p.landuse === 'grass' ? 'grass' : 'park', name: p.name } });
    continue;
  }
  if ((p.leisure === 'pitch' || p.leisure === 'track') && (geom.type === 'Polygon' || geom.type === 'MultiPolygon')) {
    const sport = Array.isArray(p.sport) ? p.sport[0] : p.sport;
    const cg = clippedGeom(geom);
    // 田径场围合区(无 sport 标签的大面积 multi 面)按跑道渲染
    let kind = PITCH_KIND[sport] || (p.leisure === 'track' ? 'track' : 'multi');
    if (kind === 'multi') {
      const area = polygonArea(geom);
      if (area > 10000) kind = 'track';
    }
    if (cg) layers.pitch.push({ type: 'Feature', geometry: cg, properties: { kind, name: p.name } });
    continue;
  }
  // 有名称的 sports_centre 视为场馆建筑(如"游泳馆 体育馆"未带 building 标签)
  if (p.leisure === 'sports_centre' && p.name && (geom.type === 'Polygon' || geom.type === 'MultiPolygon')) {
    layers.buildings.push({ type: 'Feature', geometry: geom, properties: classifyBuilding(f) });
    continue;
  }
  if (p.leisure === 'sports_centre' && (geom.type === 'Polygon' || geom.type === 'MultiPolygon')) {
    const cg = clippedGeom(geom);
    if (cg) layers.pitch.push({ type: 'Feature', geometry: cg, properties: { kind: 'multi', name: p.name } });
    continue;
  }
  if (p.amenity === 'university' && (geom.type === 'Polygon' || geom.type === 'MultiPolygon')) {
    layers.boundary.push({ type: 'Feature', geometry: geom, properties: { name: p.name, is_suse: f.id === suseBoundary.id ? 1 : undefined } });
    continue;
  }
  if (geom.type === 'Point' && p.name && (p.amenity || p.shop || p.highway === 'bus_stop' || p.leisure)) {
    layers.poi.push({ type: 'Feature', geometry: geom, properties: { name: p.name, kind: p.highway === 'bus_stop' ? 'bus' : p.amenity || p.shop || p.leisure, campus: inCampus(geom.coordinates[0], geom.coordinates[1]) ? 'suse' : 'other' } });
  }
}

// ---------- 5. 写文件 ----------
layers.pitch.push(...manualPitchFeatures());
layers.buildings.push(...manualBuildingFeatures());
// 中心广场
for (const p of MANUAL_PLAZAS) {
  const ring = [...p.ring.map(([x, z]) => wgsFromLocal(x, z)), wgsFromLocal(...p.ring[0])];
  layers.plaza.push({
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [ring] },
    properties: { kind: p.kind, name: p.name, manual: 1 },
  });
}
// 中轴步行道 → 道路层(axis 类)
for (const r of MANUAL_ROADS) {
  layers.roads.push({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: r.waypoints.map(([x, z]) => wgsFromLocal(x, z)) },
    properties: { cls: r.cls, highway: 'footway', name: '中轴步行道', manual: 1 },
  });
}
for (const g of MANUAL_GATES) {
  const [lon, lat] = wgsFromLocal(g.x, g.z);
  layers.poi.push({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lon, lat] },
    properties: { name: g.name, kind: 'gate', campus: 'suse', rot: g.rot, manual: 1 },
  });
}
mkdirSync(OUT_DIR, { recursive: true });
for (const [name, features] of Object.entries(layers)) {
  writeFileSync(resolve(OUT_DIR, `${name}.geojson`), JSON.stringify({ type: 'FeatureCollection', features }));
}
const meta = {
  center: CENTER,
  bbox: { minLat: +minLat.toFixed(6), maxLat: +maxLat.toFixed(6), minLon: +minLon.toFixed(6), maxLon: +maxLon.toFixed(6) },
  counts: Object.fromEntries(Object.entries(layers).map(([k, v]) => [k, v.length])),
  source: 'OpenStreetMap (Overpass API, 2024-12 数据,含 2026-09 补拉)',
};
writeFileSync(resolve(OUT_DIR, 'meta.json'), JSON.stringify(meta));

// ---------- 6. 统计报告 ----------
console.log('中心点:', CENTER, ' 校区 bbox:', meta.bbox);
console.log('各层要素数:', meta.counts);
console.log('\n--- 校区建筑清单(name | id | 类别 | 层数 | 高度m) ---');
const suseB = layers.buildings.filter((f) => f.properties.campus === 'suse');
for (const f of suseB) {
  const q = f.properties;
  console.log(`${q.name || '(未命名)'}\t${q.osm_id}\t${q.kind}\t${q.levels}\t${q.height_m}`);
}
console.log(`\n校区建筑 ${suseB.length} 栋,周边建筑 ${layers.buildings.length - suseB.length} 栋`);
console.log(`数据文件总大小: ${(Object.keys(layers).reduce((s, k) => s + JSON.stringify({ type: 'FeatureCollection', features: layers[k] }).length, 0) / 1024).toFixed(0)} KB`);
