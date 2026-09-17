// Where does the visible blade actually touch a target straight ahead? Plays a candidate's
// attack through the runtime actor at 120 Hz and reports the contact span at the solid-body
// distance, +30 cm and +60 cm, so the manifest hit window can follow the blade instead of the
// hand-speed guess. VESPER_RIG, VESPER_MANIFEST, VESPER_CLIPS (default light,heavy), VESPER_YAW.
import {readFileSync} from 'node:fs';
import * as T from 'three';
import {loadGLB} from './load-glb-node.mjs';
import {createActor,weaponSegmentFor} from '../src/game/actors.js';
import {ASSETS} from '../src/game/asset-paths.js';
import {actorDimensions,actorCapsule} from '../src/game/actor-scale.js';
import {sweptWeaponContact} from '../src/game/weapon-motion.js';
const RIG=process.env.VESPER_RIG,MANIFEST=process.env.VESPER_MANIFEST;if(!RIG||!MANIFEST)throw new Error('VESPER_RIG and VESPER_MANIFEST required');
const clips=(process.env.VESPER_CLIPS||'light,heavy').split(','),target=actorDimensions(true,ASSETS.motion.boss);
const metadata=JSON.parse(readFileSync(MANIFEST,'utf8'));if(process.env.VESPER_YAW)for(const c of clips)metadata.clips[c].facingYawDegrees=Number(process.env.VESPER_YAW);
const gltf=await loadGLB(RIG),actor=createActor(gltf,1.85,false,true,metadata);
const socket=actor.body.getObjectByName('WeaponSocket');actor.weapon=new T.Group();actor.weapon.rotation.x=Math.PI/2;socket.add(actor.weapon);actor.weaponSegment=weaponSegmentFor(false,ASSETS);
const near=actor.dimensions.bodyRadius+target.bodyRadius+.05;
for(const name of clips){const clip=metadata.clips[name];if(!clip)continue;const origin={x:0,z:0,yaw:0};actor.reset(origin);const action={name,elapsed:0},state={health:100,blocking:false,action};
 const spans={};for(const d of [near,near+.3,near+.6])spans[d.toFixed(2)]=[];
 for(let frame=0;frame<=Math.ceil(clip.duration*120);frame++){action.elapsed=Math.min(clip.duration,frame/120);actor.update(1/120,action.elapsed,state,origin);if(frame===0)continue;
  for(const d of Object.keys(spans))if(sweptWeaponContact(actor.previousSegment,actor.segment,actorCapsule({x:0,z:+d},target),target.hurtRadius))spans[d].push(action.elapsed);}
 const out={clip:name,duration:+clip.duration.toFixed(3),manifestWindow:[clip.windup,+(clip.windup+clip.active).toFixed(3)]};
 for(const [d,times] of Object.entries(spans))out['contact@'+d]=times.length?{first:+times[0].toFixed(3),last:+times[times.length-1].toFixed(3),samples:times.length}:null;
 console.log(JSON.stringify(out));}
