// Round 2 boss rules: per-action pace, derived flurry/burst on the approved clips, weighted selection.
// Round 3 (16 Sep evening) re-paced the manifest (sweep 1.5, slam 1.3/1.7, flurry 1.65, burst 1.35, phase two x1.15,
// longer cooldowns) and added the linear fissure; the numbers below follow docs/boss-round3-manifest.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import {ASSETS} from '../src/game/asset-paths.js';
import {Fight} from '../src/game/encounter.js';
import {MotionState} from '../src/game/motion.js';
import {createActionTimings,actionRate,actionWallTimes,clipPlayback,strikeIndex,actionDuration} from '../src/game/weapon-motion.js';
import {bossEngagement,bossAttackSequence} from '../src/game/engagement-range.js';

const boss=ASSETS.motion.boss,timings=createActionTimings(boss,true);
const geo=(over={})=>({distance:1.6,playerFacing:true,bossFacing:true,bossSpeed:0,playerHit:false,bossHit:false,...over});
const run=(fight,seconds,g)=>{for(let i=0;i<Math.round(seconds*120);i++)fight.step(1/120,g);};

test('derived actions inherit their base clip and keep clip-time hit windows; distances are scaled once',()=>{
 assert.equal(timings.flurry.clip,'sweep');assert.equal(timings.burst.clip,'slam');
 assert.deepEqual(timings.flurry.engagementRange,timings.sweep.engagementRange,'the flurry stands where the sweep stands');
 assert.deepEqual(timings.flurry.segments,[[0,2.45,2.45],[2.45,0,2.45]]);
 assert.equal(actionDuration(timings.flurry),4.9);
 assert.ok(Math.abs(timings.burst.reach-3.2)<1e-5&&Math.abs(timings.burst.engagementRange[0]-1.4)<1e-5&&Math.abs(timings.burst.engagementRange[1]-3)<1e-5,'burst distances are world metres after the 1.3 actor scale');
 assert.equal(strikeIndex('flurry',2.0,true,timings),0);assert.equal(strikeIndex('flurry',2.5,true,timings),-1);assert.equal(strikeIndex('flurry',2.8,true,timings),1);assert.equal(strikeIndex('flurry',3.2,true,timings),-1);
 assert.equal(strikeIndex('burst',2.5,true,timings),0);assert.equal(strikeIndex('burst',2.9,true,timings),-1);
 assert.throws(()=>createActionTimings({clips:{sweep:{duration:1}},actions:{x:{clip:'nothing'}}},true),RangeError);
 assert.throws(()=>createActionTimings({clips:{sweep:{duration:1}},actions:{x:{clip:'sweep',segments:[[0,1]],duration:3}}},true),RangeError);
 assert.throws(()=>createActionTimings({clips:{sweep:{duration:1}},actions:{x:{clip:'sweep',radial:true}}},true),RangeError);
});

test('the flurry replays the sweep forward then straight back, the burst plays the slam clip time',()=>{
 const at=(name,elapsed)=>clipPlayback({name,elapsed,hits:[]},timings);
 assert.equal(at('flurry',1.0).name,'sweep');assert.equal(at('flurry',1.0).time,1.0);
 assert.ok(Math.abs(at('flurry',2.45).time-2.45)<1e-9);
 assert.ok(Math.abs(at('flurry',3.0).time-1.9)<1e-9,'the return pass runs the clip backwards from 2.45');
 assert.ok(Math.abs(at('flurry',4.9).time)<1e-9,'the flurry ends on the clip start pose');
 assert.equal(at('flurry',1.0).duration,4.4,'the animation maps clip time against the base clip length');
 assert.equal(at('burst',2.5).name,'slam');assert.equal(at('burst',2.5).time,2.5);
 assert.equal(clipPlayback({name:'sweep',elapsed:1},timings),null);
 assert.equal(clipPlayback(null,timings),null);
});

test('per-action pace: windups, active windows and recoveries scale with each action speed and the phase',()=>{
 assert.equal(actionRate(timings.sweep,0),1.5);assert.equal(actionRate(timings.slam,0),1.3);
 assert.equal(actionRate(timings.slam,2.4),1.7,'the slam recovery runs faster once its hit window has passed');
 assert.equal(actionRate(timings.slam,2.4,1.15),1.7*1.15);
 assert.equal(actionRate(timings.awaken,1),1);
 const sweep=actionWallTimes(timings.sweep);
 assert.ok(Math.abs(sweep.windup-1.85/1.5)<1e-9&&Math.abs(sweep.active-.4/1.5)<1e-9&&Math.abs(sweep.recovery-2.15/1.5)<1e-9);
 assert.deepEqual(sweep.hitWindows,[[1.85/1.5,2.25/1.5]]);
 const slam=actionWallTimes(timings.slam);
 assert.ok(Math.abs(slam.windup-timings.slam.windup/1.3)<1e-9&&Math.abs(slam.recovery-(4.9-timings.slam.hitWindows[0][1])/1.7)<1e-9);
 const flurry=actionWallTimes(timings.flurry,1.15);
 assert.ok(Math.abs(flurry.total-4.9/(1.65*1.15))<1e-9);
 assert.equal(actionWallTimes(null),null);
 const fight=new Fight(ASSETS.motion);fight.start();
 fight.boss.action={name:'sweep',elapsed:0,hits:[]};run(fight,1,geo());
 assert.ok(Math.abs(fight.boss.action.elapsed-1.5)<1e-6,'a second of wall time advances the sweep 1.5 clip seconds');
 fight.boss.phase=2;fight.boss.action={name:'burst',elapsed:0,hits:[]};run(fight,1,geo({distance:5}));
 assert.ok(Math.abs(fight.boss.action.elapsed-1.35*1.15)<1e-6);
});

