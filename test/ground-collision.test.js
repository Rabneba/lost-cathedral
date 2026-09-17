import test from 'node:test';
import assert from 'node:assert/strict';
import {slideGround} from '../src/game/ground-collision.js';
import {candleGroundColliders} from '../src/game/arena-layout.js';
import {MotionState} from '../src/game/motion.js';

const bounds={minX:-9.5,maxX:9.5,minZ:-15.5,maxZ:16};
const obstacles=candleGroundColliders();
const legal=(p,radius)=>{
 assert.ok(p.x>=bounds.minX+radius-1e-7&&p.x<=bounds.maxX-radius+1e-7,'inside X bounds');
 assert.ok(p.z>=bounds.minZ+radius-1e-7&&p.z<=bounds.maxZ-radius+1e-7,'inside Z bounds');
 for(const o of obstacles)assert.ok(Math.hypot(p.x-o.x,p.z-o.z)>=radius+o.radius-1e-6,'outside stand base');
};

test('a fast dodge cannot cross a stand even when its endpoint is beyond it',()=>{
 const p={x:8.8,z:2};
 slideGround(p,{x:0,z:-4},.45,bounds,obstacles);
 assert.ok(Math.abs(p.z-.8)<1e-7);legal(p,.45);
});

test('glancing travel slides around a round base and keeps making forward progress',()=>{
 const p={x:8.2,z:2};
 for(let i=0;i<180;i++){slideGround(p,{x:0,z:-.025},.45,bounds,obstacles);legal(p,.45);}
 assert.ok(p.z< -1.7,'passed the stand instead of snagging');
 assert.ok(p.x<8.01,'slid toward the free side of the base');
});

test('a stand near the arena edge cannot trap a dodging actor or break bounds',()=>{
 for(const fps of [30,60,120])for(const radius of [.45,1.1]){
  const p={x:bounds.maxX-radius,z:1.8};
  for(let i=0;i<fps;i++){slideGround(p,{x:0,z:-3/fps},radius,bounds,obstacles);legal(p,radius);}
  const stopped=p.z;
  for(let i=0;i<fps;i++){slideGround(p,{x:-2/fps,z:2/fps},radius,bounds,obstacles);legal(p,radius);}
  assert.ok(p.z>stopped+1.8&&p.x<bounds.maxX-radius-1.8,'retreat and inward steering remain available');
 }
});

test('overlap correction at an edge finds a valid rim point for both actor radii',()=>{
 for(const radius of [.45,1.1]){
  const p={x:bounds.maxX-radius,z:0};
  slideGround(p,{x:0,z:0},radius,bounds,obstacles);legal(p,radius);
  slideGround(p,{x:-2,z:0},radius,bounds,obstacles);legal(p,radius);
 }
});

test('guard movement respects configured pace without changing ordinary running',()=>{
 const run=guard=>{
  const m=new MotionState({animationMetadata:{player:{guardSpeed:1.45,locomotionSpeed:2.96}}});
  const state={status:'fighting',player:{blocking:guard},boss:{action:{name:'sweep',elapsed:3},phase:1}};
  for(let i=0;i<240;i++)m.step(1/120,{right:1},state);
  return m.player.x;
 };
 assert.ok(Math.abs(run(true)-1.45*(2-1/12))<1e-7);
 assert.ok(Math.abs(run(false)-2.96*(2-1/12))<1e-7);
});
