import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { assets } from './assets.generated.js';
import { createPlayerCloth } from '../game/player-cloth.js';
import { createRigReview } from './rig-review.js';
import './style.css';

const $ = selector => document.querySelector(selector);
const viewport = $('#viewport');
const renderer = new THREE.WebGLRenderer({ canvas: $('canvas'), antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x292f30);
scene.fog = new THREE.FogExp2(0x292f30, .055);
const pmrem = new THREE.PMREMGenerator(renderer);
const room = new RoomEnvironment();
const environment = pmrem.fromScene(room, 0.04);
scene.environment = environment.texture; scene.environmentIntensity = 0.8;
room.dispose(); pmrem.dispose();
const camera = new THREE.PerspectiveCamera(35, 1, .01, 200);
const controls = new OrbitControls(camera, renderer.domElement);
let frameRequested = false;
function requestRender() {
  if (frameRequested) return;
  frameRequested = true;
  requestAnimationFrame(() => { frameRequested = false; controls.update(); renderer.render(scene,camera); });
}
controls.addEventListener('change', requestRender);
controls.enableDamping = true; controls.dampingFactor = .1; controls.minDistance = .3; controls.maxDistance = 30;
controls.maxPolarAngle = Math.PI * .91;
const hemi = new THREE.HemisphereLight(0xb8d1dd, 0x39342a, 1); scene.add(hemi);
const key = new THREE.DirectionalLight(0xffeed4, 3.3); key.position.set(3,7,5); key.castShadow = true;
key.shadow.mapSize.set(2048,2048); Object.assign(key.shadow.camera, { left:-6,right:6,top:7,bottom:-5,near:.1,far:30 }); key.shadow.bias = -.0002; key.shadow.normalBias = .015; scene.add(key);
const rim = new THREE.DirectionalLight(0xa1c8dc, 2.8); rim.position.set(-4,4,-4); scene.add(rim);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200,200), new THREE.MeshStandardMaterial({ color:0x101514,roughness:.92,metalness:.08,envMapIntensity:.15 }));
ground.rotation.x = -Math.PI / 2; ground.position.y = -.015; ground.receiveShadow = true; scene.add(ground);
const stage = new THREE.Group(); scene.add(stage);
const loader = new GLTFLoader();
const cache = new Map();
const clay = new THREE.MeshStandardMaterial({ color:0xb4ae9d, roughness:.7 });
const wire = new THREE.MeshBasicMaterial({ color:0xa8c5b7, wireframe:true });
let current, model, cloth, materialMode = 'original', loadVersion = 0;
let rigReview;
const poseDescriptions = {
  rest:'Rest pose · all eight arms extended.',
  shoulder:'Shoulder check · the left inner arm folds forward; the other arms stay at rest.',
  leg:'Leg bend · the left foot lifts forward while the right leg stays at rest.',
  crouch:'Planted feet · the body lowers while both feet hold their position.',
  weapon:'Weapon grip · the right main arm raises the blade, with claws closed around its handle.',
};
let modelSize = new THREE.Vector3(2,4,1), aim = new THREE.Vector3(0,2,0);

