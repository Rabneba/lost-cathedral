import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import * as T from 'three';
import {loadGLB} from './load-glb-node.mjs';
import {ASSETS} from '../src/game/asset-paths.js';
import {createActor,weaponSegmentFor} from '../src/game/actors.js';
import {Fight} from '../src/game/encounter.js';
import {MotionState} from '../src/game/motion.js';
import {candleGroundColliders} from '../src/game/arena-layout.js';
import {actorCapsule,actorDimensions} from '../src/game/actor-scale.js';
import {actionDuration,strikeIndex,sweptWeaponContact} from '../src/game/weapon-motion.js';
import {bossAttackSequence,bossEngagement,engagementRange} from '../src/game/engagement-range.js';

const STEP=1/120, MAX_TIME=300;
const dimensions={player:actorDimensions(false,ASSETS.motion.player),boss:actorDimensions(true,ASSETS.motion.boss)};
const paths={player:fileURLToPath(ASSETS.playerRig),boss:fileURLToPath(ASSETS.bossRig)};
const actors=Object.fromEntries(await Promise.all(['player','boss'].map(async kind=>{
 const isBoss=kind==='boss',gltf=await loadGLB(paths[kind]);
 const actor=createActor(gltf,isBoss?2.5:1.85,isBoss,true,ASSETS.motion?.[kind]);
 const socket=gltf.scene.getObjectByName('WeaponSocket');
 if(!socket)throw new Error(`${kind} has no exported WeaponSocket`);
 actor.weapon=new T.Group();actor.weapon.rotation.x=Math.PI/2;socket.add(actor.weapon);
 actor.weaponSegment=weaponSegmentFor(isBoss,ASSETS);
 return [kind,actor];
})));

function geometry(motion){
 const p=motion.player,b=motion.boss,geo=motion.geometry();
 geo.playerHit=sweptWeaponContact(actors.player.previousSegment,actors.player.segment,actorCapsule(b,dimensions.boss),dimensions.boss.hurtRadius);
 geo.bossHit=sweptWeaponContact(actors.boss.previousSegment,actors.boss.segment,actorCapsule(p,dimensions.player),dimensions.player.hurtRadius);
 return geo;
}
function resetActors(motion){for(const kind of ['player','boss'])actors[kind].reset(motion[kind]);}
function animate(dt,time,fight,motion){for(const kind of ['player','boss'])actors[kind].update(dt,time,fight[kind],motion[kind]);}
function windows(name,spec){
 if(spec.hitWindows)return spec.hitWindows;
 return name==='combo'?[[spec.windup,spec.windup+spec.active*.43],[spec.windup+spec.active*.64,spec.windup+spec.active]]:[[spec.windup,spec.windup+spec.active]];
}

