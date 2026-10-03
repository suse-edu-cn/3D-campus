/**
 * 多校区数据管线:把 OSM 原始数据转换为渲染用分层 GeoJSON。
 * 用法: node scripts/build-data.mjs [campusId]   (缺省处理全部校区)
 *
 * 每个校区配置见 CAMPUS_CONFIG;手工校准设施来自 data/<campus>/manual.json
 * (场景编辑模式可导出更新)。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import osmtogeojson from 'osmtogeojson';
import { DOMParser } from '@xmldom/xmldom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ---------- 校区配置 ----------
const CAMPUS_CONFIG = {
  yibin: {
    name: '宜宾校区',
    raw: resolve(ROOT, 'data/yibin/raw/campus-full.osm'),
    manual: resolve(ROOT, 'data/yibin/manual.json'),
    outDir: resolve(ROOT, 'public/data/yibin'),
    boundaryMatch: (name) => name.includes('四川轻化工大学宜宾校区'),
    camera: { pos: [120, 480, 820], target: [0, 0, -120] },
    // 西华大学的实训厂房 A/B(用户实地指正)
    excludeIds: new Set(['way/723632028', 'way/723632029']),
    // 逐栋校准(OSM id 键)
    overrides: {
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
    },
  },
  libaihe: {
    name: '李白河校区',
    raw: resolve(ROOT, 'data/libaihe/raw/campus.osm'),
    manual: resolve(ROOT, 'data/libaihe/manual.json'),
    outDir: resolve(ROOT, 'public/data/libaihe'),
    boundaryMatch: (name) => name.includes('四川轻化工大学'),
    camera: { pos: [120, 480, 820], target: [0, 0, -120] },
    // 3#公共教学楼:用户指正删除;南大门:改为门楼结构(见 manual.json gates)
    excludeIds: new Set(['way/797032821', 'way/797032806']),
    overrides: {
      // —— 命名以官方示意图为准 ——
      'way/797032811': { name: '图书馆', levels: 5, floor: 5.6, desc: '图书馆(含综合楼),校区地标' },
      'way/797032810': { name: '图书馆(附楼)', levels: 3, floor: 4.5 },
      'way/797032812': { name: '', levels: 2 },
      'way/797032833': { name: '雅韵楼(音乐学院)', levels: 5 },
      'relation/11041600': { name: '尚美楼(美术学院)', levels: 5 },
      'way/797032809': { name: '体育馆·游泳馆', kind: 'gym', height: 20 },
      'way/797032803': { name: '德馨苑1#', kind: 'dormitory' },
      'way/797032799': { name: '德馨苑2#', kind: 'dormitory' },
      'way/797032797': { name: '德馨苑3#', kind: 'dormitory' },
      'way/797032791': { name: '德馨苑4#', kind: 'dormitory' },
      'way/797032793': { name: '德馨苑5#', kind: 'dormitory' },
      'way/797032849': { name: '艺雅苑1#', kind: 'dormitory', levels: 11, floor: 3.6 },
      'way/797032905': { name: '艺雅苑2#', kind: 'dormitory' },
      'way/797032910': { name: '艺雅食府', kind: 'canteen' },
      'way/797032788': { name: '德馨食府', kind: 'canteen' },
      'way/797032786': { name: '后勤服务中心', kind: 'office' },
      'relation/11041594': { name: '盐都大剧院(含音乐厅)', kind: 'hall', levels: 4, floor: 5.0 },
      'relation/11041601': { name: '鸿远楼', kind: 'office', levels: 5 },
      'way/797032832': { name: '尚艺馆', kind: 'teaching', levels: 2, floor: 4.5 },
      'relation/11041599': { name: '敏行楼', kind: 'teaching', levels: 3, floor: 4.5 },
      'relation/11041598': { name: '博学楼', kind: 'teaching', levels: 4, floor: 4.5 },
      'way/797032824': { name: '博约楼', kind: 'teaching', levels: 4, floor: 4.5 },
      'relation/11041596': { name: '清源楼', kind: 'teaching', levels: 3, floor: 4.5 },
      'relation/11041597': { name: '远韵楼', kind: 'teaching', levels: 4, floor: 4.5 },
    },
  },
};

const CAMPUS_IDS = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const campusList = CAMPUS_IDS.length ? CAMPUS_IDS : Object.keys(CAMPUS_CONFIG);

// ---------- 通用工具 ----------
const MLAT = 110540;

function centroidOf(feature) {
  const g = feature.geometry;
  const ring = g.type === 'Polygon' ? g.coordinates[0] : g.type === 'MultiPolygon' ? g.coordinates[0][0] : null;
  if (!ring) return { lon: NaN, lat: NaN };
  let lon = 0, lat = 0;
  for (const p of ring) { lon += p[0]; lat += p[1]; }
  return { lon: lon / ring.length, lat: lat / ring.length };
}

function classifyBuildingName(name) {
  const patterns = [
    [/食堂|食府|令雅|器美|静苑/, 'canteen'],
    [/图书馆/, 'library'],
    [/游泳馆|体育馆|院馆|风雨操场/, 'gym'],
    [/实训|厂房|工坊/, 'factory'],
    [/宿舍|育秀苑|留学生|公寓|^B\d|苑\d|^A区|^B区|^C区/, 'dormitory'],
    [/剧院|音乐厅|报告厅|艺术馆/, 'hall'],
    [/实验|基础化学|中试|工程实践|酿酒生物/, 'lab'],
    [/服务中心|办公/, 'office'],
    [/学院|教|楼/, 'teaching'],
  ];
  for (const [re, k] of patterns) if (re.test(name)) return k;
  return null;
}

// ---------- 单校区处理 ----------
function buildCampus(id, cfg) {
  console.log(`\n===== ${id}(${cfg.name}) =====`);
  const xml = readFileSync(cfg.raw, 'utf8');
  const gj = osmtogeojson(new DOMParser().parseFromString(xml, 'text/xml'));

  // 校园边界
  const boundary = gj.features.find(
    (f) => f.properties.amenity === 'university' && cfg.boundaryMatch(f.properties.name || ''),
  );
  if (!boundary) throw new Error(`${id}: 未找到校园边界面`);

  const boundRing = boundary.geometry.type === 'Polygon' ? boundary.geometry.coordinates[0] : boundary.geometry.coordinates[0][0];
  let minLon = 180, minLat = 90, maxLon = -180, maxLat = -90;
  for (const [lon, lat] of boundRing) {
    minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
    minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
  }
  const CENTER = {
    lon: +(((minLon + maxLon) / 2).toFixed(6)),
    lat: +(((minLat + maxLat) / 2).toFixed(6)),
  };
  const M_PER_DEG_LON = 111320 * Math.cos((CENTER.lat * Math.PI) / 180);

  function inCampus(lon, lat) {
    let inside = false;
    for (let i = 0, j = boundRing.length - 1; i < boundRing.length; j = i++) {
      const [xi, yi] = boundRing[i];
      const [xj, yj] = boundRing[j];
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  // 道路/面要素裁剪窗:边界外扩 300m
  const M = 0.0027;
  const clip = { minLat: minLat - M, maxLat: maxLat + M, minLon: minLon - M, maxLon: maxLon + M };
  const CLIP_EDGES = [
    { axis: 0, limit: clip.minLon, keep: (v, l) => v >= l },
    { axis: 0, limit: clip.maxLon, keep: (v, l) => v <= l },
    { axis: 1, limit: clip.minLat, keep: (v, l) => v >= l },
    { axis: 1, limit: clip.maxLat, keep: (v, l) => v <= l },
  ];
  function clipRing(ring) {
    let poly = ring;
    for (const { axis, limit, keep } of CLIP_EDGES) {
      const out = [];
      for (let i = 0; i < poly.length; i++) {
        const cur = poly[i], prev = poly[(i + poly.length - 1) % poly.length];
        const ci = keep(cur[axis], limit), pi = keep(prev[axis], limit);
        const cross = () => {
          const t = (limit - prev[axis]) / (cur[axis] - prev[axis]);
          return [prev[0] + (cur[0] - prev[0]) * t, prev[1] + (cur[1] - prev[1]) * t];
        };
        if (ci) { if (!pi) out.push(cross()); out.push(cur); }
        else if (pi) out.push(cross());
      }
      poly = out;
      if (poly.length < 3) return [];
    }
    return poly;
  }
  function clipPolygonGeometry(geom) {
    const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
    const outPolys = [];
    for (const rings of polys) {
      const outer = clipRing(rings[0]);
      if (outer.length < 3) continue;
      const clipped = [outer];
      for (let i = 1; i < rings.length; i++) {
        const hole = clipRing(rings[i]);
        if (hole.length >= 3) clipped.push(hole);
      }
      outPolys.push(clipped);
    }
    return outPolys;
  }
  function clippedGeom(geom) {
    const polys = clipPolygonGeometry(geom);
    if (!polys.length) return null;
    return polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys };
  }
  function clipLine(coords) {
    const runs = [];
    let cur = [];
    for (const c of coords) {
      const inside = c[1] >= clip.minLat && c[1] <= clip.maxLat && c[0] >= clip.minLon && c[0] <= clip.maxLon;
      if (inside) cur.push(c);
      else if (cur.length > 1) runs.push(cur);
      cur = inside ? cur : [];
    }
    if (cur.length > 1) runs.push(cur);
    return runs;
  }

  // 建筑分类
  const KIND_DEFAULTS = {
    teaching: { levels: 5, floor: 4.0 },
    dormitory: { levels: 6, floor: 3.3 },
    canteen: { levels: 2, floor: 4.5 },
    library: { levels: 5, floor: 5.0 },
    gym: { levels: 2, height: 13 },
    factory: { levels: 1, height: 9 },
    lab: { levels: 4, floor: 4.0 },
    hall: { levels: 3, floor: 4.5 },
    office: { levels: 5, floor: 3.6 },
    service: { levels: 1, floor: 4.0 },
    other: { levels: 4, floor: 3.4 },
  };
  function classifyBuilding(f) {
    const p = f.properties;
    const name = p.name || p['name:zh'] || '';
    const ov = cfg.overrides[f.id] || {};
    let kind = ov.kind;
    if (!kind) kind = classifyBuildingName(name);
    if (!kind) kind = p.building === 'dormitory' ? 'dormitory' : 'other';
    const def = KIND_DEFAULTS[kind];
    const levels = ov.levels ?? (p['building:levels'] ? +p['building:levels'] : def.levels);
    const height = ov.height ?? def.height ?? +(levels * (ov.floor ?? def.floor)).toFixed(1);
    return { osm_id: f.id, name: ov.name ?? (name || undefined), campus: 'suse', kind, levels, height_m: height, desc: ov.desc };
  }

  const layers = { buildings: [], roads: [], water: [], green: [], pitch: [], boundary: [], poi: [] };
  const PITCH_KIND = {
    basketball: 'basketball', soccer: 'soccer', football: 'soccer', tennis: 'tennis',
    badminton: 'badminton', volleyball: 'volleyball', table_tennis: 'table_tennis',
    multi: 'multi', athletics: 'track', running: 'track',
  };
  const ROAD_CLASS = {
    major: ['primary', 'secondary', 'tertiary', 'trunk', 'primary_link', 'secondary_link', 'tertiary_link', 'trunk_link'],
    minor: ['residential', 'unclassified', 'service', 'living_street'],
    path: ['footway', 'path', 'pedestrian', 'steps', 'cycleway'],
  };
  function roadClass(hw) {
    for (const [cls, list] of Object.entries(ROAD_CLASS)) if (list.includes(hw)) return cls;
    return null;
  }
  const cLonLat = centroidOf(boundary);
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

  for (const f of gj.features) {
    const p = f.properties;
    const geom = f.geometry;
    if (!geom) continue;

    if ((p.building || p['building:part'] || p.amenity === 'college') && (geom.type === 'Polygon' || geom.type === 'MultiPolygon')) {
      if (cfg.excludeIds.has(f.id)) continue;
      // 校区外建筑不渲染(李白河校区的 K12 等邻校设施随边界过滤)
      const c = centroidOf(f);
      if (!inCampus(c.lon, c.lat)) continue;
      layers.buildings.push({ type: 'Feature', geometry: geom, properties: classifyBuilding(f) });
      continue;
    }
    if (p.highway && geom.type === 'LineString') {
      const cls = roadClass(p.highway);
      if (cls) {
        const props = { cls, highway: p.highway, name: p.name, tunnel: p.tunnel ? 1 : undefined };
        for (const run of clipLine(geom.coordinates)) {
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
      let kind = PITCH_KIND[sport] || (p.leisure === 'track' ? 'track' : 'multi');
      if (kind === 'multi' && polygonArea(geom) > 10000) kind = 'track';
      if (cg) layers.pitch.push({ type: 'Feature', geometry: cg, properties: { kind, name: p.name } });
      continue;
    }
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
      layers.boundary.push({ type: 'Feature', geometry: geom, properties: { name: p.name, is_suse: f.id === boundary.id ? 1 : undefined } });
      continue;
    }
    if (geom.type === 'Point' && p.name && (p.amenity || p.shop || p.highway === 'bus_stop' || p.leisure)) {
      layers.poi.push({
        type: 'Feature', geometry: geom,
        properties: { name: p.name, kind: p.highway === 'bus_stop' ? 'bus' : p.amenity || p.shop || p.leisure, campus: 'suse' },
      });
    }
  }
  // 命名场馆(leisure=sports_centre)归类到 gym
  for (const b of layers.buildings) if (!b.properties.kind) b.properties.kind = 'other';

  // ---------- 写文件 ----------
  mkdirSync(cfg.outDir, { recursive: true });
  for (const [name, features] of Object.entries(layers)) {
    writeFileSync(resolve(cfg.outDir, `${name}.geojson`), JSON.stringify({ type: 'FeatureCollection', features }));
  }
  let manual = { gates: [], pitches: [], buildings: [], plazas: [], roads: [], labelOverrides: {} };
  if (existsSync(cfg.manual)) manual = { ...manual, ...JSON.parse(readFileSync(cfg.manual, 'utf8')) };
  manual.labelOverrides = manual.labelOverrides ?? {};
  writeFileSync(resolve(cfg.outDir, 'manual.json'), JSON.stringify(manual));

  const meta = {
    campus: id,
    name: cfg.name,
    center: CENTER,
    bbox: { minLat: +minLat.toFixed(6), maxLat: +maxLat.toFixed(6), minLon: +minLon.toFixed(6), maxLon: +maxLon.toFixed(6) },
    camera: cfg.camera,
    counts: Object.fromEntries(Object.entries(layers).map(([k, v]) => [k, v.length])),
    source: 'OpenStreetMap (Overpass API)',
  };
  writeFileSync(resolve(cfg.outDir, 'meta.json'), JSON.stringify(meta));
  console.log(`中心: ${CENTER.lon},${CENTER.lat}  各层:`, meta.counts);
}

// ---------- 注册表 ----------
const registry = campusList.map((id) => {
  const cfg = CAMPUS_CONFIG[id];
  if (!cfg) throw new Error(`未知校区: ${id}`);
  buildCampus(id, cfg);
  return { id, name: cfg.name, camera: cfg.camera };
});
const OUT_ROOT = resolve(ROOT, 'public/data');
mkdirSync(OUT_ROOT, { recursive: true });
writeFileSync(resolve(OUT_ROOT, 'campuses.json'), JSON.stringify({ campuses: registry }));
console.log(`\n✓ campus 注册表已写入 ${OUT_ROOT}/campuses.json(${registry.length} 个校区)`);
