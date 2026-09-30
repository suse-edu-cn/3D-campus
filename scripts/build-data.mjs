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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

/** 校区边界 bbox 外扩 150m 的粗包围盒(过滤周边他校场地) */
const CAMPUS_BBOX_MARGIN = 0.00135;
function inCampusBBox(lon, lat) {
  return lon >= minLon - CAMPUS_BBOX_MARGIN && lon <= maxLon + CAMPUS_BBOX_MARGIN &&
         lat >= minLat - CAMPUS_BBOX_MARGIN && lat <= maxLat + CAMPUS_BBOX_MARGIN;
}

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

// ---------- 3.1 手工设施:来源 data/manual.json(编辑模式可导出更新) ----------
// 场景直接读取该文件构建校门/网球场/室内馆/广场/中轴步道,
// 不再混入 GeoJSON 图层,便于在编辑模式中独立拖拽修改。
let MANUAL = {
  gates: [], pitches: [], buildings: [], plazas: [], roads: [],
};
const MANUAL_PATH = resolve(ROOT, 'data/manual.json');
if (existsSync(MANUAL_PATH)) {
  MANUAL = JSON.parse(readFileSync(MANUAL_PATH, 'utf8'));
}

// ---------- 4. 图层拆分 ----------
const layers = {
  buildings: [],
  roads: [],
  water: [],
  green: [],
  pitch: [],
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
    const props = classifyBuilding(f);
    // 只保留四川轻化工大学宜宾校区内的建筑,周边邻校/城市建筑不渲染
    if (props.campus === 'suse') {
      layers.buildings.push({ type: 'Feature', geometry: geom, properties: props });
    }
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
    if (cg) {
      const outer = cg.type === 'Polygon' ? cg.coordinates[0] : cg.coordinates[0][0];
      let clon = 0, clat = 0;
      for (const pt of outer) { clon += pt[0]; clat += pt[1]; }
      clon /= outer.length; clat /= outer.length;
      if (inCampusBBox(clon, clat)) {
        layers.pitch.push({ type: 'Feature', geometry: cg, properties: { kind, name: p.name } });
      }
    }
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
mkdirSync(OUT_DIR, { recursive: true });
// 手工设施清单同步给前端(编辑模式的数据源)
writeFileSync(resolve(OUT_DIR, 'manual.json'), JSON.stringify(MANUAL));
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
