/**
 * 从高德卫星瓦片中检测球场(蓝色硬地球场等)的精确位置与尺寸。
 * 用法: node scripts/detect-courts.mjs [x1 z1 x2 z2]  (局部米制检测窗,默认西侧球场区)
 * 输出: 检测到的场地外接矩形(已按校园网格角度回正)与中心坐标。
 */
import sharp from 'sharp';

// ---- 常量(与 projection/config 同步) ----
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
const local2wgs = (x, z) => [LON0 + x/MLON, LAT0 - z/MLAT];
const local2gcj = (x, z) => wgs2gcj(...local2wgs(x, z));

// ---- 检测窗(默认:西侧球场区) ----
const [X1, Z1, X2, Z2] = process.argv.slice(2).map(Number).length >= 4
  ? process.argv.slice(2, 6).map(Number)
  : [-560, -110, -430, 70];
const Z18 = 18;
const M_PER_PX = (156543.03392 * Math.cos((LAT0 * PI) / 180)) / 2 ** Z18;
const TILE = 256;

// 检测窗四角 → GCJ 像素坐标
const cornersGCJ = [
  local2gcj(Math.min(X1, X2), Math.min(Z1, Z2)),
  local2gcj(Math.max(X1, X2), Math.max(Z1, Z2)),
];
const pxs = cornersGCJ.map(([lon, lat]) => {
  const n = 2 ** Z18;
  const tx = ((lon + 180) / 360) * n, r = (lat * PI) / 180;
  const ty = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / PI) / 2) * n;
  return [tx * TILE, ty * TILE];
});
const minX = Math.floor(Math.min(...pxs.map((p) => p[0])) / TILE);
const maxX = Math.floor(Math.max(...pxs.map((p) => p[0])) / TILE);
const minY = Math.floor(Math.min(...pxs.map((p) => p[1])) / TILE);
const maxY = Math.floor(Math.max(...pxs.map((p) => p[1])) / TILE);
const W = (maxX - minX + 1) * TILE, H = (maxY - minY + 1) * TILE;
console.log(`拉取 z18 瓦片 x∈[${minX},${maxX}] y∈[${minY},${maxY}] → ${W}×${H}px`);