test('the burst hits by distance inside its reach, not by blade contact, and respects the roll and the guard',()=>{
 const fight=new Fight(ASSETS.motion);fight.playerDamageTaken=1;fight.start();
 // One 1/120 s step at the burst's 1.25x rate carries 2.355 past the 2.36 window start.
 fight.boss.action={name:'burst',elapsed:2.355,hits:[]};
 fight.step(1/120,geo({distance:3.19,bossHit:false}));
 assert.equal(fight.player.health,70,'inside 3.2 m the ring lands without any blade geometry');
 assert.deepEqual(fight.drain().at(-1),{type:'player-hit',damage:30,action:'burst'});
 fight.reset();fight.start();fight.boss.action={name:'burst',elapsed:2.355,hits:[]};
 fight.step(1/120,geo({distance:3.21,bossHit:true}));
 assert.equal(fight.player.health,100,'outside the reach even a blade overlap does nothing');
 fight.reset();fight.start();fight.request('dodge');run(fight,.2,geo({distance:5}));
 fight.boss.action={name:'burst',elapsed:2.355,hits:[]};fight.step(1/120,geo({distance:1.5}));
 assert.equal(fight.player.health,100);assert.equal(fight.stats.evades,1);
 fight.reset();fight.start();fight.player.blocking=true;fight.boss.action={name:'burst',elapsed:2.355,hits:[]};fight.step(1/120,geo({distance:1.5}));
 assert.equal(fight.player.health,96);assert.equal(fight.stats.blocks,1);
});

test('the flurry resolves two independent cuts; a hit on the first does not cover the second',()=>{
 const fight=new Fight(ASSETS.motion);fight.playerDamageTaken=1;fight.start();
 fight.boss.action={name:'flurry',elapsed:1.8,hits:[]};
 run(fight,.45,geo({bossHit:true}));
 assert.equal(fight.player.health,80);assert.equal(fight.stats.hits,1);
 run(fight,.5,geo({bossHit:true}));
 assert.equal(fight.player.health,60,'the return pass lands its own hit');assert.equal(fight.stats.hits,2);
 run(fight,3,geo({bossHit:true,distance:12}));
 assert.equal(fight.player.health,60);assert.equal(fight.boss.action,null,'the flurry ends after its 4.9 clip seconds and nothing starts out of range');
 assert.equal(fight.bossCooldown(timings.flurry),.75);fight.boss.phase=2;assert.equal(fight.bossCooldown(timings.sweep),.8*ASSETS.motion.boss.phaseTwoCooldownMultiplier);
});

test('weighted selection only offers attacks whose band contains the player and never the same one three times running',()=>{
 assert.deepEqual(bossAttackSequence(boss,1).sort(),['burst','fissure','flurry','slam','sweep']);
 const names=distance=>bossEngagement(boss,1,distance,0,{random:0}).eligible.map(e=>e.name).sort();
 assert.deepEqual(names(1.6),['burst','flurry','sweep']);
 assert.deepEqual(names(2.8),['burst','slam']);
 assert.deepEqual(names(3.2),['fissure','slam']);
 assert.deepEqual(names(5),['fissure'],'past the slam band only the fissure reaches');
 assert.deepEqual(names(9.5),[]);
 const far=bossEngagement(boss,1,9.5,0,{random:0});
 assert.equal(far.selected,null);assert.ok(Math.abs(far.targetDistance-3.9)<1e-5,'walks to the fissure band first (preferred 3.0 authored = 3.9 world)');
 const exhausted=bossEngagement(boss,1,3.2,4,{random:.5,history:['slam','slam']});
 assert.equal(exhausted.selected.name,'fissure','a third slam in a row is refused and the fissure takes the band');
 const spent=bossEngagement(boss,1,8,4,{random:.5,history:['fissure','fissure']});
 assert.equal(spent.selected,null,'a third fissure in a row is refused');
 assert.ok(spent.targetDistance<3.4,'and the boss walks in to the slam band instead of standing still');
 const fresh=bossEngagement(boss,1,3.2,4,{random:.5,history:['sweep','slam']});
 assert.equal(fresh.selected.name,'slam');assert.equal(fresh.selected.nextIndex,5);
 for(let i=0;i<40;i++){const pick=bossEngagement(boss,2,1.6,0,{random:i/40,history:['flurry','flurry']}).selected.name;assert.notEqual(pick,'flurry');}
 assert.equal(bossEngagement(boss,1,1.6,0,{random:0,forced:'burst'}).selected.name,'burst','the forced opener wins when eligible');
 assert.equal(bossEngagement(boss,1,3.2,0,{random:0,forced:'burst'}).selected.name,'slam','and is ignored out of its band');
 let draws=0;bossEngagement(boss,1,1.6,0,{random:()=>{draws++;return .5;}});assert.equal(draws,1,'one draw per choice');
 draws=0;bossEngagement(boss,1,12,0,{random:()=>{draws++;return .5;}});assert.equal(draws,0,'no draw when nothing is eligible');
 assert.throws(()=>bossEngagement(boss,1,1.6,0,{random:1}),RangeError);
});

