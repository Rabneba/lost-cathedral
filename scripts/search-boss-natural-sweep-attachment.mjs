import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as T from 'three';
import {loadGLB} from './load-glb-node.mjs';
import {createActor} from '../src/game/actors.js';
import {ASSETS} from '../src/game/asset-paths.js';

const centered=process.env.VESPER_SWEEP_CENTERED==='1';
const asset=process.env.VESPER_BOSS_CANDIDATE||'assets/combat-revision/boss/sweep-capture-natural-1/boss-combat-candidate.glb';
const bytes=await fs.readFile(asset),actor=createActor(await loadGLB(asset),2.5,true,true,ASSETS.motion.boss);
const cloud=JSON.parse(await fs.readFile('docs/combat-revision/scythe-socket-vertex-cloud.json'));
const all=Array.from({length:cloud.xyz.length/3},(_,i)=>new T.Vector3(...cloud.xyz.slice(i*3,i*3+3)));
const fullWing=all.filter(p=>p.x>=.2&&p.z>=2.1),wing=fullWing.filter((_,i)=>i%5===0),ranges=[1.4,1.55];
const frames=[];
for(let f=Math.ceil(1.65*30);f<=2.8*30;f++){
 const time=f/30;actor.update(0,time,{health:100,action:{name:'sweep',elapsed:time,directClipTime:true}},{x:0,z:0,yaw:0});
 frames.push({time,matrix:actor.body.getObjectByName('WeaponSocket').matrixWorld.clone()});
}
const sections=centered?JSON.parse(await fs.readFile('assets/combat-revision/boss/trajectory-context/context.json')).shaftSections:[];
function centerAt(h){if(!centered)return new T.Vector3(0,0,h);const index=sections.findIndex(([point])=>point[2]>=h);const a=new T.Vector3(...sections[index-1][0]),b=new T.Vector3(...sections[index][0]);return a.lerp(b,(h-a.z)/(b.z-a.z));}
function adjustment(reverse,station,roll){const old=centerAt(centered?1.9:.6),next=centerAt(station);return new T.Matrix4().makeTranslation(...old.toArray()).multiply(new T.Matrix4().makeRotationY(reverse?Math.PI:0)).multiply(new T.Matrix4().makeRotationZ(T.MathUtils.degToRad(roll))).multiply(new T.Matrix4().makeTranslation(-next.x,-next.y,-next.z));}
const rows=[];
for(const reverse of centered?[false]:[true,false])for(let stationIndex=centered?19:17;stationIndex<=(centered?19:21);stationIndex++)for(let roll=centered?-90:-180;roll<(centered?91:180);roll+=centered?5:15){
 const station=stationIndex/10;
 const local=adjustment(reverse,station,roll);
 const posed=frames.map(({time,matrix})=>{const m=matrix.clone().multiply(local);return{time,matrix:m,points:wing.map(p=>p.clone().applyMatrix4(m))};});
 for(let yaw=-35;yaw<=35;yaw+=5){
  const c=Math.cos(T.MathUtils.degToRad(yaw)),s=Math.sin(T.MathUtils.degToRad(yaw));
  const nearest=ranges.map(range=>({range,distance:Infinity}));
  for(const frame of posed)for(const p of frame.points){
   const x=p.x*c+p.z*s,z=-p.x*s+p.z*c,dy=p.y-T.MathUtils.clamp(p.y,.45,1.5);
   for(const row of nearest){const d=Math.hypot(x,dy,z-row.range);if(d<row.distance)Object.assign(row,{distance:d,time:frame.time,point:[x,p.y,z]});}
  }
  rows.push({reverse,gripStation:station,rollDegrees:roll,yawDegrees:yaw,nearest,score:Math.max(...nearest.map(r=>r.distance))});
 }
}
rows.sort((a,b)=>a.score-b.score);
for(const row of rows.slice(0,30)){
 const local=adjustment(row.reverse,row.gripStation,row.rollDegrees);
 row.activeFullPropFloor=Infinity;
 for(const frame of frames){const e=frame.matrix.clone().multiply(local).elements;for(const p of all)row.activeFullPropFloor=Math.min(row.activeFullPropFloor,p.x*e[1]+p.y*e[5]+p.z*e[9]+e[13]);}
}
const report={createdAt:new Date().toISOString(),asset,sha256:createHash('sha256').update(bytes).digest('hex'),method:'Coarse diagnostic ranking only: every fifth actual curved-wing vertex against fixed player capsule axis. No hitbox expansion and NO actual-armor acceptance. Top30 floor minima use all9832 actual prop vertices. Arms remain unchanged. Source1.65–2.8s sampled30Hz.',oldAnchor:centerAt(centered?1.9:.6).toArray(),localTransform:'Mold*T(oldAnchor)*Ry(reverse?PI:0)*Rz(roll)*T(-measuredNewGripCenter), then actor wholebody yaw. In centered mode roll is additional to the baked−135 degrees.',fullWingVertices:fullWing.length,sampledWingVertices:wing.length,rows};
await fs.writeFile(process.env.VESPER_SWEEP_SEARCH_REPORT||'docs/combat-revision/boss-natural-sweep-attachment-search.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(rows.slice(0,12),null,2));
