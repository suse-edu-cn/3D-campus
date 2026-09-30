/**
 * 在已对齐的卫星底图纹理(satellite-ground.webp)上检测场地与场馆的精确位置。
 * 纹理像素 ↔ WGS-84 经纬度严格线性映射(与 3D 场景一致),检测结果即为场景局部坐标。
 * 用法: node scripts/locate-features.mjs
 */
import sharp from 'sharp';

const LAT0 = 28.808876, LON0 = 104.668727;
const MLAT = 110540, MLON = 111320 * Math.cos((LAT0 * Math.PI) / 180);
const meta = (await import('../public/assets/satellite-meta.json', { with: { type: 'json' } })).default;
const { bbox, width: W, height: H } = meta;

const px2local = (px, py) => {
  const lon = bbox.minLon + (px / W) * (bbox.maxLon - bbox.minLon);
  const lat = bbox.maxLat - (py / H) * (bbox.maxLat - bbox.minLat);
  return [(lon - LON0) * MLON, -(lat - LAT0) * MLAT];
};
const local2px = (x, z) => {
  const lon = LON0 + x / MLON, lat = LAT0 - z / MLAT;
  return [((lon - bbox.minLon) / (bbox.maxLon - bbox.minLon)) * W, ((bbox.maxLat - lat) / (bbox.maxLat - bbox.minLat)) * H];
};

// 检测窗:默认西侧,可用 argv 覆盖(x1 z1 x2 z2 局部米制)
const WX = process.argv.slice(2, 6).map(Number);
const WIN = WX.length >= 4
  ? { x1: WX[0], z1: WX[1], x2: WX[2], z2: WX[3] }
  : { x1: -750, z1: -250, x2: -150, z2: 300 };
const [pxA, pyA] = local2px(WIN.x1, WIN.z1);
const [pxB, pyB] = local2px(WIN.x2, WIN.z2);
const L = Math.floor(Math.min(pxA, pxB));
const R = Math.ceil(Math.max(pxA, pxB));
const T = Math.floor(Math.min(pyA, pyB));
const Bm = Math.ceil(Math.max(pyA, pyB));
const region = await sharp('public/assets/satellite-ground.webp')
  .extract({ left: L, top: T, width: R - L, height: Bm - T })
  .raw().toBuffer({ resolveWithObject: true });
const { data, info } = region;
const CH = info.channels, RW = info.width, RH = info.height;
const px2localR = (px, py) => px2local(L + px, T + py);
const mPerPx = (meta.mPerPx);

function detect(name, test, minArea) {
  const mask = new Uint8Array(RW * RH);
  let cnt = 0;
  for (let i = 0; i < RW * RH; i++) {
    const r = data[i * CH], g = data[i * CH + 1], b = data[i * CH + 2];
    if (test(r, g, b)) { mask[i] = 1; cnt++; }
  }
  // 连通域
  const label = new Int32Array(RW * RH);
  const queue = new Int32Array(RW * RH);
  const out = [];
  for (let s = 0; s < RW * RH; s++) {
    if (!mask[s] || label[s]) continue;
    let qh = 0, qt = 0, n = 0, sx = 0, sy = 0;
    queue[qt++] = s; label[s] = 1;
    let minX = RW, maxX = 0, minY = RH, maxY = 0;
    const pix = [];
    while (qh < qt) {
      const idx = queue[qh++]; const x = idx % RW, y = (idx / RW) | 0;
      n++; sx += x; sy += y; pix.push(idx);
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      for (const d of [idx - 1, idx + 1, idx - RW, idx + RW]) {
        if (d < 0 || d >= RW * RH || label[d] || !mask[d]) continue;
        if ((d === idx - 1 && x === 0) || (d === idx + 1 && x === RW - 1)) continue;
        label[d] = 1; queue[qt++] = d;
      }
    }
    const area = n * mPerPx * mPerPx;
    if (area < minArea) continue;
    // PCA 主方向(像素系 y 向下)
    const mx = sx / n, my = sy / n;
    let sxx = 0, syy = 0, sxy = 0;
    for (const idx of pix) {
      const x = idx % RW - mx, y = ((idx / RW) | 0) - my;
      sxx += x * x; syy += y * y; sxy += x * y;
    }
    sxx /= n; syy /= n; sxy /= n;
    const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy) * (180 / Math.PI);
    const [cx, cz] = px2localR(sx / n, sy / n);
    const [ax, az] = px2localR(minX, minY);
    const [bx, bz] = px2localR(maxX, maxY);
    out.push({ name, cx: Math.round(cx), cz: Math.round(cz), w: Math.round(bx - ax), d: Math.round(bz - az), area: Math.round(area), rot: +theta.toFixed(1) });
  }
  return out.sort((a, b) => b.area - a.area);
}

// 蓝灰球场
const courts = detect('court', (r, g, b) => b > 95 && b > r + 14 && b > g + 10 && b < 215, 80);
console.log('=== 蓝色球场 ===');
for (const c of courts) console.log(`中心(${c.cx},${c.cz}) 外接 ${c.w}×${c.d}m 面积${c.area}m² 主轴角${c.rot}°`);
// 米色坡屋顶场馆(亮、暖)
const halls = detect('hall', (r, g, b) => r > 150 && g > 135 && b > 105 && b < 190 && r > b + 30 && g > b + 12, 1200);
console.log('=== 米色场馆屋顶 ===');
for (const c of halls) console.log(`中心(${c.cx},${c.cz}) 外接 ${c.w}×${c.d}m 面积${c.area}m² 主轴角${c.rot}°`);
