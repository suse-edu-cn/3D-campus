/**
 * 将官方标注图(11.png)与已对齐卫星纹理做模板匹配,求出标注图的仿射参数,
 * 从而把标注图上的门标记换算为场景局部坐标。
 * 用法: node scripts/geo-ref.mjs "/path/to/11.png"
 */
import sharp from 'sharp';
import { readFileSync } from 'node:fs';

const REF = process.argv[2] || '/Users/starry/Downloads/11.png';
const LAT0 = 28.808876, LON0 = 104.668727;
const MLAT = 110540, MLON = 111320 * Math.cos((LAT0 * Math.PI) / 180);
const meta = JSON.parse(readFileSync('public/assets/satellite-meta.json', 'utf8'));
const texPx = (x, z) => {
  const lon = LON0 + x / MLON, lat = LAT0 - z / MLAT;
  return [
    ((lon - meta.bbox.minLon) / (meta.bbox.maxLon - meta.bbox.minLon)) * meta.width,
    ((meta.bbox.maxLat - lat) / (meta.bbox.maxLat - meta.bbox.minLat)) * meta.height,
  ];
};

// 锚点:校区外、标注图未绘制的大型建筑(局部米制)
const ANCHOR1 = { x: 460, z: 548, name: '公园π' };      // SE 住宅区
const ANCHOR2 = { x: 897, z: -883, name: '东北建筑' };  // NE
const TEX_M = 220; // 模板边长(米)
const TPPM = meta.width / ((meta.bbox.maxLon - meta.bbox.minLon) * MLON); // 纹理 px/m

async function cropTex(anchor) {
  const [cx, cy] = texPx(anchor.x, anchor.z);
  const half = (TEX_M * TPPM) / 2;
  const buf = await sharp('public/assets/satellite-ground.webp')
    .extract({ left: Math.round(cx - half), top: Math.round(cy - half), width: Math.round(TEX_M * TPPM), height: Math.round(TEX_M * TPPM) })
    .greyscale().raw().toBuffer();
  return { buf, size: Math.round(TEX_M * TPPM) };
}

const refImg = sharp(REF).greyscale();
const { data: refData, info: refInfo } = await refImg.raw().toBuffer({ resolveWithObject: true });
const RW = refInfo.width, RH = refInfo.height, RC = refInfo.channels;

// 粗到细模板匹配(ZNCC)
async function match(anchor, searchWin, scales) {
  const { buf: tmplBuf, size } = await cropTex(anchor);
  let best = { score: -2 };
  for (const s of scales) {
    const tSize = Math.max(24, Math.round(size * s));
    const t = await sharp(tmplBuf, { raw: { width: size, height: size, channels: 1 } })
      .resize(tSize, tSize).raw().toBuffer();
    // 归一化模板
    let tm = 0; for (let i = 0; i < t.length; i++) tm += t[i];
    tm /= t.length;
    let tv = 0; for (let i = 0; i < t.length; i++) tv += (t[i] - tm) ** 2;
    tv = Math.sqrt(tv / t.length);
    const [x1, y1] = searchWin;
    for (let py = y1; py + tSize < RH; py += 2) {
      for (let px = x1; px + tSize < RW; px += 2) {
        let sm = 0, sv = 0, sxy = 0;
        for (let ty = 0; ty < tSize; ty += 2) {
          for (let tx = 0; tx < tSize; tx += 2) {
            const rv = refData[((py + ty) * RW + px + tx) * RC];
            const tvv = t[ty * tSize + tx];
            sm += rv; sv += rv * rv; sxy += rv * tvv;
          }
        }
        const n = ((tSize / 2) | 0) ** 2;
        const cov = sxy / n - (sm / n) * tm;
        const score = cov / (Math.sqrt(sv / n - (sm / n) ** 2) * tv + 1e-9);
        if (score > best.score) best = { score, s, px: px + tSize / 2, py: py + tSize / 2, tSize };
      }
    }
    console.log(`  scale=${s.toFixed(2)} 最佳相关=${best.score.toFixed(3)}`);
  }
  return best;
}

console.log(`锚点1 ${ANCHOR1.name} (${ANCHOR1.x},${ANCHOR1.z}) 匹配中...`);
const m1 = await match(ANCHOR1, [850, 600], Array.from({ length: 9 }, (_, i) => 0.5 + i * 0.03));
console.log(`  → 位置(${m1.px.toFixed(0)},${m1.py.toFixed(0)}) scale=${m1.s} 相关=${m1.score.toFixed(3)}`);

const s = m1.s;
const pxm = TPPM * s; // 标注图 px/m
const tx = m1.px - ANCHOR1.x * pxm;
const tz = m1.py - ANCHOR1.z * pxm;
const toLocal = (u, v) => [Math.round((u - tx) / pxm), Math.round((v - tz) / pxm)];
console.log(`\n仿射: ${pxm.toFixed(3)} px/m, 原点偏移(${tx.toFixed(0)},${tz.toFixed(0)})`);

console.log('\n=== 标注图标记 → 局部坐标 ===');
for (const [u, v, label] of [
  [1002, 862, '南门(轴上标记)'],
  [827, 995, '底部标记'],
  [568, 745, '西大门'],
  [545, 525, '西门'],
  [1073, 160, '东门'],
  [1218, 615, '东南门'],
]) {
  const [x, z] = toLocal(u, v);
  console.log(`${label}: (${u},${v}) → (${x},${z})`);
}

// 验证:锚点2 应落在其已知位置附近
console.log('\n验证锚点2...');
const m2 = await match(ANCHOR2, [Math.max(0, Math.round(m1.px + (ANCHOR2.x - ANCHOR1.x) * pxm) - 120), Math.max(0, Math.round(m1.py + (ANCHOR2.z - ANCHOR1.z) * pxm) - 90)], [s]);
const ex = (m2.px - tx) / pxm, ez = (m2.py - tz) / pxm;
console.log(`  预期 (${ANCHOR2.x},${ANCHOR2.z}) 实测 (${ex.toFixed(0)},${ez.toFixed(0)}) 相关=${m2.score.toFixed(3)} 偏差 ${Math.hypot(ex - ANCHOR2.x, ez - ANCHOR2.z).toFixed(0)}m`);
