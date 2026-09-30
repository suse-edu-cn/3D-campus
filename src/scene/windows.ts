/** 程序化窗户贴图:白底 + 单扇窗,配合米制 UV 按 3.5m/格平铺 */
import * as THREE from 'three';

export const WINDOW_TILE = 3.5; // 每格米数(≈层高/开间)

let cached: THREE.CanvasTexture | null = null;

export function getWindowTexture(): THREE.CanvasTexture {
  if (cached) return cached;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 128, 128);
  // 窗扇(深色玻璃 + 浅色下沿反光)
  ctx.fillStyle = '#46586c';
  ctx.fillRect(30, 34, 68, 72);
  ctx.fillStyle = '#5d7386';
  ctx.fillRect(30, 34, 68, 14);
  // 窗框
  ctx.strokeStyle = 'rgba(255,255,255,.9)';
  ctx.lineWidth = 5;
  ctx.strokeRect(30, 34, 68, 72);
  ctx.beginPath();
  ctx.moveTo(64, 36);
  ctx.lineTo(64, 104);
  ctx.stroke();

  cached = new THREE.CanvasTexture(c);
  cached.wrapS = cached.wrapT = THREE.RepeatWrapping;
  cached.colorSpace = THREE.SRGBColorSpace;
  cached.anisotropy = 4;
  return cached;
}

/**
 * ExtrudeGeometry 的侧面 UV 以形状空间米为单位,
 * 缩放为 1/3.5 后即每 3.5m 一扇窗(组 1 = 侧壁,组 0 = 盖面不给贴图)。
 */
export function scaleWallUVs(geo: THREE.BufferGeometry): void {
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute | undefined;
  if (!uv) return;
  const s = 1 / WINDOW_TILE;
  for (const g of geo.groups) {
    if (g.materialIndex !== 1) continue;
    for (let i = g.start; i < g.start + g.count; i++) {
      const vi = geo.index ? geo.index.getX(i) : i;
      uv.setXY(vi, uv.getX(vi) * s, uv.getY(vi) * s);
    }
  }
  uv.needsUpdate = true;
}
