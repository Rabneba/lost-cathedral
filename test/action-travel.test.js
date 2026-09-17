import test from 'node:test';
import assert from 'node:assert/strict';
import {MotionState} from '../src/game/motion.js';
import {compileTravelCurve} from '../src/game/action-travel.js';
import {withActorScale} from '../src/game/actor-scale.js';

// Contact-informed shape: planted anticipation, shoulder travel, then recovery.
const curve=[[0,0],[.15,0],[.3,.6],[.65,1.5],[.9,1.8],[1.1,1.8]];
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
function fixture(name='dodge',direction='forward',travelCurve=curve){
 const metadata={clips:{[name]:{duration:1.2,direction,travelCurve}}};
 const motion=new MotionState({animationMetadata:{player:metadata},bounds:{minX:-20,maxX:20,minZ:-20,maxZ:20}});
 motion.player={x:0,z:0,yaw:0};motion.boss={x:0,z:-10,yaw:0};
 const state={status:'fighting',player:{health:100,action:{name,elapsed:0}},boss:{phase:1,action:{name:'awaken',elapsed:0}}};
 return{motion,state};
}

test('measured roll travel uses pose time, keeps planted anticipation and ends equally at 30/60/120 Hz',()=>{
 for(const fps of [30,60,120]){
  const {motion,state}=fixture();motion.velocities.player={x:2,z:-3};
  // No direction held: the roll keeps the clip's authored heading, and the input
  // held through the steps below must not steer the measured travel.
  motion.beginDodge({});
  for(let frame=0;frame<=fps*1.2;frame++){
   const t=frame/fps;state.player.action.elapsed=t;
   motion.step(1/fps,{forward:-1,right:1,lockOn:true},state);
   near(motion.player.x,0);near(motion.player.yaw,0);
   if(t<=.15)near(motion.player.z,0);
   if(Math.abs(t-.3)<1e-8)near(motion.player.z,.6);
   if(t>=.9)near(motion.player.z,1.8);
  }
  near(motion.player.z,1.8);assert.deepEqual(motion.velocities.player,{x:0,z:0});
 }
});

test('hit catch-step locks backward to entry facing and a new hit restarts its own travel',()=>{
 const {motion,state}=fixture('hit','backward');motion.player.yaw=Math.PI/2;
 for(let frame=0;frame<=120;frame++){
  state.player.action.elapsed=frame/120;
  motion.boss.x=frame*.05;
  motion.step(1/120,{lockOn:true,forward:1},state);
 }
 near(motion.player.x,-1.8);near(motion.player.z,0);near(motion.player.yaw,Math.PI/2);
 state.player.action={name:'hit',elapsed:0};motion.step(1/120,{},state);near(motion.player.x,-1.8);
 state.player.action.elapsed=.3;motion.step(1/120,{},state);near(motion.player.x,-2.4);
});

test('measured travel cannot tunnel through a base and blocked distance is not replayed',()=>{
 const {motion,state}=fixture();motion.groundColliders=[{x:0,z:1,radius:.2}];
 // Even a large valid step must sweep the full ground displacement.
 state.player.action.elapsed=.65;motion.step(.25,{},state);
 near(motion.player.z,.35);
 state.player.action.elapsed=1.1;motion.step(.25,{},state);near(motion.player.z,.35);
 motion.groundColliders=[];state.player.action.elapsed=1.2;motion.step(.1,{},state);near(motion.player.z,.35);
 state.player.action=null;motion.step(.1,{},state);assert.equal(motion.actionTravel,null);near(motion.player.z,.35);
});

test('interrupted or reset travel cannot leak into the next stance',()=>{
 const {motion,state}=fixture();state.player.action.elapsed=.3;motion.step(.1,{},state);near(motion.player.z,.6);
 state.player.action={name:'heal',elapsed:0};motion.step(.1,{},state);near(motion.player.z,.6);assert.equal(motion.actionTravel,null);
 motion.reset();assert.equal(motion.actionTravel,null);assert.equal(motion.dodge,null);
});

test('world scaling changes cumulative distance once while preserving action-clock samples',()=>{
 const original={clips:{dodge:{duration:1.2,direction:'forward',travelCurve:curve}}},scaled=withActorScale(original,1.3),restored=withActorScale(scaled,1);
 for(let i=0;i<curve.length;i++){
  near(scaled.clips.dodge.travelCurve[i][0],curve[i][0]);near(scaled.clips.dodge.travelCurve[i][1],curve[i][1]*1.3);
  near(restored.clips.dodge.travelCurve[i][1],curve[i][1]);
 }
 assert.deepEqual(original.clips.dodge.travelCurve,curve);
});

test('invalid measured contact data is rejected before gameplay instead of producing a teleport',()=>{
 for(const invalid of [[[.1,0],[1,2]],[[0,0],[0,1]],[[0,0],[1,-1]],[[0,0],[1,NaN]],[[0,0]]])assert.throws(()=>compileTravelCurve(invalid),RangeError);
});
