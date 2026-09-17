import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as T from 'three';
import {loadGLB} from './load-glb-node.mjs';
import {createActor} from '../src/game/actors.js';
import {ASSETS} from '../src/game/asset-paths.js';
const asset='assets/combat-revision/boss/v70-paced-captured-arms/boss-paced-candidate.glb',g=await loadGLB(asset),actor=createActor(g,2.5,true,true,ASSETS.motion.boss),cloud=JSON.parse(await fs.readFile('docs/combat-revision/scythe-socket-vertex-cloud.json'));
const all=Array.from({length:cloud.xyz.length/3},(_,i)=>new T.Vector3(...cloud.xyz.slice(i*3,i*3+3))),wing=all.filter(p=>p.x>=.2&&p.z>=2.1),ranges=[1.4,1.85,2.3,2.6,3.1,3.35];
const matrices=[];for(let f=Math.ceil(1.7783916884727784*120);f<2.0161342192705494*120;f++){const t=f/120;actor.update(0,t,{health:100,action:{name:'slam',elapsed:t,directClipTime:true}},{x:0,z:0,yaw:0});matrices.push({time:t,matrix:actor.body.getObjectByName('WeaponSocket').matrixWorld.clone()});}
const rows=[],point=new T.Vector3();
for(const reverse of [false,true])for(let degrees=-180;degrees<180;degrees+=15){
 const pivot=new T.Matrix4().makeTranslation(0,0,.6),rotation=new T.Matrix4().makeRotationY(reverse?Math.PI:0).multiply(new T.Matrix4().makeRotationZ(T.MathUtils.degToRad(degrees))),local=pivot.multiply(rotation).multiply(new T.Matrix4().makeTranslation(0,0,-.6));
 const worldMatrices=matrices.map(row=>({...row,matrix:row.matrix.clone().multiply(local)})),nearest=Object.fromEntries(ranges.map(r=>[r,{distance:Infinity}]));let floor=Infinity;
 for(const {time,matrix} of worldMatrices){
  const e=matrix.elements;for(const p of all)floor=Math.min(floor,p.x*e[1]+p.y*e[5]+p.z*e[9]+e[13]);
  for(const p of wing){point.copy(p).applyMatrix4(matrix);for(const range of ranges){const y=T.MathUtils.clamp(point.y,.45,1.5),distance=Math.hypot(point.x,point.y-y,point.z-range);if(distance<nearest[range].distance)nearest[range]={distance,time,point:point.toArray()};}}
 }
 rows.push({reverse,rollDegrees:degrees,activeFullPropMinimum:floor,nearestWingToPlayerAxis:nearest});
}
rows.sort((a,b)=>Math.min(...Object.values(a.nearestWingToPlayerAxis).map(x=>x.distance))-Math.min(...Object.values(b.nearestWingToPlayerAxis).map(x=>x.distance)));
const report={createdAt:new Date().toISOString(),asset,sha256:createHash('sha256').update(await fs.readFile(asset)).digest('hex'),scope:'Weapon-only attachment search, arms and palms unchanged. Geometric ranking uses actual curved-wing vertices against a player capsule AXIS, not actual armor; this does NOT accept contact. Full actual armor intersections must follow. All prop vertices determine floor.',localTransform:'T(0,0,.6) * Ry(reverse?PI:0) * Rz(roll) * T(0,0,-.6). Pivot is authored main-palm shaft station .6m. Secondary-palm fit and anatomy not certified.',rows};await fs.writeFile('docs/combat-revision/boss-v70-weapon-orientation-search.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(rows.slice(0,10),null,2));
