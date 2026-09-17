import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {GazeLock} from '../src/game/gaze-lock.js';

function rig(headYawDegrees){
 const root=new T.Group(),body=new T.Group();root.add(body);
 const hips=new T.Bone(),spine=new T.Bone(),neck=new T.Bone(),head=new T.Bone();
 hips.name='mixamorigHips';spine.name='mixamorigSpine';neck.name='mixamorigNeck';head.name='mixamorigHead';
 body.add(hips);hips.add(spine);spine.add(neck);neck.add(head);hips.position.y=1;spine.position.y=.5;neck.position.y=.1;head.position.y=.1;
 root.updateMatrixWorld(true);
 const gaze=new GazeLock(body,root);
 head.rotation.y=T.MathUtils.degToRad(headYawDegrees);root.updateMatrixWorld(true);
 const yaw=()=>{const f=new T.Vector3(0,0,1).transformDirection(head.matrixWorld);return T.MathUtils.radToDeg(Math.atan2(f.x,f.z));};
 return {root,head,neck,gaze,yaw};
}

test('the head turns onto the gameplay facing and shares the turn with the neck',()=>{
 const r=rig(-30);
 assert.ok(Math.abs(r.yaw()+30)<1e-6);
 r.gaze.update(0,{layers:new Map()});
 assert.ok(Math.abs(r.yaw())<1e-6,'head faces the root forward');
 assert.ok(Math.abs(T.MathUtils.radToDeg(r.neck.rotation.y)-30*.35)<1e-6,'35% of the turn is on the neck');
});

test('the head follows a target position and smooths in over time',()=>{
 const r=rig(0);r.gaze.target={x:Math.tan(T.MathUtils.degToRad(20))*5,z:5};
 r.gaze.update(1/60,{layers:new Map()});
 const first=r.yaw();assert.ok(first>2&&first<20,'partial turn after one frame');
 for(let i=0;i<120;i++){r.head.rotation.y=0;r.neck.rotation.y=0;r.root.updateMatrixWorld(true);r.gaze.update(1/60,{layers:new Map()});}
 assert.ok(Math.abs(r.yaw()-20)<.5,'settles on the target direction');
});

test('a target far behind and a dodge layer leave the captured head alone',()=>{
 const behind=rig(150);behind.gaze.update(0,{layers:new Map()});assert.ok(Math.abs(behind.yaw()-150)<1e-6);
 const dodge=rig(-30);dodge.gaze.update(0,{layers:new Map([['dodge',{weight:1}]])});assert.ok(Math.abs(dodge.yaw()+30)<1e-6);
 const half=rig(-30);half.gaze.update(0,{layers:new Map([['dodge',{weight:.5}],['idle',{weight:.5}]])});assert.ok(Math.abs(half.yaw()+15)<1e-6,'blends with the layer weight');
});
