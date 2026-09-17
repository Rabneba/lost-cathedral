import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {ActorAnimation} from '../src/game/animation-controller.js';
import {createActor} from '../src/game/actors.js';
import {Fight} from '../src/game/encounter.js';
import {MotionState} from '../src/game/motion.js';
import {loadGLB} from '../scripts/load-glb-node.mjs';

const approx=(a,b,epsilon=1e-6)=>assert.ok(Math.abs(a-b)<epsilon,`${a} differs from ${b}`);
function fixture(){
 const root=new T.Group(),hips=new T.Bone();hips.name='Hips';root.add(hips);
 const clip=(name,duration,value)=>new T.AnimationClip(name,duration,[new T.NumberKeyframeTrack('Hips.position[x]',[0,duration],[value,value])]);
 return {root,hips,clips:[clip('idle',4,0),clip('run-forward',2,1),clip('run-right',1.5,-1),new T.AnimationClip('dodge',2,[new T.NumberKeyframeTrack('Hips.position[y]',[0,1,2],[0,-.6,0])])]};
}

test('reversing direction during a fade keeps the rendered pose continuous and retires old actions',()=>{
 const {root,hips,clips}=fixture(),animation=new ActorAnimation(root,clips);
 let previous=0;
 for(let frame=0;frame<360;frame++){
  const name=frame<180?['idle','run-forward','run-right'][Math.floor(frame/7)%3]:'idle';
  animation.update(1/120,name,{speed:1});
  const state=animation.debugState();
  approx(state.layers.reduce((sum,layer)=>sum+layer.weight,0),1);
  assert.ok(Math.abs(hips.position.x-previous)<.18,'no one-frame pose snap on interrupted transition');
  previous=hips.position.x;
 }
 approx(hips.position.x,0);
 assert.deepEqual(animation.debugState().layers.map(layer=>layer.name),['idle']);
});

test('changing locomotion clips preserves the point in the stride',()=>{
 const {root,clips}=fixture(),animation=new ActorAnimation(root,clips);
 animation.update(.6,'run-forward');
 animation.update(0,'run-right');
 const layers=animation.debugState().layers;
 approx(layers.find(layer=>layer.name==='run-forward').time/2,layers.find(layer=>layer.name==='run-right').time/1.5);
});

test('gameplay action time drives the full clip once and an exact inspector seek bypasses timing and blending',()=>{
 const {root,hips,clips}=fixture(),animation=new ActorAnimation(root,clips);
 animation.update(.5,'idle');
 const action={name:'dodge',elapsed:2};
 animation.update(.2,'dodge',{action,duration:4});
 approx(hips.position.y,-.6);
 action.elapsed=20;animation.update(.2,'dodge',{action,duration:4});
 approx(hips.position.y,0);
 animation.update(0,'dodge',{action:{name:'dodge',elapsed:.5,directClipTime:true},duration:4});
 approx(hips.position.y,-.3);
 animation.update(0,'idle',{action:{name:'idle',elapsed:0,directClipTime:true}});
 approx(hips.position.y,0);
});

test('a skeletal evasive step does not rotate or lift the entire actor',()=>{
 const {root,hips,clips}=fixture();
 const actor=createActor({scene:root,animations:clips},1.85,false,true,{clips:{dodge:{duration:2}}});
 const origin={x:0,z:0,yaw:0};actor.reset(origin);
 actor.update(.2,1,{health:100,action:{name:'dodge',elapsed:1}},origin);
 approx(hips.position.y,-.6);
 assert.deepEqual(actor.visualRoot.rotation.toArray().slice(0,3),[0,0,0]);
 assert.deepEqual(actor.visualRoot.position.toArray(),[0,0,0]);
});

test('right strafing while facing the boss selects the anatomical right gait',()=>{
 const {root,clips}=fixture();
 clips.push(new T.AnimationClip('run-left',1,[new T.NumberKeyframeTrack('Hips.position[x]',[0,1],[0,0])]));
 const actor=createActor({scene:root,animations:clips},1.85,false,true);
 actor.reset({x:0,z:0,yaw:Math.PI});
 actor.update(1/60,0,{health:100,action:null},{x:.04,z:0,yaw:Math.PI});
 assert.equal(actor.animation.debugState().current,'run-right');
});

