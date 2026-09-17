import test from 'node:test';
import assert from 'node:assert/strict';
import {createActionTimings,strikeIndex,actionRate,actionWallTimes} from '../src/game/weapon-motion.js';
import {ASSETS} from '../src/game/asset-paths.js';

test('boss strike windows are clip time: a faster action keeps its windows and only the wall clock shrinks',()=>{
 const timings=createActionTimings(ASSETS.motion.boss,true);
 // The boss advances `elapsed` at actionRate() clip seconds per wall second (encounter.js), so the
 // same strikeIndex boundaries hold at every speed and effects keyed on clip time never drift.
 for(const [name,windows] of [['sweep',[[1.85,2.25]]],['slam',[[timings.slam.windup,timings.slam.windup+timings.slam.active]]],['flurry',[[1.85,2.25],[2.65,3.08]]],['burst',[[2.36,2.81]]]]){
  windows.forEach(([start,end],index)=>{
   assert.equal(strikeIndex(name,start-1e-4,true,timings),-1,`${name} before window ${index} (windows never touch)`);
   assert.equal(strikeIndex(name,start,true,timings),index,`${name} window ${index} opens exactly`);
   assert.equal(strikeIndex(name,end-1e-4,true,timings),index);
   assert.equal(strikeIndex(name,end,true,timings),-1,`${name} window ${index} closes exactly`);
  });
  const wall=actionWallTimes(timings[name]),speed=actionRate(timings[name],0);
  assert.ok(speed>1,`${name} plays faster than the clip`);
  windows.forEach(([start,end],index)=>assert.ok(Math.abs(wall.hitWindows[index][0]-start/speed)<1e-9&&Math.abs(wall.hitWindows[index][1]-end/speed)<1e-9,`${name} wall window ${index}`));
 }
 for(const name of ['awaken','death'])for(const time of [0,.5,1,2.5])assert.equal(strikeIndex(name,time,true,timings),-1,`${name} never strikes`);
});

test('roll, healing and reaction motion cannot emit sword strike effects without an active window',()=>{
 const timings=createActionTimings(ASSETS.motion.player);
 for(const name of ['dodge','heal','hit','death'])for(const time of [0,.1,.5,1,2])assert.equal(strikeIndex(name,time,false,timings),-1,`${name} at ${time}s`);
});

test('absent, invalid and empty active windows stay inactive while real strike boundaries are exact',()=>{
 for(const spec of [{},{windup:0,active:0},{windup:NaN,active:.2},{windup:.2,active:Infinity},{windup:.2,active:-1},{hitWindows:[]},{hitWindows:[[.2,.1],[NaN,1],[0,Infinity]]}])
  for(const time of [0,.2,.5,NaN])assert.equal(strikeIndex('attack',time,false,{attack:spec}),-1);
 const timings={attack:{hitWindows:[[.2,.4],[.7,.8]]}};
 for(const [time,result] of [[.199,-1],[.2,0],[.399,0],[.4,-1],[.7,1],[.8,-1]])assert.equal(strikeIndex('attack',time,false,timings),result);
 assert.equal(strikeIndex('attack',.3,false,{attack:{windup:.2,active:.2}}),0);
});
