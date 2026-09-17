import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {unobstructedCameraPosition,cameraOrbitPosition} from '../src/game/camera-collision.js';
import {FootContacts,weaponGroundContact,bladeImpactPoint} from '../src/game/contact-feedback.js';
import {createActor} from '../src/game/actors.js';
import {loadGLB} from '../scripts/load-glb-node.mjs';
import {ASSETS} from '../src/game/asset-paths.js';
import {fileURLToPath} from 'node:url';
import {MotionState} from '../src/game/motion.js';
import {actionTravelAt} from '../src/game/action-travel.js';

test('camera contracts before a pier and stays clear while moving around its corner',()=>{
 const pier=new T.Box3(new T.Vector3(1,0,2),new T.Vector3(2,6,3)),anchor=new T.Vector3(0,1.4,0);
 const across=unobstructedCameraPosition(anchor,new T.Vector3(3,3,6),[pier]);
 assert.equal(across.blocked,true);
 assert.equal(pier.clone().expandByScalar(.3).containsPoint(across.position),false);
 const clear=unobstructedCameraPosition(anchor,new T.Vector3(-3,3,6),[pier]);
 assert.equal(clear.blocked,false);
 assert.ok(clear.position.distanceTo(new T.Vector3(-3,3,6))<1e-8);
});

test('a close pillar causes a readable shoulder view rather than a helmet close-up',()=>{
 const pier=new T.Box3(new T.Vector3(.6,0,-.8),new T.Vector3(2,8,.8));
 const anchor=new T.Vector3(0,1.35,0),desired=new T.Vector3(6,3.1,0);
 const direct=unobstructedCameraPosition(anchor,desired,[pier]);
 assert.ok(anchor.distanceTo(direct.position)<1);
 const safe=cameraOrbitPosition(anchor,desired,[pier]);
 assert.ok(anchor.distanceTo(safe.position)>3);
 assert.equal(pier.clone().expandByScalar(.3).containsPoint(safe.position),false);
});

test('footstep contacts require a lifted foot to land and ignore stationary breathing',()=>{
 const tracker=new FootContacts();let count=0;
 for(const y of [.2,.2,.225,.25,.235,.209,.205,.206,.205])count+=tracker.update(.1,{Left:new T.Vector3(0,y,0)},{moving:true,boss:true}).length;
 assert.equal(count,1);
 for(let i=0;i<40;i++)count+=tracker.update(.1,{Left:new T.Vector3(0,.205+Math.sin(i)*.004,0)},{moving:false,boss:true}).length;
 assert.equal(count,1);
});

test('combat lead-foot preparation and strike plants both sound, but floor jitter and rapid rebounds do not',()=>{
 // Two complete lead-foot lifts end .75s apart, matching an attack's
 // preparation/strike rhythm rather than the slower same-foot walk cadence.
 const heightAt=t=>{
  for(const [start,end] of [[.2,.5],[.95,1.25],[1.35,1.5]]){
   if(t>=start&&t<end)return .09*Math.sin(Math.PI*(t-start)/(end-start));
  }
  return .003+Math.sin(t*70)*.002;
 };
 for(const fps of [30,60,120]){
  const tracker=new FootContacts(),action={name:'slam'},events=[];
  for(let frame=0;frame<fps*2;frame++){
   const time=frame/fps,position=new T.Vector3(.2,heightAt(time),.4);
   for(const contact of tracker.update(1/fps,{Right:position},{boss:true,action,groundHeight:0}))events.push({time,contact});
  }
  assert.equal(events.length,2,`${fps}Hz: only preparation and strike plants should sound`);
  for(const [index,expected] of [.5,1.25].entries()){
   assert.ok(Math.abs(events[index].time-expected)<.035,`event follows its actual downward floor crossing at${expected}s`);
   assert.equal(events[index].contact.kind,'step');assert.equal(events[index].contact.side,'Right');
  }
  const walk=new FootContacts(),walkEvents=[];
  for(let frame=0;frame<fps*1.3;frame++)walkEvents.push(...walk.update(1/fps,{Right:new T.Vector3(0,heightAt(frame/fps),0)},{boss:true,moving:true,groundHeight:0}));
  assert.equal(walkEvents.length,1,'the slow boss gait retains its same-side debounce');
 }
});

test('the slow boss walk produces planted-foot events below the former .8 m/s threshold',async()=>{
 const gltf=await loadGLB('assets/production/boss-essential.glb');
 const actor=createActor(gltf,2.5,true,true,{locomotionSpeed:.45}),state={health:100,action:null};
 actor.reset({x:0,z:0,yaw:0});let contacts=0;
 for(let i=0;i<120*12;i++){
  actor.update(1/120,i/120,state,{x:0,z:i/120*.45,yaw:0});
  contacts+=actor.footsteps.length;
 }
 assert.ok(contacts>=6&&contacts<=18,`expected a slow walking cadence, got ${contacts} contacts in 12s`);
});

test('ground dust appears at a descending blade crossing and impact sparks follow the blade',()=>{
 const contact=weaponGroundContact([[0,.3,0],[1,.2,0]],[[0,.2,0],[1,-.2,0]]);
 assert.ok(contact);assert.ok(Math.abs(contact.y-.035)<1e-8);assert.equal(contact.x,1);
 assert.equal(weaponGroundContact([[0,.3,0],[1,.2,0]],[[0,.5,0],[1,.4,0]]),null);
 const at=bladeImpactPoint([[0,1,0],[2,1,0]],new T.Vector3(1.2,1.4,.3));
 assert.deepEqual(at.toArray(),[1.2,1,0]);
});

