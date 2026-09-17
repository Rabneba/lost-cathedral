import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import * as T from 'three';
import {ASSETS} from '../src/game/asset-paths.js';
import {actorScale,actorDimensions,withActorScale} from '../src/game/actor-scale.js';
import {createActor,weaponSegmentFor} from '../src/game/actors.js';
import {createPlayerCloth,updatePlayerCloth} from '../src/game/player-cloth.js';
import {MotionState,horizontalDistance} from '../src/game/motion.js';
import {loadGLB} from '../scripts/load-glb-node.mjs';

test('current boss scale is reversible for archived views without mutating source timing or socket geometry',()=>{
 const original={locomotionSpeed:.45,approachDistance:1.9,attackRange:2,weaponSegment:[[0,1,0],[1,2,0]],clips:{walk:{sourceSpeed:.409,duration:4},sweep:{duration:3.7,hitWindows:[[.87,1.5]]}}};
 const unchanged=structuredClone(original),large=withActorScale(original,1.3),archived=withActorScale(large,1);
 assert.deepEqual(original,unchanged);
 assert.equal(large.clips.walk.duration,original.clips.walk.duration);
 assert.deepEqual(large.weaponSegment,original.weaponSegment);
 assert.ok(Math.abs(large.locomotionSpeed/large.clips.walk.sourceSpeed-original.locomotionSpeed/original.clips.walk.sourceSpeed)<1e-12,'same stride cadence at proportionally larger world travel');
 assert.ok(Math.abs(archived.clips.walk.sourceSpeed-original.clips.walk.sourceSpeed)<1e-12);
 assert.deepEqual(archived.clips.sweep,original.clips.sweep);
 assert.equal(actorScale(ASSETS.motion.player),1,'player remains unchanged');
 assert.equal(actorScale(ASSETS.motion.boss),1.3);
});

test('approved boss skin, bones and separate socket weapon all become exactly 30 percent larger',async()=>{
 const actors=await Promise.all([1,1.3].map(async scale=>{
  const gltf=await loadGLB(fileURLToPath(ASSETS.bossRig));
  const actor=createActor(gltf,2.5,true,true,withActorScale(ASSETS.motion.boss,scale));
  actor.weapon=new T.Group();actor.weapon.rotation.x=Math.PI/2;
  actor.body.getObjectByName('WeaponSocket').add(actor.weapon);
  actor.weaponSegment=weaponSegmentFor(true,ASSETS);
  return actor;
 }));
 const origin={x:3,z:-2,yaw:.6},anchor=new T.Vector3(origin.x,0,origin.z);
 for(const time of [0,2,9]){
  for(const actor of actors){actor.reset(origin);actor.update(0,time,{health:100,action:{name:'idle',elapsed:time,directClipTime:true,rawPose:true}},origin);}
  for(const name of ['Head','Hips','LeftHand','RightHand','LeftFoot','RightFoot']){
   const points=actors.map(a=>a.body.getObjectByName('mixamorig'+name).getWorldPosition(new T.Vector3()).sub(anchor));
   assert.ok(points[0].multiplyScalar(1.3).distanceTo(points[1])<1e-5,`${name} scales about the actor's grounded origin`);
  }
  for(let end=0;end<2;end++){
   const a=new T.Vector3(...actors[0].segment[end]).sub(anchor).multiplyScalar(1.3),b=new T.Vector3(...actors[1].segment[end]).sub(anchor);
   assert.ok(a.distanceTo(b)<1e-5,'socket-local blade endpoints scale exactly once');
  }
  const meshes=actors.map(a=>{let mesh;a.body.traverse(n=>{if(n.isSkinnedMesh)mesh=n;});return mesh;});
  for(let index=0;index<meshes[0].geometry.attributes.position.count;index+=997){
   const points=meshes.map(m=>m.getVertexPosition(index,new T.Vector3()).applyMatrix4(m.matrixWorld).sub(anchor));
   assert.ok(points[0].multiplyScalar(1.3).distanceTo(points[1])<1e-5,'actual weighted skin follows the same scale');
  }
 }
});

