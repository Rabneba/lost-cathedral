import test from 'node:test';
import assert from 'node:assert/strict';
import {bossEngagement} from '../src/game/engagement-range.js';
import {withActorScale} from '../src/game/actor-scale.js';
import {Fight} from '../src/game/encounter.js';
import {MotionState} from '../src/game/motion.js';

const boss={worldScale:1.3,locomotionSpeed:.6,attackRange:99,attackSequence:['slam','sweep','sweep'],phaseTwoAttackSequence:['sweep','slam'],clips:{sweep:{engagementRange:[1.3,2.65],preferredDistance:2.55},slam:{engagementRange:[2.75,3.5],preferredDistance:3.1}}};
const metadata={boss};

test('authored attack bands scale once, round-trip, and leave collision/timing data untouched',()=>{
 const original={clips:{sweep:{engagementRange:[1,2],preferredDistance:1.7,hitWindows:[[.6,.8]],damage:29}},weaponSegment:[[0,1,0],[0,2,0]]};
 const snapshot=structuredClone(original),large=withActorScale(original,1.3),twice=withActorScale(large,1.3);
 assert.deepEqual(large.clips.sweep.engagementRange,[1.3,2.6]);
 assert.equal(large.clips.sweep.preferredDistance,2.21);
 assert.deepEqual(twice,large);assert.deepEqual(original,snapshot);
 assert.deepEqual(withActorScale(large,1).clips.sweep.engagementRange,[1,2]);
 assert.deepEqual(large.clips.sweep.hitWindows,original.clips.sweep.hitWindows);
 assert.deepEqual(large.weaponSegment,original.weaponSegment);
 assert.throws(()=>bossEngagement({clips:{sweep:{engagementRange:[2,1]}}}),RangeError);
});

test('sequence skips unusable moves without consuming turns while waiting and handles both edges',()=>{
 for(const distance of [1.3,1.3+1e-10,2.65-1e-10,2.65])assert.equal(bossEngagement(boss,1,distance,0).selected.name,'sweep');
 assert.equal(bossEngagement(boss,1,2.6501).selected,null);
 assert.equal(bossEngagement(boss,1,2.7).selected,null);
 assert.equal(bossEngagement(boss,1,2.75).selected.name,'slam');
 assert.equal(bossEngagement(boss,1,3.5).selected.name,'slam');
 assert.equal(bossEngagement(boss,1,3.5001).selected,null);
 assert.deepEqual(bossEngagement(boss,1,1.4,0).selected,{name:'sweep',nextIndex:2});
 assert.deepEqual(bossEngagement(boss,1,1.4,2).selected,{name:'sweep',nextIndex:3});
 assert.equal(bossEngagement(boss,1,12).targetDistance,3.1);
 assert.equal(bossEngagement(boss,1,2.7).targetDistance,2.55);
 assert.equal(bossEngagement(boss,1,1.2).targetDistance,null,'no reverse walking below all measured ranges');
});

test('eligible boss waits for facing and a settled stance; range alone never deals damage',()=>{
 const fight=new Fight(metadata);fight.start();fight.cooldown=0;
 const geometry={distance:1.4,bossFacing:false,bossSpeed:0,bossHit:false};
 fight.step(.01,geometry);assert.equal(fight.boss.action,null);assert.equal(fight.attackIndex,0);
 geometry.bossFacing=true;geometry.bossSpeed=.4;
 fight.step(.01,geometry);assert.equal(fight.boss.action,null);assert.equal(fight.attackIndex,0);
 geometry.bossSpeed=.07;fight.step(.01,geometry);assert.equal(fight.boss.action.name,'sweep');
 const action=fight.boss.action;
 for(let i=0;i<230;i++)fight.step(1/120,{...geometry,distance:3.2,bossFacing:false});
 assert.equal(fight.boss.action,action,'already committed attacks retain their action through recovery');
 assert.equal(fight.player.health,100,'eligible attack selection cannot substitute for visible blade geometry');
});

test('gap and far approaches move forward, settle inside an eligible band, and cannot stall there',()=>{
 for(const initial of [12,2.7,1.4]){
  const fight=new Fight(metadata),motion=new MotionState({animationMetadata:metadata});fight.start();fight.cooldown=0;
  motion.boss={x:0,z:0,yaw:0};motion.player={x:0,z:initial,yaw:Math.PI};
  let previous=motion.boss.z;
  for(let i=0;i<2400&&!fight.boss.action;i++){
   motion.step(1/120,{},fight);const geometry=motion.geometry();
   assert.ok(motion.boss.z>=previous-1e-9,'only the visible forward gait advances the boss');previous=motion.boss.z;
   fight.step(1/120,geometry);
  }
  assert.ok(fight.boss.action,`approach from ${initial} must find a usable move`);
  const geometry=motion.geometry(),range=boss.clips[fight.boss.action.name].engagementRange;
  assert.ok(geometry.distance>=range[0]-1e-7&&geometry.distance<=range[1]+1e-7);
  assert.ok(geometry.bossSpeed<=.08&&geometry.bossFacing);
  assert.equal(fight.boss.action.name,initial===12?'slam':'sweep');
 }
});

test('range decisions and actual travel agree at 30, 60 and 120 Hz with the game fixed step',()=>{
 function run(fps){
  const fight=new Fight(metadata),motion=new MotionState({animationMetadata:metadata});fight.start();fight.cooldown=0;
  motion.boss={x:0,z:0,yaw:Math.PI};motion.player={x:0,z:2.7,yaw:Math.PI};
  const trace=[];let remainder=0;
  for(let frame=0;frame<fps*16;frame++){
   remainder+=1/fps;
   while(remainder>=1/120-1e-10){
    motion.step(1/120,{},fight);fight.step(1/120,motion.geometry());remainder-=1/120;
    for(const event of fight.drain())if(event.type==='boss-tell')trace.push({time:Math.round(fight.time*120),name:event.name,distance:motion.geometry().distance});
   }
  }
  assert.ok(trace.length>=3,'boss turns, crosses the gap, then keeps attacking in its usable range');
  return {trace,boss:motion.boss,health:fight.player.health};
 }
 assert.deepEqual(run(30),run(60));assert.deepEqual(run(60),run(120));
});

test('unconfigured legacy sequences retain their distance threshold and do not gain new facing gates',()=>{
 const fight=new Fight();fight.start();fight.cooldown=0;
 fight.step(.01,{distance:3.1,bossFacing:false});assert.equal(fight.boss.action,null);
 fight.step(.01,{distance:3.09,bossFacing:false,bossSpeed:4});assert.equal(fight.boss.action.name,'sweep');
});
