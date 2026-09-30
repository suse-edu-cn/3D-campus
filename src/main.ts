import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PALETTE } from './scene/palette';
import { loadCampusData } from './data/loader';
import { buildGround } from './scene/ground';
import { buildGreen, buildWater, buildPitch } from './scene/layers';
import { buildRoads } from './scene/roads';
import { buildBuildings } from './scene/buildings';

const app = document.getElementById('app')!;
const loadingEl = document.getElementById('loading')!;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.bg);
scene.fog = new THREE.Fog(PALETTE.bg, 2200, 5200);

const camera = new THREE.PerspectiveCamera(
  55,
  window.innerWidth / window.innerHeight,
  1,
  8000,
);
camera.position.set(120, 480, 820);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI / 2.1;
controls.minDistance = 40;
controls.maxDistance = 3200;
controls.target.set(0, 0, -120);

const hemi = new THREE.HemisphereLight(0xdff3ff, 0x9db38a, 1.1);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xfff4e0, 2.4);
sun.position.set(700, 1000, 500);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -1300;
sun.shadow.camera.right = 1300;
sun.shadow.camera.top = 1300;
sun.shadow.camera.bottom = -1300;
sun.shadow.camera.far = 3200;
sun.shadow.bias = -0.0004;
scene.add(sun);

function hideLoading() {
  loadingEl.classList.add('done');
}

async function init() {
  const data = await loadCampusData();
  scene.add(buildGround(data.boundary));
  scene.add(buildGreen(data));
  scene.add(buildPitch(data));
  scene.add(buildWater(data));
  scene.add(buildRoads(data));
  scene.add(buildBuildings(data));
  hideLoading();
}

init().catch((err) => {
  console.error(err);
  loadingEl.querySelector('.loading-text')!.textContent = `加载失败:${err.message}`;
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});