test('cloth world-space constraints preserve the enlarged garment length after settling',()=>{
 const means=[1,1.3].map(scale=>{
  const root=new T.Group(),cloth=createPlayerCloth(2.5);root.scale.setScalar(scale);root.add(cloth);root.updateMatrixWorld(true);
  for(let frame=0;frame<120;frame++)updatePlayerCloth(cloth,1/120,frame/120);
  // The cloth is a particle grid; walk the first column of the first panel.
  const panel=cloth.clothSimulation.panels[0];let total=0,rest=0;
  for(let row=1;row<=panel.rows;row++){
   const a=(row-1)*panel.stride*3,b=row*panel.stride*3;
   total+=Math.hypot(...[0,1,2].map(axis=>panel.position[b+axis]-panel.position[a+axis]));
   rest+=panel.lengthV[(row-1)*panel.stride];
  }
  return total/rest;
 });
 assert.ok(Math.abs(means[1]-means[0]-.3)<.01,'larger cloth must not collapse back to its original world length');
});

test('larger boss collision leaves the player unchanged and cannot be pushed through the arena edge',()=>{
 const motion=new MotionState({animationMetadata:ASSETS.motion});
 motion.player={x:0,z:1.7,yaw:Math.PI};motion.boss={x:0,z:0,yaw:0};
 const state={status:'fighting',player:{blocking:false},boss:{phase:1,action:{name:'sweep',elapsed:2}}};
 for(let i=0;i<240;i++)motion.step(1/120,{forward:1,lockOn:true},state);
 assert.ok(Math.abs(horizontalDistance(motion.player,motion.boss)-1.4)<1e-6);
 assert.equal(motion.boss.z,0);
 assert.equal(motion.dimensions.player.groundRadius,.45);
 motion.move(motion.boss,{x:1,z:0},100,motion.dimensions.boss.groundRadius);
 assert.ok(Math.abs(motion.boss.x-(motion.bounds.maxX-1.43))<1e-9);
});

test('solid-body spacing scales once without enlarging damage capsules or shrinking obstacle protection',()=>{
 const original=actorDimensions(true,withActorScale(ASSETS.motion.boss,1));
 const current=actorDimensions(true,ASSETS.motion.boss),player=actorDimensions(false,ASSETS.motion.player);
 assert.ok(Math.abs(current.bodyRadius-.9)<1e-12);
 assert.ok(Math.abs(original.bodyRadius*1.3-current.bodyRadius)<1e-12);
 assert.equal(player.bodyRadius,.45);
 assert.ok(Math.abs(current.groundRadius-1.43)<1e-12,'boss still keeps its broad footprint around walls and candle stands');
 assert.ok(Math.abs(current.hurtRadius-.702)<1e-12,'damage capsule was not expanded to make a missed attack connect');
 assert.deepEqual(current.capsuleY,[.78,2.7300000000000004]);
});

test('body separation at a wall retains legal obstacle clearance and cannot pin either actor outside bounds',()=>{
 for(const fps of [30,60,120]){
  const motion=new MotionState({animationMetadata:ASSETS.motion});
  motion.player={x:9.5,z:0,yaw:-Math.PI/2};motion.boss={x:8.4,z:0,yaw:Math.PI/2};
  const state={status:'fighting',player:{blocking:false},boss:{phase:1,action:{name:'sweep',elapsed:2}}};
  for(let frame=0;frame<fps;frame++)motion.step(1/fps,{right:-1},state);
  assert.ok(horizontalDistance(motion.player,motion.boss)>=1.4-1e-7);
  assert.ok(motion.player.x<=9.55+1e-7);
  assert.ok(motion.boss.x<=8.57+1e-7);
  const stopped={...motion.player};
  for(let frame=0;frame<fps;frame++)motion.step(1/fps,{forward:-1},state);
  // A second of free movement should cover most of the configured forward speed (the manifest sets it).
  assert.ok(motion.player.z>stopped.z+.8*ASSETS.motion.player.locomotionSpeed,'the player can slide away instead of getting trapped');
 }
});
