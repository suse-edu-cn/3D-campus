/**
 * 从 Overpass API 拉取覆盖四川轻化工大学宜宾校区及周边的完整 OSM 数据。
 * 产出: data/raw/campus-full.osm
 *
 * bbox 在校区边界(28.8027~28.8150, 104.6626~104.6749)基础上向四周外扩,
 * 以包含周边主干道、公交站、邻校等背景要素。
 *
 * 用法: npm run data:fetch  (数据已入库后无需重复执行)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '../data/raw/campus-full.osm');

// [南, 西, 北, 东]
const BBOX = '28.7920,104.6550,28.8250,104.6860';

const QUERY = `
[out:xml][timeout:90];
(
  node(${BBOX});
  way(${BBOX});
  relation(${BBOX});
);
(._;>;);
out body;
`;

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

async function fetchOsm() {
  let lastErr;
  for (const base of ENDPOINTS) {
    for (const method of ['POST', 'GET']) {
      try {
        console.log(`请求 ${new URL(base).host} (${method}) ...`);
        const url =
          method === 'GET' ? `${base}?data=${encodeURIComponent(QUERY)}` : base;
        const res = await fetch(url, {
          method,
          headers: {
            'User-Agent': 'suse-campus-3d/0.1 (campus map project)',
            ...(method === 'POST' && {
              'Content-Type': 'application/x-www-form-urlencoded',
            }),
          },
          ...(method === 'POST' && {
            body: 'data=' + encodeURIComponent(QUERY),
          }),
          signal: AbortSignal.timeout(120_000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const xml = await res.text();
        if (xml.length < 1000 || !xml.includes('<osm')) {
          throw new Error('响应不是有效的 OSM XML');
        }
        return xml;
      } catch (err) {
        console.warn(`  失败: ${err.message}`);
        lastErr = err;
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }
  throw lastErr;
}

const xml = await fetchOsm();
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, xml);
console.log(`✓ 已保存 ${OUT}(${(xml.length / 1024).toFixed(0)} KB)`);
