/** 漫游控制:轨道浏览 / 自动巡游 / 第一人称步行 */
import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export type RoamMode = 'orbit' | 'tour' | 'walk';

// 沿校园主干道的巡游环线(局部米制)
const WAYPOINTS: [number, number][] = [
  [270, 510], [180, 430], [90, 300], [75, 82], [0, -40], [-45, -150],
  [-120, -260], [-260, -330], [-380, -180], [-390, 20], [-340, 200], [-180, 330],
  [-60, 420], [80, 470], [180, 490],
];

export class RoamController {
  mode: RoamMode = 'orbit';
  onModeChange?: (m: RoamMode) => void;

  private curve = new THREE.CatmullRomCurve3(
    WAYPOINTS.map(([x, z]) => new THREE.Vector3(x, 0, z)),
    true,
    'catmullrom',
    0.6,
  );
  private t = 0;
  private yaw = 0;
  private pitch = -0.1;
  private keys = new Set<string>();
  private lookTarget = new THREE.Vector3();
  private dragging = false;
  private lastX = 0;
  private lastY = 0;

  constructor(
    private camera: THREE.PerspectiveCamera,
    private controls: OrbitControls,
    dom: HTMLElement,
    private onEsc: () => void,
  ) {
    window.addEventListener('keydown', (e) => {
      if (this.mode === 'walk') {
        this.keys.add(e.code);
        if (e.code === 'Escape') this.onEsc();
        if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'].includes(e.code)) e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    dom.addEventListener('pointerdown', (e) => {
      if (this.mode !== 'walk') return;
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    window.addEventListener('pointermove', (e) => {
      if (this.mode !== 'walk' || !this.dragging) return;
      this.yaw -= (e.clientX - this.lastX) * 0.0032;
      this.pitch = Math.max(-1.2, Math.min(1.2, this.pitch - (e.clientY - this.lastY) * 0.0028));
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    window.addEventListener('pointerup', () => (this.dragging = false));
  }

  setMode(mode: RoamMode): void {
    if (mode === 'walk' && this.mode !== 'walk') {
      // 从当前相机姿态进入步行
      const dir = new THREE.Vector3();
      this.camera.getWorldDirection(dir);
      this.yaw = Math.atan2(-dir.x, -dir.z) + Math.PI;
      this.pitch = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
      this.camera.position.y = 1.7;
      this.camera.rotation.order = 'YXZ';
    }
    if (mode === 'orbit') {
      // 回到轨道:把目标放到前方地面点
      const dir = new THREE.Vector3();
      this.camera.getWorldDirection(dir);
      dir.y = 0;
      dir.normalize();
      this.controls.target
        .copy(this.camera.position)
        .addScaledVector(dir, 120)
        .setY(0);
      this.controls.enabled = true;
      this.controls.update();
    } else {
      this.controls.enabled = false;
    }
    this.mode = mode;
    this.onModeChange?.(mode);
  }

  update(dt: number): void {
    if (this.mode === 'tour') {
      this.t = (this.t + dt / 75) % 1; // 约 75s 一圈
      const pos = this.curve.getPointAt(this.t);
      const ahead = this.curve.getPointAt((this.t + 0.025) % 1);
      const cam = this.camera.position;
      cam.lerp(new THREE.Vector3(pos.x, 68, pos.z), 1 - Math.exp(-dt * 3));
      this.lookTarget.lerp(new THREE.Vector3(ahead.x, 18, ahead.z), 1 - Math.exp(-dt * 3));
      this.camera.lookAt(this.lookTarget);
    } else if (this.mode === 'walk') {
      const speed = (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 16 : 7) * dt;
      const fx = -Math.sin(this.yaw);
      const fz = -Math.cos(this.yaw);
      let mx = 0;
      let mz = 0;
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) { mx += fx; mz += fz; }
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) { mx -= fx; mz -= fz; }
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) { mx += fz; mz -= fx; }
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) { mx -= fz; mz += fx; }
      const len = Math.hypot(mx, mz);
      if (len > 0) {
        // 限制在校区周边范围
        const p = this.camera.position;
        p.x = THREE.MathUtils.clamp(p.x + (mx / len) * speed, -900, 900);
        p.z = THREE.MathUtils.clamp(p.z + (mz / len) * speed, -900, 900);
      }
      this.camera.position.y = 1.7;
      this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    }
  }
}