// 拉取并拼接
const comps = [];
for (let ty = minY; ty <= maxY; ty++) {
  for (let tx = minX; tx <= maxX; tx++) {
    const sub = 1 + ((tx + ty) % 4);
    const url = `https://webst0${sub}.is.autonavi.com/appmaptile?style=6&x=${tx}&y=${ty}&z=${Z18}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`瓦片 ${tx},${ty} HTTP ${res.status}`);
    comps.push({
      input: Buffer.from(await res.arrayBuffer()),
      left: (tx - minX) * TILE,
      top: (ty - minY) * TILE,
    });
    await new Promise((r) => setTimeout(r, 40));
  }
}
const img = sharp({ create: { width: W, height: H, channels: 3, background: '#000' } })
  .composite(comps);
const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
const CH = info.channels;
console.log(`拼接完成 ${info.width}×${info.height} 通道数=${CH}`);
const stride = info.width * CH;

// 像素 → 局部米制(GCJ 像素坐标基准)
const [gcjMinLon] = (() => { // 左上角像素的 GCJ 经度
  const n = 2 ** Z18;
  return [(minX * TILE / n) * 360 - 180];
})();
const leftTopGCJ = { px: minX * TILE, py: minY * TILE };
function px2local(pxX, pxY) {
  // 像素 → GCJ lon/lat
  const n = 2 ** Z18;
  const glon = ((leftTopGCJ.px + pxX) / TILE / n) * 360 - 180;
  const py = leftTopGCJ.py + pxY;
  const g = 1 - 2 * (py / TILE / n);
  const glat = (Math.atan(Math.sinh(PI * g)) * 180) / PI;
  // GCJ → WGS(一次近似) → 局部米
  const [dlonRef, dlatRef] = wgs2gcj(LON0, LAT0);
  const wlon = glon - (dlonRef - LON0), wlat = glat - (dlatRef - LAT0);
  return [(wlon - LON0) * MLON, -(wlat - LAT0) * MLAT];
}

// 蓝色球场像素检测(亮蓝硬地,排除湖面深蓝)
const mask = new Uint8Array(info.width * info.height);
let count = 0;
for (let i = 0; i < info.width * info.height; i++) {
  const r = data[i * CH], g = data[i * CH + 1], b = data[i * CH + 2];
  if (b > 85 && b > r + 12 && b > g + 8) { mask[i] = 1; count++; }
}
console.log(`蓝色像素: ${count} (${((count / (info.width * info.height)) * 100).toFixed(2)}%)`);

// 连通域(BFS,4 邻接)
const Wp = info.width, Hp = info.height;
const label = new Int32Array(Wp * Hp).fill(0);
const boxes = [];
const queue = new Int32Array(Wp * Hp);
for (let start = 0; start < Wp * Hp; start++) {
  if (!mask[start] || label[start]) continue;
  const id = boxes.length + 1;
  let qh = 0, qt = 0;
  queue[qt++] = start;
  label[start] = id;
  let minXp = Wp, maxXp = 0, minYp = Hp, maxYp = 0, n = 0;
  let sumX = 0, sumY = 0, sumXX = 0, sumYY = 0, sumXY = 0;
  while (qh < qt) {
    const idx = queue[qh++];
    const x = idx % Wp, y = (idx / Wp) | 0;
    n++;
    sumX += x; sumY += y;
    sumXX += x * x; sumYY += y * y; sumXY += x * y;
    if (x < minXp) minXp = x; if (x > maxXp) maxXp = x;
    if (y < minYp) minYp = y; if (y > maxYp) maxYp = y;
    for (const d of [idx - 1, idx + 1, idx - Wp, idx + Wp]) {
      if (d < 0 || d >= Wp * Hp || label[d] || !mask[d]) continue;
      if ((d === idx - 1 && x === 0) || (d === idx + 1 && x === Wp - 1)) continue;
      label[d] = id; queue[qt++] = d;
    }
  }
  const areaM2 = n * M_PER_PX * M_PER_PX;
  if (areaM2 < 60) continue; // 过滤噪点
  if (n / ((maxXp - minXp + 1) * (maxYp - minYp + 1)) < 0.15) continue; // 细条纹过滤
  // PCA 求主方向
  const mx = sumX / n, my = sumY / n;
  const cxx = sumXX / n - mx * mx, cyy = sumYY / n - my * my, cxy = sumXY / n - mx * my;
  const theta = 0.5 * Math.atan2(2 * cxy, cxx - cyy); // 主轴角(像素系,y 向下)
  const [c1x, c1y] = px2local(minXp, minYp);
  const [c2x, c2y] = px2local(maxXp, maxYp);
  boxes.push({
    areaM2: Math.round(areaM2),
    center: [Math.round((c1x + c2x) / 2), Math.round((c1y + c2y) / 2)],
    aabb: [c1x, c1y, c2x, c2y].map((v) => Math.round(v)),
    thetaDeg: +(theta * 180 / PI).toFixed(1),
    pixels: n,
  });
}
boxes.sort((a, b) => b.areaM2 - a.areaM2);
console.log(`\n检测到 ${boxes.length} 个蓝色场地连通域:`);
for (const b of boxes) {
  console.log(
    `中心(${b.center[0]},${b.center[1]}) 面积${b.areaM2}m² 主轴角${b.thetaDeg}° AABB=[${b.aabb}] px=${b.pixels}`,
  );
}

// 聚类:中心间距 < 35m 的连通域合并为场地簇
const clusters = [];
for (const b of boxes) {
  const near = clusters.find((c) => {
    const dx = c.cx - b.center[0], dz = c.cz - b.center[1];
    return Math.hypot(dx, dz) < 35;
  });
  if (near) {
    near.members.push(b);
    near.cx = near.members.reduce((s, m) => s + m.center[0], 0) / near.members.length;
    near.cz = near.members.reduce((s, m) => s + m.center[1], 0) / near.members.length;
    near.area += b.areaM2;
    near.x1 = Math.min(near.x1, b.aabb[0]); near.z1 = Math.min(near.z1, b.aabb[1]);
    near.x2 = Math.max(near.x2, b.aabb[2]); near.z2 = Math.max(near.z2, b.aabb[3]);
  } else {
    clusters.push({ cx: b.center[0], cz: b.center[1], area: b.areaM2, members: [b], x1: b.aabb[0], z1: b.aabb[1], x2: b.aabb[2], z2: b.aabb[3] });
  }
}
console.log(`\n=== 场地簇(聚类后)===`);
for (const c of clusters) {
  const w = c.x2 - c.x1, d = c.z2 - c.z1;
  console.log(`中心(${Math.round(c.cx)},${Math.round(c.cz)}) AABB ${Math.round(w)}×${Math.round(d)}m 面积${c.area}m² 成员${c.members.length}个 角度样本: ${c.members.map((m) => m.thetaDeg).join('/')}`);
}

// 调试图:检测掩膜红色叠加 + 米制坐标网格
const out = Buffer.alloc(data.length);
out.set(data);
for (let i = 0; i < Wp * Hp; i++) {
  if (mask[i]) { out[i * CH] = 255; out[i * CH + 1] = 40; out[i * CH + 2] = 40; }
}
const dbg = sharp(out, { raw: { width: Wp, height: Hp, channels: CH } });
// 用 SVG 画网格(每 20m 一线,每 100m 标注)
const gridLines = [];
const gridText = [];
const [wx1, wz1] = px2local(0, 0);
const [wx2, wz2] = px2local(Wp, Hp);
const xLo = Math.min(wx1, wx2), xHi = Math.max(wx1, wx2);
const zLo = Math.min(wz1, wz2), zHi = Math.max(wz1, wz2);
function local2pxAny(x, z) {
  // 反向:局部米 → 调试图像素(利用 px2local 的线性性,以两点标定)
  const [ax, ay] = px2local(0, 0);
  const [bx, by] = px2local(Wp - 1, Hp - 1);
  const sx = (x - ax) / (bx - ax) * (Wp - 1);
  const sy = (z - ay) / (by - ay) * (Hp - 1);
  return [sx, sy];
}
for (let gx = Math.ceil(xLo / 20) * 20; gx <= xHi; gx += 20) {
  const [ax, ay] = local2pxAny(gx, zLo), [bx, by] = local2pxAny(gx, zHi);
  const major = gx % 100 === 0;
  gridLines.push(`<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="${major ? '#ffff00' : 'rgba(255,255,0,.4)'}" stroke-width="${major ? 1.5 : 0.7}"/>`);
  if (major) gridText.push(`<text x="${ax + 2}" y="${14}" fill="#ffff00" font-size="12">${gx}</text>`);
}
for (let gz = Math.ceil(zLo / 20) * 20; gz <= zHi; gz += 20) {
  const [ax, ay] = local2pxAny(xLo, gz), [bx, by] = local2pxAny(xHi, gz);
  const major = gz % 100 === 0;
  gridLines.push(`<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="${major ? '#ffff00' : 'rgba(255,255,0,.4)'}" stroke-width="${major ? 1.5 : 0.7}"/>`);
  if (major) gridText.push(`<text x="3" y="${ay - 3}" fill="#ffff00" font-size="12">${gz}</text>`);
}
await dbg.composite([{
  input: Buffer.from(`<svg width="${Wp}" height="${Hp}">${gridLines.join('')}${gridText.join('')}</svg>`),
  top: 0, left: 0,
}]).png().toFile('/tmp/detect-debug.png');
console.log('调试图(含 20/100m 网格): /tmp/detect-debug.png');