test('three unanswered hits make the eruption near certain; the boss opens phase two with it',()=>{
 const counts={};
 for(let seed=0;seed<30;seed++){
  const fight=new Fight(ASSETS.motion);fight.start();fight.seed=seed*7919;fight.cooldown=0;fight.punish=3;
  fight.step(1/120,geo({distance:1.6}));counts[fight.boss.action.name]=(counts[fight.boss.action.name]||0)+1;
 }
 // x8 among sweep 3 + flurry 1.5 is 64 % of the pool; 30 fixed seeds land 18 or more.
 assert.ok((counts.burst||0)>=18,`punished selections favour the burst: ${JSON.stringify(counts)}`);
 const fight=new Fight(ASSETS.motion);fight.start();
 fight.boss.health=901;fight.request('light');run(fight,.5,geo({playerHit:true}));
 assert.equal(fight.boss.phase,2);assert.equal(fight.boss.action.name,'awaken');assert.equal(fight.forced,'burst');
 run(fight,2.7,geo({distance:1.6}));
 assert.equal(fight.boss.action,null,'the awakening has ended');assert.ok(fight.cooldown>0&&fight.cooldown<=.65,'and its pause is counting down');
 run(fight,.7,geo({distance:1.6}));
 assert.equal(fight.boss.action.name,'burst','the first attack of phase two is the eruption');assert.equal(fight.forced,null);
 assert.ok(fight.drain().some(e=>e.type==='boss-tell'&&e.name==='burst'&&e.action==='burst'),'boss-tell carries the name under both keys');
});

test('a full scripted fight replays identically at 30, 60 and 120 Hz and after a reset',()=>{
 function play(fps){
  const fight=new Fight(ASSETS.motion),motion=new MotionState({animationMetadata:ASSETS.motion,approachDistance:ASSETS.motion.boss.approachDistance});fight.start();
  let remainder=0;const tells=[];
  for(let frame=0;frame<fps*40;frame++){remainder+=1/fps;while(remainder+1e-10>=1/120){remainder-=1/120;motion.step(1/120,{forward:motion.geometry().distance>motion.bodySeparation+.05?1:0,cameraYaw:Math.atan2(motion.player.x-motion.boss.x,motion.player.z-motion.boss.z),lockOn:true},fight);fight.step(1/120,motion.geometry());for(const e of fight.drain())if(e.type==='boss-tell')tells.push([Math.round(fight.time*120),e.name]);}}
  return {tells,health:fight.player.health,seed:fight.seed};
 }
 const a=play(30),b=play(60),c=play(120);
 assert.deepEqual(a,b);assert.deepEqual(b,c);
 assert.ok(a.tells.length>=5,'the boss keeps attacking a player who stands in range');
 assert.ok(new Set(a.tells.map(([,name])=>name)).size>=2,'and varies its attacks');
 const fight=new Fight(ASSETS.motion);fight.start();fight.random();fight.history.push('sweep');fight.punish=2;fight.forced='burst';fight.reset();
 assert.deepEqual(fight,new Fight(ASSETS.motion));
});

test('the approach agrees with the fight: an exhausted band walks the boss in, the phase-two walk keeps the gait inside its rate clamp',()=>{
 const fight=new Fight(ASSETS.motion),motion=new MotionState({animationMetadata:ASSETS.motion,approachDistance:ASSETS.motion.boss.approachDistance});fight.start();fight.cooldown=0;
 motion.boss={x:0,z:0,yaw:0};motion.player={x:0,z:8,yaw:Math.PI};fight.history=['fissure','fissure'];
 for(let i=0;i<1500&&!fight.boss.action;i++){motion.step(1/120,{},fight);fight.step(1/120,motion.geometry());}
 assert.ok(fight.boss.action,'the boss did not stall at fissure range after two fissures');
 assert.notEqual(fight.boss.action.name,'fissure');
 assert.ok(motion.geometry().distance<3.4,'it walked into the slam band to attack');
 const walk=ASSETS.motion.boss.clips['walk-forward'].sourceSpeed;
 assert.ok(ASSETS.motion.boss.locomotionSpeed/walk<=1.4+1e-9,'phase one walk within the 1.4x clip rate clamp');
 assert.ok(ASSETS.motion.boss.locomotionSpeed*ASSETS.motion.boss.phaseTwoWalkMultiplier/walk<=1.4+1e-9,'phase two walk within the clamp');
 assert.ok(ASSETS.motion.boss.idleTurnRate/120<.02,'the idle turn still cannot spin in one step');
});
