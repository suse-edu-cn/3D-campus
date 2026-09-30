/**
 * 用高德 POI 搜索交叉验证校区球场设施(OSM 缺口排查)。
 *
 * 高德使用 GCJ-02 坐标系,OSM 使用 WGS-84,脚本内置互转。
 * key 从环境变量 AMAP_KEY 读取(存放在 .env.local,已 gitignore):
 *   node --env-file=.env.local scripts/amap-check.mjs
 */
const API = 'https://restapi.amap.com/v3';

// 校区中心(WGS-84,与 public/data/meta.json 一致)
const CENTER_WGS = { lon: 104.668727, lat: 28.808876 };

// ---------- GCJ-02 <-> WGS-84 ----------
const PI = Math.PI;
const A = 6378245.0;
const EE = 0.00669342162296594326;

function transformLat(x, y) {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(y * PI) + 40.0 * Math.sin((y / 3.0) * PI)) * 2.0) / 3.0;
  ret += ((160.0 * Math.sin((y / 12.0) * PI) + 320 * Math.sin((y * PI) / 30.0)) * 2.0) / 3.0;
  return ret;
}
function transformLon(x, y) {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(x * PI) + 40.0 * Math.sin((x / 3.0) * PI)) * 2.0) / 3.0;
  ret += ((150.0 * Math.sin((x / 12.0) * PI) + 300.0 * Math.sin((x / 30.0) * PI)) * 2.0) / 3.0;
  return ret;
}
function wgs84ToGcj02(lon, lat) {
  const dLat = transformLat(lon - 105.0, lat - 35.0);
  const dLon = transformLon(lon - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  return [
    lon + (dLon * 180.0) / ((A / sqrtMagic) * Math.cos(radLat) * PI),
    lat + (dLat * 180.0) / (((A * (1 - EE)) / (magic * sqrtMagic)) * PI),
  ];
}
function gcj02ToWgs84(lon, lat) {
  const [glon, glat] = wgs84ToGcj02(lon, lat);
  return [lon * 2 - glon, lat * 2 - glat]; // 一次迭代近似,误差约 1-2m
}

// ---------- 局部米制投影(与 src/data/projection.ts 相同) ----------
const MLAT = 110540;
const MLON = 111320 * Math.cos((CENTER_WGS.lat * PI) / 180);
const toLocal = (lon, lat) => [(lon - CENTER_WGS.lon) * MLON, -(lat - CENTER_WGS.lat) * MLAT];

// ---------- 搜索 ----------
async function aroundSearch(keywords) {
  const [glon, glat] = wgs84ToGcj02(CENTER_WGS.lon, CENTER_WGS.lat);
  const url = new URL(`${API}/place/around`);
  url.searchParams.set('key', process.env.AMAP_KEY);
  url.searchParams.set('location', `${glon.toFixed(6)},${glat.toFixed(6)}`);
  url.searchParams.set('keywords', keywords);
  url.searchParams.set('radius', '2500');
  url.searchParams.set('offset', '25');
  url.searchParams.set('page', '1');
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  const json = await res.json();
  if (json.status !== '1') throw new Error(`高德 API 错误: ${json.info}`);
  return json.pois || [];
}

const KEYWORDS = ['网球场', '羽毛球场', '篮球场', '排球场', '田径场', '游泳池', '足球场', '门球场'];

const seen = new Map();
for (const kw of KEYWORDS) {
  try {
    const pois = await aroundSearch(kw);
    for (const p of pois) {
      const [glon, glat] = p.location.split(',').map(Number);
      const [wlon, wlat] = gcj02ToWgs84(glon, glat);
      const [x, z] = toLocal(wlon, wlat);
      // 只保留校区周边 1.4km 内的
      if (Math.abs(x) > 1400 || Math.abs(z) > 1400) continue;
      const key = p.id;
      if (!seen.has(key)) seen.set(key, { name: p.name, address: p.address, type: p.type, x: Math.round(x), z: Math.round(z) });
    }
  } catch (err) {
    console.warn(`「${kw}」搜索失败: ${err.message}`);
  }
  await new Promise((r) => setTimeout(r, 300)); // 控制请求频率
}

console.log('=== 高德 POI(已转 WGS-84 局部米制坐标,x 东 z 南)===');
const sorted = [...seen.values()].sort((a, b) => a.z - b.z || a.x - b.x);
for (const p of sorted) {
  console.log(`(${String(p.x).padStart(5)},${String(p.z).padStart(5)})  ${p.name}  [${p.type}]  ${p.address || ''}`);
}
console.log(`\n共 ${sorted.length} 个 POI`);
