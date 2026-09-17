// Which stance yaw still lets the visible blade reach a target straight ahead?
// Counts 120 Hz swept-contact samples inside each attack's damage window at the
// solid-body distance and at 4 m, for several facingYawDegrees values.
import {fileURLToPath} from 'node:url';
import * as T from 'three';
import {loadGLB} from './load-glb-node.mjs';
import {createActor,weaponSegmentFor} from '../src/game/actors.js';
import {ASSETS} from '../src/game/asset-paths.js';
import {actorDimensions,actorCapsule} from '../src/game/actor-scale.js';
import {strikeIndex,sweptWeaponContact} from '../src/game/weapon-motion.js';
// VESPER_RIG / VESPER_MANIFEST review a candidate bundle instead of the game's rig; VESPER_CLIPS limits the clips.
import {readFileSync} from 'node:fs';
const yaws=(process.argv[2]||'0,-10,-20,-25,-30,-35').split(',').map(Number),clips=(process.env.VESPER_CLIPS||'light,heavy').split(',');
const RIG=process.env.VESPER_RIG?process.env.VESPER_RIG:fileURLToPath(ASSETS.playerRig),BASE_META=process.env.VESPER_MANIFEST?JSON.parse(readFileSync(process.env.VESPER_MANIFEST,'utf8')):ASSETS.motion.player;
const target=actorDimensions(true,ASSETS.motion.boss);
for(const yaw of yaws){
 const metadata=structuredClone(BASE_META);for(const name of clips)metadata.clips[name].facingYawDegrees=yaw;
 const gltf=await loadGLB(RIG),actor=createActor(gltf,1.85,false,true,metadata);
 const socket=actor.body.getObjectByName('WeaponSocket');actor.weapon=new T.Group();actor.weapon.rotation.x=Math.PI/2;socket.add(actor.weapon);actor.weaponSegment=weaponSegmentFor(false,ASSETS);
 const near=actor.dimensions.bodyRadius+target.bodyRadius+.05,row={yaw};
 for(const name of clips){
  const origin={x:0,z:0,yaw:0};actor.reset(origin);const action={name,elapsed:0},state={health:100,blocking:false,action},duration=metadata.clips[name].duration;
  let nearHits=0,midHits=0,farHits=0,windowSamples=0;
  for(let frame=0;frame<=Math.ceil(duration*120);frame++){action.elapsed=Math.min(duration,frame/120);actor.update(1/120,action.elapsed,state,origin);
   if(strikeIndex(name,action.elapsed,false,actor.timings)<0)continue;windowSamples++;
   nearHits+=Number(sweptWeaponContact(actor.previousSegment,actor.segment,actorCapsule({x:0,z:near},target),target.hurtRadius));
   midHits+=Number(sweptWeaponContact(actor.previousSegment,actor.segment,actorCapsule({x:0,z:near+.3},target),target.hurtRadius));
   farHits+=Number(sweptWeaponContact(actor.previousSegment,actor.segment,actorCapsule({x:0,z:4},target),target.hurtRadius));}
  row[name]={near:`${nearHits}/${windowSamples}`,plus30cm:`${midHits}/${windowSamples}`,far:farHits};
 }
 console.log(JSON.stringify(row));
}
