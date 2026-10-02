import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PALETTE } from './scene/palette';
import { loadCampusData, loadManual, loadCampusRegistry, type CampusInfo } from './data/loader';
import { setProjectionCenter } from './data/projection';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { ManualFeatures } from './scene/manual';
import { buildGround } from './scene/ground';
import { buildGreen, buildWater, buildPitch } from './scene/layers';
import { buildRoads } from './scene/roads';
import { buildBuildings } from './scene/buildings';
import { buildTrees } from './scene/trees';
import { buildLabels, createLabelRenderer } from './scene/labels';
import { InfoPanel } from './ui/infoPanel';
const app = document.getElementById('app')!;
const loadingEl = document.getElementById('loading')!;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
app.appendChild(renderer.domElement);

const labelRenderer = createLabelRenderer(app);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.bg);
scene.fog = new THREE.Fog(PALETTE.bg, 1300, 2900);

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
controls.maxDistance = 2400;
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

let clearSelectionRef: (() => void) | null = null;
let getPickMeshesList: () => THREE.Mesh[] = () => [];
let pickMeshes: THREE.Mesh[] = [];
let layers: Record<string, THREE.Object3D | null> = {};
let fly: { pos: THREE.Vector3; target: THREE.Vector3; t: number } | null = null;
let lastTime: number | null = null;
let currentCampus: string | null = null;
let campusRoot: THREE.Group | null = null;
let campusList: CampusInfo[] = [];

async function loadCampus(id: string): Promise<void> {
  if (currentCampus === id) return;
  const info = campusList.find((c) => c.id === id);
  if (!info) throw new Error(`未知校区: ${id}`);
  clearSelectionRef?.();

  // 释放旧校区内容(CSS2D 元素 + 几何体)
  if (campusRoot) {
    campusRoot.traverse((o) => {
      if (o instanceof CSS2DObject && o.element.parentElement) {
        o.element.parentElement.removeChild(o.element);
      }
      if (o instanceof THREE.Mesh || o instanceof THREE.InstancedMesh) o.geometry?.dispose();
      if (o instanceof THREE.InstancedMesh) o.dispose();
    });
    scene.remove(campusRoot);
    campusRoot = null;
  }

  setProjectionCenter((await (await fetch(`./data/${id}/meta.json`)).json()).center);
  const data = await loadCampusData(id);

  campusRoot = new THREE.Group();
  const groundGroup = buildGround(data.boundary);
  const green = buildGreen(data);
  const pitch = buildPitch(data);
  const water = buildWater(data);
  const roads = buildRoads(data);
  campusRoot.add(groundGroup, green, pitch, water, roads);

  const buildings = buildBuildings(data);
  campusRoot.add(buildings);

  // 手工校准设施(校门/网球场/室内馆/广场/中轴步道)
  const manualState = await loadManual(id);
  const manual = new ManualFeatures(manualState);
  campusRoot.add(manual.group);
  const manualPlazaRings = manualState.plazas.map((p) => p.ring);

  const trees = buildTrees(data, manualPlazaRings);
  campusRoot.add(trees);

  const labels = buildLabels(data);
  campusRoot.add(labels);

  scene.add(campusRoot);
  layers = { groundGroup, green, pitch, water, roads, buildings, trees, labels };
  pickMeshes = getPickMeshesList();

  // 相机重置到该校区的默认视角
  camera.position.set(...info.camera.pos);
  controls.target.set(...info.camera.target);
  controls.update();

  currentCampus = id;
  // 标题随校区切换
  const titleText = `四川轻化工大学${info.name} · 3D 地图`;
  document.querySelector('.title-bar')!.textContent = titleText;
  document.title = titleText;
  // 切换按钮高亮
  document.querySelectorAll('.campus-btn').forEach((b) => {
    b.classList.toggle('active', (b as HTMLElement).dataset.campus === id);
  });
}

async function init() {
  campusList = await loadCampusRegistry();
  const switcher = document.getElementById('campus-switcher')!;
  for (const c of campusList) {
    const btn = document.createElement('button');
    btn.className = 'campus-btn';
    btn.dataset.campus = c.id;
    btn.textContent = c.name;
    btn.addEventListener('click', () => loadCampus(c.id));
    switcher.appendChild(btn);
  }

  // —— 交互:点击建筑信息面板 ——
  const panel = new InfoPanel();
  clearSelectionRef = () => clearSelection();
  pickMeshes = [];
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let selected: THREE.Mesh | null = null;
  let savedMats: THREE.Material[] | null = null;

  function clearSelection() {
    if (selected && savedMats) selected.material = savedMats;
    selected = null;
    savedMats = null;
    panel.hide();
  }
  panel.onFly = (props) => {
    const [px, pz] = (() => {
      // 从网格包围盒取中心
      const box = new THREE.Box3().setFromObject(selected!);
      const c = box.getCenter(new THREE.Vector3());
      return [c.x, c.z];
    })();
    flyTo(new THREE.Vector3(px + 170, props.height_m + 110, pz + 200), new THREE.Vector3(px, props.height_m * 0.4, pz));
  };
  function pickAt(clientX: number, clientY: number): THREE.Mesh | null {
    pointer.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(pickMeshes, false);
    return hits.length && hits[0].object.userData.osm_id ? (hits[0].object as THREE.Mesh) : null;
  }
  let downX = 0, downY = 0;
  renderer.domElement.addEventListener('pointerdown', (e) => { downX = e.clientX; downY = e.clientY; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) return;
    const hit = pickAt(e.clientX, e.clientY);
    if (hit) {
      clearSelection();
      selected = hit;
      savedMats = hit.material as THREE.Material[];
      hit.material = savedMats.map((m) => {
        const c = (m as THREE.MeshStandardMaterial).clone();
        c.emissive = new THREE.Color(0x1c4d78);
        c.emissiveIntensity = 0.5;
        return c;
      });
      panel.show(hit.userData as never);
    } else {
      clearSelection();
    }
  });
  renderer.domElement.addEventListener('pointermove', (e) => {
    renderer.domElement.style.cursor = pickAt(e.clientX, e.clientY) ? 'pointer' : '';
  });

  // —— 交互:镜头定位飞行动画 ——
  function flyTo(pos: THREE.Vector3, target: THREE.Vector3) {
    fly = { pos, target, t: 0 };
  }

  hideLoading();
}

init()
  .then(() => loadCampus(campusList[0]?.id ?? 'yibin'))
  .catch((err) => {
    console.error(err);
    loadingEl.querySelector('.loading-text')!.textContent = `加载失败:${err.message}`;
  });

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
});

renderer.setAnimationLoop((time) => {
  const dt = Math.min(0.05, (time - (lastTime ?? time)) / 1000);
  lastTime = time;
  if (fly) {
    fly.t = Math.min(1, fly.t + dt / 0.9);
    const k = fly.t * fly.t * (3 - 2 * fly.t);
    camera.position.lerp(fly.pos, k * 0.25 + 0.02);
    controls.target.lerp(fly.target, k * 0.25 + 0.02);
    if (fly.t >= 1) fly = null;
  }
  controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
});

// 调试/测试钩子:浏览器控制台或自动化脚本可调整相机
window.__cam = { camera, controls, scene, get layers() { return layers; } };
