// Timeline of one scripted strategy from scripts/simulate-encounter.mjs (same actors, motion and
// fight), printed as a per-event trace so a stall or a starved punish window can be read off.
//   node scripts/trace-encounter.mjs [passive|watch-step-punish|hug-without-defense] [seconds] [fps]
import {fileURLToPath} from 'node:url';
import * as T from 'three';
import {loadGLB} from './load-glb-node.mjs';
import {ASSETS} from '../src/game/asset-paths.js';
import {createActor,weaponSegmentFor} from '../src/game/actors.js';
import {Fight} from '../src/game/encounter.js';
import {MotionState} from '../src/game/motion.js';
import {candleGroundColliders} from '../src/game/arena-layout.js';
import {actorCapsule,actorDimensions} from '../src/game/actor-scale.js';
import {sweptWeaponContact} from '../src/game/weapon-motion.js';
import {bossEngagement} from '../src/game/engagement-range.js';

const [strategy='watch-step-punish',seconds='120',fpsArg='60']=process.argv.slice(2);
const STEP=1/120,fps=Number(fpsArg),MAX_TIME=Number(seconds);
const dimensions={player:actorDimensions(false,ASSETS.motion.player),boss:actorDimensions(true,ASSETS.motion.boss)};
const paths={player:fileURLToPath(ASSETS.playerRig),boss:fileURLToPath(ASSETS.bossRig)};
const actors=Object.fromEntries(await Promise.all(['player','boss'].map(async kind=>{
 const isBoss=kind==='boss',gltf=await loadGLB(paths[kind]);
 const actor=createActor(gltf,isBoss?2.5:1.85,isBoss,true,ASSETS.motion?.[kind]);
 const socket=gltf.scene.getObjectByName('WeaponSocket');
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
const windows=(name,spec)=>spec.hitWindows||[[spec.windup,spec.windup+spec.active]];
const fight=new Fight(ASSETS.motion),motion=new MotionState({groundColliders:candleGroundColliders(),animationMetadata:ASSETS.motion,approachDistance:ASSETS.motion?.boss?.approachDistance??2.35,bounds:{minX:-9.5,maxX:9.5,minZ:-15.5,maxZ:16}});
fight.start();for(const kind of ['player','boss'])actors[kind].reset(motion[kind]);
for(const kind of ['player','boss'])actors[kind].update(STEP,0,fight[kind],motion[kind]);
let remainder=0,hitStop=0,lastLine=-1;
const log=(...args)=>console.log(fight.time.toFixed(2).padStart(7),...args);
for(let frame=0;frame<fps*MAX_TIME&&fight.status==='fighting';frame++){
 const dt=1/fps;const stopped=Math.min(hitStop,dt);hitStop-=stopped;remainder+=dt-stopped;
 while(remainder+1e-10>=STEP&&hitStop<=0&&fight.status==='fighting'){
  const distance=motion.geometry().distance,attack=fight.boss.action,spec=fight.timings.boss[attack?.name];
  const marked=spec?.damage?windows(attack.name,spec):[];
  const speed=attack?fight.bossRate(attack):1;
  const next=marked.find(([start,end],index)=>end>attack.elapsed&&!attack.hits.includes(index));
  const untilHit=next?(next[0]-attack.elapsed)/speed:Infinity;
  const recovery=spec?.damage&&attack.elapsed>marked.at(-1)[1]+.025;
  const reactive=strategy==='watch-step-punish',hugging=strategy==='hug-without-defense';
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
    else if(distance<motion.bodySeparation+.22&&fight.player.stamina>=38)fight.request('light');
   }
   if(fight.player.action?.name==='heal')input.forward=0;
  }
  motion.step(STEP,input,fight);for(const kind of ['player','boss'])actors[kind].update(STEP,fight.time,fight[kind],motion[kind]);
  const geo=geometry(motion);fight.step(STEP,geo);
  for(const event of fight.drain()){
   log(event.type.padEnd(12),(event.name||event.action||'').padEnd(7),'d='+geo.distance.toFixed(2),'face='+geo.bossFacing,'v='+(geo.bossSpeed||0).toFixed(2),'hp='+fight.player.health,'boss='+fight.boss.health,'st='+fight.player.stamina.toFixed(0),'cd='+fight.cooldown.toFixed(2),'punish='+fight.punish,'hist='+fight.history.join(','));
   hitStop=Math.max(hitStop,event.type==='boss-hit'?.045:['player-hit','guard-break'].includes(event.type)?.065:0);
  }
  if(Math.floor(fight.time)!==lastLine&&Math.floor(fight.time)%5===0){lastLine=Math.floor(fight.time);const e=bossEngagement(ASSETS.motion.boss,fight.boss.phase,geo.distance,fight.attackIndex,{random:.5,history:fight.history});log('· state','d='+geo.distance.toFixed(2),'boss@',motion.boss.x.toFixed(2),motion.boss.z.toFixed(2),'player@',motion.player.x.toFixed(2),motion.player.z.toFixed(2),'act='+(attack?.name||'-')+(attack?'@'+attack.elapsed.toFixed(2):''),'pl='+(fight.player.action?.name||'-'),'cd='+fight.cooldown.toFixed(2),'elig='+e.eligible.map(x=>x.name).join('/'),'sel='+(e.selected?.name||'-'),'target='+e.targetDistance,'v='+(geo.bossSpeed||0).toFixed(2),'face='+geo.bossFacing);}
  remainder-=STEP;if(hitStop>0)remainder=0;
 }
}
log('END',fight.status,'hp='+fight.player.health,'boss='+fight.boss.health,JSON.stringify(fight.stats));
