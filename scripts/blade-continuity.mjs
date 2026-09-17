// Blade continuity of an attack clip through the runtime: peak turn rate of the visible blade
// (a flip shows as thousands of deg/s), lowest tip height, and a coarse path table.
// VESPER_RIG, VESPER_MANIFEST, VESPER_CLIPS.
import {readFileSync} from 'node:fs';
import * as T from 'three';
import {loadGLB} from './load-glb-node.mjs';
import {createActor,weaponSegmentFor} from '../src/game/actors.js';
import {ASSETS} from '../src/game/asset-paths.js';
const RIG=process.env.VESPER_RIG,MANIFEST=process.env.VESPER_MANIFEST,clips=(process.env.VESPER_CLIPS||'light,heavy').split(',');const metadata=JSON.parse(readFileSync(MANIFEST,'utf8'));
const gltf=await loadGLB(RIG),actor=createActor(gltf,1.85,false,true,metadata);
const socket=actor.body.getObjectByName('WeaponSocket');actor.weapon=new T.Group();actor.weapon.rotation.x=Math.PI/2;socket.add(actor.weapon);actor.weaponSegment=weaponSegmentFor(false,ASSETS);
for(const CLIP of clips){const origin={x:0,z:0,yaw:0};actor.reset(origin);const action={name:CLIP,elapsed:0},state={health:100,blocking:false,action};
 let prev=null;const turns=[];let minTip=9,minTipAt=0;const rows=[];
 for(let t=0;t<=metadata.clips[CLIP].duration;t+=1/120){action.elapsed=t;actor.update(1/120,t,state,origin);const [a,b]=actor.segment;const d=new T.Vector3(...b).sub(new T.Vector3(...a)).normalize();
  if(prev)turns.push([T.MathUtils.radToDeg(Math.acos(T.MathUtils.clamp(d.dot(prev),-1,1)))*120,t]);prev=d;if(b[1]<minTip){minTip=b[1];minTipAt=t;}
  if(Math.round(t*120)%12===0)rows.push(`${t.toFixed(2)} tip ${b.map(v=>v.toFixed(2)).join(',')} pitch ${T.MathUtils.radToDeg(Math.asin(d.y)).toFixed(0)} yaw ${T.MathUtils.radToDeg(Math.atan2(d.x,d.z)).toFixed(0)}`);}
 turns.sort((x,y)=>y[0]-x[0]);
 console.log(`\n${CLIP}: peak blade turn ${turns.slice(0,3).map(([r,t])=>`${r.toFixed(0)} deg/s @${t.toFixed(2)}`).join(', ')}; lowest tip ${minTip.toFixed(2)} m @${minTipAt.toFixed(2)} s`);console.log(rows.join('\n'));}
