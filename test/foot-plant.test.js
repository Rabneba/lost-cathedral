import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {FootPlant} from '../src/game/foot-plant.js';

function fixture(height){
  const root=new T.Group(),hips=new T.Bone(),upper=new T.Bone(),knee=new T.Bone(),foot=new T.Bone();
  upper.name='mixamorigLeftUpLeg';knee.name='mixamorigLeftLeg';foot.name='mixamorigLeftFoot';
  root.add(hips);hips.add(upper);upper.add(knee);knee.add(foot);
  hips.position.y=height;root.rotation.y=.8;knee.position.set(0,-.6,.2);foot.position.set(0,-.7,-.2);foot.rotation.x=.2;
  root.updateMatrixWorld(true);
  const soles={minimumHeight:()=>foot.getWorldPosition(new T.Vector3()).y};
  return {root,hips,upper,knee,foot,plant:new FootPlant(root,soles)};
}

test('a penetrated foot plants through knee flexion without shifting the hips or changing its orientation',()=>{
  const {root,hips,foot,plant}=fixture(1.18);
  const original=foot.getWorldPosition(new T.Vector3()),orientation=foot.getWorldQuaternion(new T.Quaternion()),hipsMatrix=hips.matrixWorld.clone();
  assert.ok(original.y<-.1);
  plant.correct();root.updateMatrixWorld(true);
  const result=foot.getWorldPosition(new T.Vector3());
  assert.ok(Math.abs(result.y)<1e-5);
  assert.ok(Math.hypot(result.x-original.x,result.z-original.z)<1e-6);
  assert.ok(foot.getWorldQuaternion(new T.Quaternion()).angleTo(orientation)<1e-6);
  assert.deepEqual(hips.matrixWorld.elements,hipsMatrix.elements);
});

test('an airborne leg remains exactly as authored',()=>{
  const {root,upper,knee,foot,plant}=fixture(1.5);
  const rotations=[upper,knee,foot].map(bone=>bone.quaternion.toArray());
  const original=foot.getWorldPosition(new T.Vector3());
  plant.correct();root.updateMatrixWorld(true);
  assert.deepEqual([upper,knee,foot].map(bone=>bone.quaternion.toArray()),rotations);
  assert.ok(foot.getWorldPosition(new T.Vector3()).distanceTo(original)<1e-8);
  assert.equal(plant.maxCorrection,0);
});
