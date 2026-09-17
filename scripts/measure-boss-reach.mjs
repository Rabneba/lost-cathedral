// Where does the boss blade reach a player capsule straight ahead, per clip time, per distance?
// Runs the live actor through createActor.update exactly like the game, forward and (for the
// sweep) reversed, so the flurry's second pass and the engagement bands can be sized from data.
import {fileURLToPath} from 'node:url';
import * as T from 'three';
import {loadGLB} from './load-glb-node.mjs';
import {ASSETS} from '../src/game/asset-paths.js';
import {createActor,weaponSegmentFor} from '../src/game/actors.js';
import {actorDimensions,actorCapsule} from '../src/game/actor-scale.js';
import {sweptWeaponContact} from '../src/game/weapon-motion.js';
const gltf=await loadGLB(fileURLToPath(ASSETS.bossRig));
const actor=createActor(gltf,2.5,true,true,ASSETS.motion.boss);
const socket=actor.body.getObjectByName('WeaponSocket');actor.weapon=new T.Group();actor.weapon.rotation.x=Math.PI/2;socket.add(actor.weapon);actor.weaponSegment=weaponSegmentFor(true,ASSETS);
const target=actorDimensions(false,ASSETS.motion.player);
const bodySep=actorDimensions(true,ASSETS.motion.boss).bodyRadius+target.bodyRadius+.05;
console.log('bodySeparation',bodySep.toFixed(3),'clips',gltf.animations.map(c=>c.name+':'+c.duration.toFixed(3)).join(' '));
const STEP=1/120;
function sweepContacts(name,timeAt,total,distances){
 const origin={x:0,z:0,yaw:0};actor.reset(origin);actor.update(.3,0,{health:100,action:null},origin);
 const rows={};for(const d of distances)rows[d]=[];
 const tipHeights=[];
 // One action object, mutated per frame, exactly as the fight does: a fresh object each frame
 // would restart the blend-in every step and leave the pose mostly idle.
 const action={name,elapsed:0,hits:[]};
 for(let t=0;t<=total+1e-9;t+=STEP){
  action.elapsed=timeAt(t);
  actor.update(STEP,t,{health:100,action},origin);
  const tip=actor.segment[1];tipHeights.push([+t.toFixed(3),+tip[0].toFixed(2),+tip[1].toFixed(2),+tip[2].toFixed(2)]);
  if(t===0)continue;
  for(const d of distances)if(sweptWeaponContact(actor.previousSegment,actor.segment,actorCapsule({x:0,z:d},target),target.hurtRadius))rows[d].push(+t.toFixed(3));
 }
 return {rows,tipHeights};
}
const distances=[1.4,1.6,1.8,2.0,2.15,2.3,2.45,2.6,2.75,2.9,3.1,3.2,3.35,3.5,3.7,4.0];
const span=list=>list.length?`${list[0]}..${list.at(-1)} (${list.length})`:'-';
for(const [label,name,timeAt,total] of [
 ['sweep forward','sweep',t=>t,4.4],
 ['slam forward','slam',t=>t,4.9],
 ['sweep reversed from 2.3','sweep',t=>Math.max(0,2.3-t),2.3],
 ['sweep reversed from 2.45','sweep',t=>Math.max(0,2.45-t),2.45],
 ['sweep reversed from 2.6','sweep',t=>Math.max(0,2.6-t),2.6],
]){
 const {rows,tipHeights}=sweepContacts(name,timeAt,total,distances);
 console.log('\n== '+label);
 for(const d of distances)console.log(' d='+d.toFixed(2)+'  '+span(rows[d]));
 if(label==='sweep forward'||label==='slam forward'){
  console.log(' tip (t,x,y,z) every .1s:');
  console.log(' '+tipHeights.filter((_,i)=>i%12===0).map(r=>r.join('/')).join('  '));
 }
}