// These are whole-clip socket checks, including the same blend-in and animation
// time mapping used by the live game. Props remain separately fitted assets.
const contactChecks=[];
for(const kind of ['player','boss']){
 const boss=kind==='boss',actor=actors[kind],fight=new Fight(ASSETS.motion);
 const selectedBossMoves=new Set([1,2].flatMap(phase=>bossAttackSequence(ASSETS.motion.boss,phase)));
 const rangedBoss=[1,2].some(phase=>bossEngagement(ASSETS.motion.boss,phase).ranged);
 // Derived boss actions play a base clip (`spec.clip`); radial ones hit by distance, not blade geometry, so they are not blade-checked.
 for(const [name,spec] of Object.entries(fight.timings[kind]).filter(([name,spec])=>spec.damage&&!spec.radial&&!spec.linear&&actor.clips.has(spec.clip??name)&&(!boss||selectedBossMoves.has(name)&&(!rangedBoss||engagementRange(spec))))){
  const contactDistance=dimensions.player.bodyRadius+dimensions.boss.bodyRadius+.05;
  const band=boss?engagementRange(spec):null;
  const lower=band?Math.max(contactDistance,band[0]):0,rangeSteps=band?Math.max(1,Math.ceil((band[1]-lower)/.15)):0;
  if(band&&lower>band[1])throw new Error(`${name} engagementRange is entirely inside physical body separation`);
  const ranges=band?Array.from({length:rangeSteps+1},(_,i)=>lower+(band[1]-lower)*i/rangeSteps)
   :boss?[contactDistance+.05,ASSETS.motion?.boss?.approachDistance??2.35,ASSETS.motion?.boss?.attackRange??3.1]:[contactDistance,contactDistance+.12,contactDistance+.8];
  ranges.push(Math.max(6,(band?.[1]??0)+2));
  const samples=[];
  for(const range of ranges){
   const origin={x:0,z:0,yaw:0},action={name,elapsed:0,hits:[]},contacts=[];
   actor.reset(origin);actor.update(.3,0,{health:100,action:null},origin);
   const targetDimensions=dimensions[boss?'player':'boss'],capsule=actorCapsule({x:0,z:range},targetDimensions);
   for(let t=0;t<=actionDuration(spec);t+=STEP){
    action.elapsed=t;actor.update(STEP,t,{health:100,action},origin);
    if(strikeIndex(name,t,boss,fight.timings[kind])>=0&&sweptWeaponContact(actor.previousSegment,actor.segment,capsule,targetDimensions.hurtRadius))contacts.push(t);
   }
   samples.push({range,contactFrames:contacts.length,firstContact:contacts.length?+contacts[0].toFixed(3):null,lastContact:contacts.length?+contacts.at(-1).toFixed(3):null});
  }
  contactChecks.push({actor:kind,clip:name,duration:actionDuration(spec),windows:windows(name,spec),engagementRange:band,samples,nearContact:(band?samples.slice(0,-1):samples.slice(0,2)).every(sample=>sample.contactFrames>1),farMiss:samples.at(-1).contactFrames===0});
 }
}

