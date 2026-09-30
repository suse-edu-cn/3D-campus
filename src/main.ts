import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const app = document.getElementById('app')!;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xaee3f5);
scene.fog = new THREE.Fog(0xaee3f5, 1800, 4200);

const camera = new THREE.PerspectiveCamera(
  55,
  window.innerWidth / window.innerHeight,
  1,
  8000,
);
camera.position.set(500, 600, 700);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI / 2.1;
controls.minDistance = 50;
controls.maxDistance = 3000;

const hemi = new THREE.HemisphereLight(0xdff3ff, 0x9db38a, 0.9);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xfff4e0, 1.6);
sun.position.set(600, 900, 400);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -1200;
sun.shadow.camera.right = 1200;
sun.shadow.camera.top = 1200;
sun.shadow.camera.bottom = -1200;
sun.shadow.camera.far = 3000;
sun.shadow.bias = -0.0004;
scene.add(sun);

// —— 阶段 0 占位地面,阶段 2 将替换为真实校园底图 ——
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(4000, 4000),
  new THREE.MeshStandardMaterial({ color: 0xa8c686 }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const grid = new THREE.GridHelper(2000, 40, 0x88aa77, 0x99bb88);
grid.position.y = 0.05;
scene.add(grid);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});