function fitView(view = 'fit') {
  const maxSpan = Math.max(modelSize.y, modelSize.x / camera.aspect);
  const distance = maxSpan / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.32 + modelSize.z * .5;
  const direction = view === 'back' ? new THREE.Vector3(0,.08,-1) : view === 'side' ? new THREE.Vector3(1,.08,0) : view === 'front' ? new THREE.Vector3(0,.04,1) : new THREE.Vector3(.17,.08,1);
  controls.target.copy(aim); camera.position.copy(aim).addScaledVector(direction.normalize(), distance); controls.update();
}
function setMaterial(mode) {
  materialMode = mode;
  stage.traverse(node => { if (node.isMesh) { node.userData.originalMaterial ??= node.material; node.material = mode === 'clay' ? clay : mode === 'wire' ? wire : node.userData.originalMaterial; } });
  document.querySelectorAll('[data-material]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.material === mode)));
  requestRender();
}
function showImage(url) { $('#image-dialog img').src = url; $('#image-dialog').showModal(); }
async function choose(asset) {
  const version = ++loadVersion;
  rigReview?.dispose();rigReview=null;
  current = asset; location.hash = asset.key;
  document.querySelectorAll('.asset-button').forEach(button => button.setAttribute('aria-current', String(button.dataset.key === asset.key)));
  $('#asset-title').textContent = asset.title; $('#part-label').textContent = asset.part;
  $('#asset-description').textContent = asset.description; $('#separation-note').textContent = asset.note;
  $('#concept-image').src = asset.conceptUrl; $('#input-image').src = asset.inputUrl;
  $('#cloth-option').hidden = asset.key !== 'player-body'; $('#cloth-toggle').checked = false;
  $('#download-model').hidden = !asset.modelUrl;
  if (asset.modelUrl) { $('#download-model').href = asset.downloadUrl || asset.modelUrl; $('#download-model').download = asset.key + '.glb'; }
  $('#rig-controls').hidden=!asset.isRig; $('#skeleton-toggle').checked=false; $('#weapon-toggle').checked=false;
  if (asset.blendUrl) { $('#download-blend').href=asset.blendUrl; $('#download-blend').download='reliquary-saint-rig.blend'; }
  document.querySelectorAll('[data-pose]').forEach(button => button.setAttribute('aria-pressed',String(button.dataset.pose==='rest')));
  stage.clear(); model = null; cloth = null; $('#mesh-stats').textContent = '';
  delete viewport.dataset.loaded;
  requestRender();
  $('#load-status').textContent = asset.modelUrl ? 'Loading the model…' : '3D generation in progress';
  if (!asset.modelUrl) return;
  try {
    if (!cache.has(asset.key)) cache.set(asset.key, loader.loadAsync(asset.modelUrl));
    const gltf = await cache.get(asset.key);
    const poseData = asset.isRig ? await fetch(asset.poseUrl).then(r => { if (!r.ok) throw new Error('Could not load rig poses'); return r.json(); }) : null;
    if (version !== loadVersion) return;
    model = new THREE.Group(); model.name = asset.key;
    const body = gltf.scene; body.position.set(0,0,0); body.scale.setScalar(1); body.rotation.set(0,asset.frontYaw,0); body.updateMatrixWorld(true);
    if (asset.isRig) body.getObjectByName('ReliquarySaint_Blade').visible=false;
    const measure=asset.isRig ? body.getObjectByName('ReliquarySaint_Body') : body;
    const bounds = new THREE.Box3().setFromObject(measure); const center = bounds.getCenter(new THREE.Vector3()); const size = bounds.getSize(new THREE.Vector3());
    const scale = 4 / Math.max(size.y, .001);
    body.scale.setScalar(scale); body.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);
    model.add(body); stage.add(model);
    let triangles = 0, meshes = 0;
    body.traverse(node => { if (node.isMesh) { node.castShadow = true; node.receiveShadow = true; meshes++; triangles += (node.geometry.index?.count ?? node.geometry.attributes.position.count) / 3; } });
    if (asset.key === 'player-body') { cloth = createPlayerCloth(4); cloth.visible = false; model.add(cloth); }
    if (asset.isRig) {
      rigReview=createRigReview(body,scene,poseData,requestRender);
      rigReview.pose(document.querySelector('[data-pose][aria-pressed="true"]').dataset.pose);
      rigReview.skeleton($('#skeleton-toggle').checked);
      rigReview.weapon($('#weapon-toggle').checked);
    }
    model.updateMatrixWorld(true);
    const fitted = new THREE.Box3().setFromObject(measure); modelSize = fitted.getSize(new THREE.Vector3()); aim = fitted.getCenter(new THREE.Vector3());
    setMaterial(materialMode); fitView();
    $('#mesh-stats').textContent = `${Math.round(triangles).toLocaleString()} triangles · ${rigReview ? rigReview.count+' bones · diagnostic poses' : meshes+' mesh'+(meshes===1?'':'es')+' · static GLB'}`;
    $('#load-status').textContent = '';
    viewport.dataset.loaded = asset.key;
  } catch (error) { console.error(error); $('#load-status').textContent = 'Could not load this model. Reload to retry.'; cache.delete(asset.key); }
}
for (const asset of assets) {
  const button = document.createElement('button'); button.className = 'asset-button'; button.dataset.key = asset.key;
  const thumb = document.createElement('img'); thumb.src = asset.inputUrl; thumb.alt = '';
  const label = document.createElement('span'); const title = document.createElement('strong'); title.textContent = asset.title;
  const part = document.createElement('small'); part.textContent = asset.part;
  label.append(title,part); button.append(thumb,label); button.addEventListener('click', () => choose(asset)); $('#assets').append(button);
}
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => fitView(button.dataset.view)));
document.querySelectorAll('[data-material]').forEach(button => button.addEventListener('click', () => setMaterial(button.dataset.material)));
$('#cloth-toggle').addEventListener('change', event => { if (cloth) { cloth.visible = event.target.checked; requestRender(); } });
function selectPose(name) {
  rigReview?.pose(name);
  document.querySelectorAll('[data-pose]').forEach(item=>item.setAttribute('aria-pressed',String(item.dataset.pose===name)));
  $('#asset-description').textContent=poseDescriptions[name];
  if (name==='weapon') { $('#weapon-toggle').checked=true;rigReview?.weapon(true); }
}
document.querySelectorAll('[data-pose]').forEach(button => button.addEventListener('click',()=>selectPose(button.dataset.pose)));
$('#inspect-grip').addEventListener('click',()=>{
  if (!rigReview) return;
  selectPose('weapon');
  const focus=rigReview.gripFocus();
  controls.target.copy(focus);camera.position.copy(focus).add(new THREE.Vector3(.3,.1,1.2));
  controls.update();requestRender();
});
$('#skeleton-toggle').addEventListener('change',event=>rigReview?.skeleton(event.target.checked));
$('#weapon-toggle').addEventListener('change',event=>rigReview?.weapon(event.target.checked));
$('#concept-open').addEventListener('click', () => showImage(current.conceptUrl));
$('#input-open').addEventListener('click', () => showImage(current.inputUrl));
$('#close-dialog').addEventListener('click', () => $('#image-dialog').close());
$('#image-dialog').addEventListener('click', event => { if (event.target === $('#image-dialog')) $('#image-dialog').close(); });
$('#save-view').addEventListener('click', () => { renderer.render(scene,camera); const link = document.createElement('a'); link.download = `${current.key}-review.png`; link.href = renderer.domElement.toDataURL('image/png'); link.click(); });
window.addEventListener('hashchange', () => { const asset = assets.find(item => item.key === location.hash.slice(1)); if (asset && asset !== current) choose(asset); });
new ResizeObserver(() => { const width = viewport.clientWidth, height = viewport.clientHeight; renderer.setSize(width,height,false); camera.aspect = width/height; camera.updateProjectionMatrix(); if (model) fitView(); requestRender(); }).observe(viewport);
choose(assets.find(asset => asset.key === location.hash.slice(1)) || assets[0]);
