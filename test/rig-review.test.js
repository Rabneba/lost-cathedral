import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createRigReview } from '../src/preview/rig-review.js';

// Exercise the actual Three.js loader, including its bone-name sanitization.
// Remove only material/image declarations so this skinning check runs in Node.
async function loadRig() {
  const file = await readFile(new URL('../assets/rigs/reliquary-saint/reliquary-saint-armed-rig.glb', import.meta.url));
  const size = file.readUInt32LE(12);
  const json = JSON.parse(file.subarray(20,20+size));
  json.buffers[0].uri = 'data:application/octet-stream;base64,' + file.subarray(28+size).toString('base64');
  for (const mesh of json.meshes) for (const primitive of mesh.primitives) delete primitive.material;
  for (const key of ['images','textures','samplers','materials']) delete json[key];
  globalThis.ProgressEvent ??= class ProgressEvent { constructor(type,init) { this.type=type;Object.assign(this,init); } };
  return (await new GLTFLoader().parseAsync(JSON.stringify(json), '')).scene;
}

test('Blender poses move loaded limbs and weapon, then return exactly to rest', async () => {
  const root = await loadRig();
  const data = JSON.parse(await readFile(new URL('../assets/rigs/reliquary-saint/diagnostic-poses.json', import.meta.url)));
  const scene = new THREE.Scene();scene.add(root);
  const review = createRigReview(root,scene,data,()=>{});
  const bones = new Map();root.traverse(n=>{if(n.isBone)bones.set(n.userData.name,n);});
  assert.notEqual(bones.get('DEF_main_02.R').name,'DEF_main_02.R');
  const point = name => bones.get(name).getWorldPosition(new THREE.Vector3());
  review.pose('rest');
  const body=root.getObjectByName('ReliquarySaint_Body');
  const tips=[[-1.2035,1.264,.9541],[-1.2418,1.079,.3987],[-1.2421,.9231,.8665]].map(raw=>{
    const target=new THREE.Vector3(...raw);let index=-1,best=Infinity;
    for(let i=0;i<body.geometry.attributes.position.count;i++) {
      const position=body.getVertexPosition(i,new THREE.Vector3()).applyMatrix4(body.matrixWorld);
      const distance=position.distanceTo(target);
      if(distance<best){best=distance;index=i;}
    }
    assert.ok(best<.04,'finger landmark lies on its actual mesh tip');return index;
  });
  const rest = new Map([...bones].map(([name])=>[name,point(name)]));
  for (const [pose,bone,minTravel] of [
    ['shoulder','DEF_spire_03.L',.5],
    ['leg','DEF_leg_02.L',.5],
    ['weapon','DEF_main_02.R',1],
  ]) {
    review.pose(pose);
    assert.ok(point(bone).distanceTo(rest.get(bone))>minTravel,`${pose} must visibly move ${bone}`);
  }
  review.pose('crouch');
  assert.ok(point('DEF_pelvis').distanceTo(rest.get('DEF_pelvis'))>.5);
  for (const side of ['L','R']) assert.ok(point(`DEF_leg_02.${side}`).distanceTo(rest.get(`DEF_leg_02.${side}`))<.001);
  const blade = root.getObjectByName('ReliquarySaint_Blade');
  const vertex = () => blade.getVertexPosition(0,new THREE.Vector3()).applyMatrix4(blade.matrixWorld);
  review.pose('rest');const bladeRest=vertex();
  review.pose('weapon');assert.ok(vertex().distanceTo(bladeRest)>.5,'separate blade follows the posed socket');
  review.weapon(true);
  const socket=bones.get('DEF_weapon_socket.R');
  const shaft=new THREE.Vector3(0,1,0).applyQuaternion(socket.getWorldQuaternion(new THREE.Quaternion()));
  for (const index of tips) {
    const offset=body.getVertexPosition(index,new THREE.Vector3()).applyMatrix4(body.matrixWorld).sub(point('DEF_weapon_socket.R'));
    const radial=offset.clone().addScaledVector(shaft,-offset.dot(shaft)).length();
    assert.ok(radial<.25,`closed claw tip stays near the handle: ${radial}`);
  }
  review.weapon(false);
  review.pose('rest');
  for (const [name,position] of rest) assert.ok(point(name).distanceTo(position)<1e-6,`${name} resets`);
  review.dispose();
});
