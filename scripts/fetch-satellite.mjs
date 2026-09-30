/**
 * 拉取高德卫星瓦片并拼接为校园地面纹理(z18,约 0.52m/像素)。
 *
 * 覆盖范围与道路层一致:校区 bbox 向四周外扩 300m。
 * 产出:
 *   public/assets/satellite-ground.webp  地面纹理
 *   public/assets/satellite-meta.json    对齐用 bbox(WGS-84)与元信息
 *
 * 坐标系说明:瓦片为 GCJ-02 偏移影像。按「WGS bbox 四角 → GCJ」取瓦片,
 * 再把纹理贴回同一 WGS bbox,即完成偏移校正(校区尺度内 GCJ 偏移变化 <5m,按常量处理)。
 *
 * 用法: npm run data:satellite   (已生成后无需重复执行)
 *
 * ⚠️ 版权提示:高德影像仅限个人学习/演示使用,公开部署前请确认许可或替换为已授权影像源。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '../public/assets');

const LAT0 = 28.808876, LON0 = 104.668727;
const MLAT = 110540, MLON = 111320 * Math.cos((LAT0 * Math.PI) / 180);
const PI = Math.PI, A = 6378245.0, EE = 0.00669342162296594326;

function tLat(x, y) {
  let r = -100 + 2*x + 3*y + 0.2*y*y + 0.1*x*y + 0.2*Math.sqrt(Math.abs(x));
  r += (20*Math.sin(6*x*PI)+20*Math.sin(2*x*PI))*2/3;
  r += (20*Math.sin(y*PI)+40*Math.sin(y/3*PI))*2/3;
  r += (160*Math.sin(y/12*PI)+320*Math.sin(y*PI/30))*2/3;
  return r;
}
function tLon(x, y) {
  let r = 300 + x + 2*y + 0.1*x*x + 0.1*x*y + 0.1*Math.sqrt(Math.abs(x));
  r += (20*Math.sin(6*x*PI)+20*Math.sin(2*x*PI))*2/3;
  r += (20*Math.sin(x*PI)+40*Math.sin(x/3*PI))*2/3;
  r += (150*Math.sin(x/12*PI)+300*Math.sin(x/30*PI))*2/3;
  return r;
}
function wgs2gcj(lon, lat) {
  const dLat = tLat(lon-105, lat-35), dLon = tLon(lon-105, lat-35);
  const rad = lat/180*PI;
  let m = Math.sin(rad); m = 1 - EE*m*m;
  const s = Math.sqrt(m);
  return [lon + dLon*180/((A/s)*Math.cos(rad)*PI), lat + dLat*180/((A*(1-EE))/(m*s)*PI)];
}

// ---- 目标 WGS bbox(校区 + 300m,与 build-data.mjs 的 roadBBox 一致) ----
// 校区边界 bbox(来自 meta.json):lat 28.80271~28.815043, lon 104.662569~104.674885
const BBOX = {
  minLon: 104.662569 - 0.0027, maxLon: 104.674885 + 0.0027,
  minLat: 28.80271 - 0.0027, maxLat: 28.815043 + 0.0027,
};

const Z = 18;
const TILE = 256;
const CONCURRENCY = 8;

function gcj2tilePx(lon, lat) {
  const n = 2 ** Z;
  const x = ((lon + 180) / 360) * n;
  const r = (lat * PI) / 180;
  const y = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / PI) / 2) * n;
  return [x * TILE, y * TILE];
}

// GCJ bbox(把 WGS 四角转 GCJ 后取包络)
const gcjCorners = [
  wgs2gcj(BBOX.minLon, BBOX.minLat), wgs2gcj(BBOX.maxLon, BBOX.maxLat),
  wgs2gcj(BBOX.minLon, BBOX.maxLat), wgs2gcj(BBOX.maxLon, BBOX.minLat),
];
const gcjPx = gcjCorners.map(([lo, la]) => gcj2tilePx(lo, la));
const pxMinX = Math.min(...gcjPx.map((p) => p[0]));
const pxMaxX = Math.max(...gcjPx.map((p) => p[0]));
const pxMinY = Math.min(...gcjPx.map((p) => p[1]));
const pxMaxY = Math.max(...gcjPx.map((p) => p[1]));
const tx0 = Math.floor(pxMinX / TILE), tx1 = Math.floor(pxMaxX / TILE);
const ty0 = Math.floor(pxMinY / TILE), ty1 = Math.floor(pxMaxY / TILE);
const gridW = (tx1 - tx0 + 1) * TILE, gridH = (ty1 - ty0 + 1) * TILE;
console.log(`瓦片网格 x∈[${tx0},${tx1}] y∈[${ty0},${ty1}] → ${gridW}×${gridH}px`);

// 并发拉取
const jobs = [];
for (let ty = ty0; ty <= ty1; ty++) {
  for (let tx = tx0; tx <= tx1; tx++) jobs.push([tx, ty]);
}
const tiles = new Map();
let done = 0, failed = 0;
async function worker() {
  while (jobs.length) {
    const [tx, ty] = jobs.shift();
    const sub = 1 + ((tx + ty) % 4);
    const url = `https://webst0${sub}.is.autonavi.com/appmaptile?style=6&x=${tx}&y=${ty}&z=${Z}`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      tiles.set(`${tx},${ty}`, Buffer.from(await res.arrayBuffer()));
    } catch (err) {
      failed++;
      console.warn(`瓦片 ${tx},${ty} 失败: ${err.message}`);
    }
    done++;
    if (done % 40 === 0) console.log(`  ${done}/${jobs.length + done} ...`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log(`拉取完成: ${tiles.size} 成功, ${failed} 失败`);

// 拼接
const comps = [...tiles.entries()].map(([k, buf]) => {
  const [tx, ty] = k.split(',').map(Number);
  return { input: buf, left: (tx - tx0) * TILE, top: (ty - ty0) * TILE };
});
const stitched = sharp({
  create: { width: gridW, height: gridH, channels: 3, background: '#224422' },
}).composite(comps).png();

// 裁剪到 GCJ bbox 精确范围
const cropLeft = Math.round(pxMinX - tx0 * TILE);
const cropTop = Math.round(pxMinY - ty0 * TILE);
const cropW = Math.round(pxMaxX - pxMinX);
const cropH = Math.round(pxMaxY - pxMinY);
const cropped = stitched.extract({ left: cropLeft, top: cropTop, width: cropW, height: cropH });

mkdirSync(OUT_DIR, { recursive: true });
const outPath = resolve(OUT_DIR, 'satellite-ground.webp');
await cropped.webp({ quality: 82 }).toFile(outPath);
const meta = {
  zoom: Z,
  bbox: BBOX, // 纹理四边对应的 WGS-84 经纬度(已含 GCJ 校正)
  width: cropW,
  height: cropH,
  mPerPx: (156543.03392 * Math.cos((LAT0 * PI) / 180)) / 2 ** Z,
  source: '高德卫星影像(GCJ-02 已校正到 WGS-84,仅供学习演示)',
};
writeFileSync(resolve(OUT_DIR, 'satellite-meta.json'), JSON.stringify(meta));
console.log(`✓ ${outPath} (${cropW}×${cropH})`);