test('two feet landing after a hop produce one contact, while transition poses and reset stay silent',()=>{
 const tracker=new FootContacts(),action={name:'dodge'},at=y=>({Left:new T.Vector3(-.2,y,0),Right:new T.Vector3(.2,y,0)});
 assert.deepEqual(tracker.update(.1,at(.1),{action,groundHeight:0,settled:false}),[]);
 assert.deepEqual(tracker.update(.1,at(0),{action,groundHeight:0}),[]);
 let contacts=[];
 for(const y of [.06,.14,.09,.007,.003,.001])contacts.push(...tracker.update(.1,at(y),{action,groundHeight:0}));
 assert.equal(contacts.length,1);assert.equal(contacts[0].kind,'landing');assert.equal(contacts[0].side,'both');
 assert.deepEqual(contacts[0].position.toArray(),[0,.035,0]);
 tracker.reset();assert.deepEqual(tracker.update(.1,at(0),{groundHeight:0,moving:true}),[]);
});

test('hit, healing, death and raw source inspection cannot create action footstep feedback',()=>{
 for(const action of [{name:'hit'},{name:'heal'},{name:'death'},{name:'dodge',rawPose:true}]){
  const tracker=new FootContacts(),contacts=[];
  for(const y of [0,.08,.14,.02,0])contacts.push(...tracker.update(.1,{Left:new T.Vector3(0,y,0),Right:new T.Vector3(.2,y,0)},{moving:true,action,groundHeight:0}));
  assert.equal(contacts.length,0,action.name);
 }
});

test('the exported forward roll reports one real boot touchdown after flight, then stays silent while grounded',async()=>{
 const gltf=await loadGLB(fileURLToPath(ASSETS.playerRig));
 const actor=createActor(gltf,1.85,false,true,ASSETS.motion.player);
 const spec=ASSETS.motion.player.clips.dodge,vertices={Left:[],Right:[]},point=new T.Vector3();
 gltf.scene.traverse(mesh=>{
  if(!mesh.isSkinnedMesh)return;const {position,skinIndex,skinWeight}=mesh.geometry.attributes;
  for(let index=0;index<position.count;index++)for(const side of ['Left','Right']){
   let weight=0;for(let c=0;c<4;c++)if(new RegExp(side+'(?:Foot|ToeBase)$').test(mesh.skeleton.bones[skinIndex.getComponent(index,c)].name))weight+=skinWeight.getComponent(index,c);
   if(weight>=.5)vertices[side].push({mesh,index});
  }
 });
 const actualHeights=()=>Object.fromEntries(Object.entries(vertices).map(([side,points])=>[side,Math.min(...points.map(({mesh,index})=>mesh.getVertexPosition(index,point).applyMatrix4(mesh.matrixWorld).y))]));
 assert.equal(spec.direction,'forward');assert.ok(vertices.Left.length>100&&vertices.Right.length>100);
 for(const fps of [30,60,120]){
  const motion=new MotionState({animationMetadata:ASSETS.motion}),action={name:'dodge',elapsed:0,hits:[]};
  motion.player={x:0,z:0,yaw:0};motion.boss={x:0,z:-10,yaw:0};actor.reset(motion.player);
  const state={status:'fighting',player:{health:100,action:null},boss:{phase:1,action:{name:'awaken',elapsed:0}}};
  for(let frame=0;frame<fps/3;frame++){
   actor.update(1/fps,-frame/fps,state.player,motion.player);
   assert.equal(actor.footsteps.length,0,'grounded breathing/reset must not create impacts');
  }
  motion.beginDodge({});const contacts=[];let airborne=false,flightFrames=0,firstTouchdown=null;
  for(let frame=0;frame<Math.ceil(fps*(spec.duration+.6));frame++){
   const time=frame/fps,playing=time<spec.duration;action.elapsed=time;state.player.action=playing?action:null;
   motion.step(1/fps,{},state);actor.update(1/fps,time,state.player,motion.player);
   const heights=actualHeights(),lowest=Math.min(...Object.values(heights));
   if(lowest>.045){airborne=true;flightFrames++;}
   if(airborne&&firstTouchdown===null&&lowest<=.008)firstTouchdown=time;
   for(const contact of actor.footsteps)contacts.push({...contact,time,lowest});
  }
  assert.ok(flightFrames/fps>.15,'both actual boot surfaces leave the floor during the articulated roll');
  assert.ok(Math.abs(motion.player.z-actionTravelAt(spec,spec.duration))<1e-6&&motion.player.z>2.5,'the landing belongs to a forward travelling roll');
  assert.equal(contacts.length,1,`${fps}fps should create one landing`);
  assert.equal(contacts[0].kind,'landing');assert.equal(contacts[0].side,'both');
  assert.ok(contacts[0].lowest<=.008,'feedback coincides with the visible boot surface returning to the floor');
  assert.ok(Math.abs(contacts[0].time-firstTouchdown)<=1/fps+1e-8,`event at${contacts[0].time}s follows actual touchdown at${firstTouchdown}s`);
  assert.ok(contacts[0].position.z>1.5,'dust is emitted at the travelled landing, not the starting point');
 }
});