test('the approved idle plays with its baked quarter-speed timing at runtime rate one',async()=>{
 const gltf=await loadGLB('assets/approved/boss-idle.glb');
 const animation=new ActorAnimation(gltf.scene,gltf.animations);
 assert.ok(gltf.animations[0].duration>26&&gltf.animations[0].duration<27);
 for(let i=0;i<120;i++)animation.update(1/120,'idle');
 approx(animation.debugState().layers[0].time,1);
});

test('clip phase metadata moves the damage window and recovery together',()=>{
 const fight=new Fight({player:{clips:{light:{duration:2.4,windup:1.2,active:.25,recovery:.95}}}});fight.start();fight.request('light');
 const geometry={distance:10,playerHit:true,bossHit:false};
 for(let i=0;i<120;i++)fight.step(1/120,geometry);
 assert.equal(fight.boss.health,1800);
 for(let i=0;i<40;i++)fight.step(1/120,geometry);
 assert.equal(fight.boss.health,1745);
 assert.equal(fight.request('heavy'),false);
 for(let i=0;i<140;i++)fight.step(1/120,geometry);
 assert.equal(fight.player.action,null);
 assert.equal(fight.boss.health,1745);
});

test('a backward-step clip uses its authored travel distance regardless of input or update rate',()=>{
 for(const fps of [30,120]){
  const metadata={player:{clips:{dodge:{duration:1.1,travelDuration:.65,distance:1.35,direction:'backward'}}}};
  const fight=new Fight(metadata),motion=new MotionState({animationMetadata:metadata});fight.start();fight.request('dodge');
  // Nothing held at the start: the authored backward step owns the heading, and the
  // direction held through the steps below cannot change its distance.
  motion.beginDodge({});
  for(let i=0;i<fps;i++){motion.step(1/fps,{right:1,lockOn:true},fight);fight.step(1/fps,{distance:12});}
  approx(motion.player.x,0);approx(motion.player.z,9.35);approx(motion.player.yaw,Math.PI);
 }
});

test('a slow guarded boss approaches at the configured walk pace and cannot instantly spin around',()=>{
 const fight=new Fight();fight.start();
 const motion=new MotionState({animationMetadata:{boss:{locomotionSpeed:.75}}});
 for(let i=0;i<120;i++)motion.step(1/120,{},fight);
 const travelled=motion.boss.z+4;assert.ok(travelled>.6&&travelled<.75);
 motion.player.z=-10;const previous=motion.boss.yaw;
 motion.step(1/120,{},fight);
 assert.ok(Math.abs(motion.boss.yaw-previous)<.02);
});

test('an evasive step plants for its anticipation and can repeat directly after recovery',()=>{
 const metadata={player:{clips:{dodge:{duration:.94,travelStart:.12,travelDuration:.48,distance:1.2,direction:'backward'}}}};
 const fight=new Fight(metadata),motion=new MotionState({animationMetadata:metadata});fight.start();
 for(let repetition=0;repetition<2;repetition++){
  assert.equal(fight.request('dodge'),true);motion.beginDodge({});
  const start=motion.player.z;
  for(let i=0;i<12;i++){motion.step(1/120,{},fight);fight.step(1/120,{distance:12});}
  approx(motion.player.z,start);
  while(fight.player.action){motion.step(1/120,{},fight);fight.step(1/120,{distance:12});}
  approx(motion.player.z,start+1.2);
 }
});

test('running into a committed boss stops the player instead of pushing the boss across the arena',()=>{
 const fight=new Fight(),motion=new MotionState();fight.start();
 const spacing=motion.bodySeparation;
 motion.player={x:0,z:0,yaw:0};motion.boss={x:0,z:spacing,yaw:Math.PI};
 fight.boss.action={name:'sweep',elapsed:1.2,hits:[]};
 for(let frame=0;frame<240;frame++)motion.step(1/120,{forward:1,cameraYaw:Math.PI,lockOn:true},fight);
 approx(motion.boss.z,spacing);approx(motion.boss.x,0);
 assert.ok(motion.geometry().distance>=spacing-1e-6);
 assert.ok(Math.abs(motion.player.z)<1e-6);
});