function run(strategy,fps){
 const fight=new Fight(ASSETS.motion),motion=new MotionState({groundColliders:candleGroundColliders(),animationMetadata:ASSETS.motion,approachDistance:ASSETS.motion?.boss?.approachDistance??2.35,bounds:{minX:-9.5,maxX:9.5,minZ:-15.5,maxZ:16}});
 fight.start();resetActors(motion);animate(STEP,0,fight,motion);
 let wallTime=0,remainder=0,hitStop=0,phaseTwo=false;const events={},trace=[],attackSelections=[];
 for(let frame=0;frame<fps*MAX_TIME&&fight.status==='fighting';frame++){
  const dt=1/fps;wallTime+=dt;const stopped=Math.min(hitStop,dt);hitStop-=stopped;remainder+=dt-stopped;
  while(remainder+1e-10>=STEP&&hitStop<=0&&fight.status==='fighting'){
   const distance=motion.geometry().distance,attack=fight.boss.action,spec=fight.timings.boss[attack?.name];
   const marked=spec?.damage?windows(attack.name,spec):[];
   const speed=attack?fight.bossRate(attack):1;
   const next=marked.find(([start,end],index)=>end>attack.elapsed&&!attack.hits.includes(index));
   const untilHit=next?(next[0]-attack.elapsed)/speed:Infinity;
   const recovery=spec?.damage&&attack.elapsed>marked.at(-1)[1]+.025;
   const reactive=strategy==='watch-step-punish';
   const hugging=strategy==='hug-without-defense';
   const input={forward:(reactive||hugging)&&distance>motion.bodySeparation+(hugging?.015:.08)?1:0,right:0,cameraYaw:Math.atan2(motion.player.x-motion.boss.x,motion.player.z-motion.boss.z),lockOn:true};
   fight.player.blocking=false;
   if(reactive){
    const dodge=fight.timings.player.dodge;
    if(next&&untilHit<=dodge.invulnerable[0]+.09&&untilHit>-.04&&!fight.player.action){
     if(fight.request('dodge'))motion.beginDodge({...input,forward:0,right:1});
     else fight.player.blocking=true;
    }
    const safe=recovery||(!attack&&fight.cooldown>.4);
    if(safe&&!fight.player.action){
     if(fight.player.health<=52&&fight.player.flasks&&distance>2.6)fight.request('heal');
     // Round 3: the heavy is 1.53 s and 118 damage, shorter than any cooldown plus windup the boss has (the
     // phase-two flurry, the fastest, gives 1.72 s), so a safe opening with the stamina for it gets the heavy
     // and a leaner one the light.
     else if(distance<motion.bodySeparation+.22&&fight.player.stamina>=52)fight.request('heavy');
     else if(distance<motion.bodySeparation+.22&&fight.player.stamina>=38)fight.request('light');
    }
    if(fight.player.action?.name==='heal')input.forward=0;
   }
   motion.step(STEP,input,fight);animate(STEP,fight.time,fight,motion);
   const contactGeometry=geometry(motion);
   fight.step(STEP,contactGeometry);phaseTwo||=fight.boss.phase===2;
   for(const event of fight.drain()){
    if(event.type==='boss-tell'){
     const band=engagementRange(fight.timings.boss[event.name]);
     attackSelections.push({time:+fight.time.toFixed(3),name:event.name,distance:contactGeometry.distance,bossFacing:contactGeometry.bossFacing,bossSpeed:contactGeometry.bossSpeed,engagementRange:band,valid:!band||(contactGeometry.distance>=band[0]-1e-7&&contactGeometry.distance<=band[1]+1e-7&&contactGeometry.bossFacing&&contactGeometry.bossSpeed<=.08)});
    }
    events[event.type]=(events[event.type]||0)+1;
    if(trace.length<18||['phase-change','victory','defeat'].includes(event.type))trace.push({time:+fight.time.toFixed(3),...event});
    const pause=event.type==='boss-hit'?.045:event.type==='block'?.04:['player-hit','guard-break'].includes(event.type)?.065:0;
    hitStop=Math.max(hitStop,pause);
   }
   remainder-=STEP;if(hitStop>0)remainder=0;
  }
 }
 return {strategy,fps,status:fight.status,time:+fight.time.toFixed(3),wallTime:+wallTime.toFixed(3),player:fight.player.health,boss:fight.boss.health,phaseTwo,stats:fight.stats,events,trace,attackSelections,rangeSelectionsValid:attackSelections.every(entry=>entry.valid)};
}
const results=[];
const strategies=['passive','watch-step-punish','hug-without-defense'];
for(const strategy of strategies)for(const fps of [30,60,120])results.push(run(strategy,fps));
const cadence=Object.fromEntries(strategies.map(strategy=>{
 const rows=results.filter(result=>result.strategy===strategy),signature=row=>JSON.stringify({status:row.status,time:row.time,player:row.player,boss:row.boss,stats:row.stats});
 return [strategy,{identicalOutcome:rows.every(row=>signature(row)===signature(rows[0]))}];
}));
const assetHashes=Object.fromEntries(await Promise.all(Object.entries(paths).map(async([kind,path])=>[kind,createHash('sha256').update(await fs.readFile(path)).digest('hex')])));
const report={assetHashes,createdAt:new Date().toISOString(),assets:paths,motion:ASSETS.motion??{},fixedStep:STEP,contactChecks,cadence,results,passed:contactChecks.every(check=>check.nearContact&&check.farMiss)&&Object.values(cadence).every(check=>check.identicalOutcome)&&results.every(result=>result.rangeSelectionsValid)&&results.filter(result=>result.strategy!=='watch-step-punish').every(result=>result.status==='defeat')&&results.filter(result=>result.strategy==='watch-step-punish').every(result=>result.status==='victory')};
await fs.writeFile('docs/overnight-encounter-simulation.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({assets:report.assets,contactChecks,cadence,results:results.map(({trace,attackSelections,...result})=>result),passed:report.passed},null,2));
if(!report.passed)process.exitCode=1;
