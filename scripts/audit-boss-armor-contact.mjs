import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import * as T from 'three';
import {loadGLB} from './load-glb-node.mjs';
import {createActor} from '../src/game/actors.js';
import {ASSETS} from '../src/game/asset-paths.js';

const path=process.env.VESPER_BOSS_CANDIDATE||'assets/combat-revision/boss/v52-paced-aimed-slam/boss-paced-candidate.glb';
const clipName=process.env.VESPER_CONTACT_CLIP||'slam';
const window=(process.env.VESPER_CONTACT_WINDOW||'1.7783916884727784,2.0161342192705494').split(',').map(Number);
const ranges=(process.env.VESPER_CONTACT_RANGES||'2.47,2.6,2.75,3,3.1,3.2,3.35,3.5,3.75').split(',').map(Number),fps=120;
const measureNearest=process.env.VESPER_CONTACT_NEAREST==='1';
// The measured haft has x<=0.0341m below its neck. The forward curved wing
// begins well outside it: x>=0.12 also yields socket y>=0.184,z>=2.379m.
const bladeMinX=Number(process.env.VESPER_BLADE_MIN_X??.12);
const weaponRoll=Number(process.env.VESPER_WEAPON_ROLL_DEGREES||0),reverseWeapon=process.env.VESPER_WEAPON_REVERSE==='1';
const weaponGripStation=Number(process.env.VESPER_WEAPON_GRIP_STATION||.6);
const rollPivot=process.env.VESPER_WEAPON_ROLL_PIVOT?.split(',').map(Number);
if(rollPivot&&(rollPivot.length!==3||rollPivot.some(x=>!Number.isFinite(x))||reverseWeapon||weaponGripStation!==.6))throw new Error('Explicit shaft-center roll pivot requires exactly three finite coordinates and no additional reversal/grip change');
const oldAnchor=rollPivot||[0,0,.6],newAnchor=rollPivot||[0,0,weaponGripStation];
const weaponAdjustment=new T.Matrix4().makeTranslation(...oldAnchor).multiply(new T.Matrix4().makeRotationY(reverseWeapon?Math.PI:0)).multiply(new T.Matrix4().makeRotationZ(T.MathUtils.degToRad(weaponRoll))).multiply(new T.Matrix4().makeTranslation(...newAnchor.map(value=>-value)));
const hash=async path=>createHash('sha256').update(await fs.readFile(path)).digest('hex');
const playerPath=fileURLToPath(ASSETS.playerRig),weaponPath=fileURLToPath(ASSETS.scythe),sha256=await hash(path);
const [bossGLB,playerGLB,weaponGLB,shieldGLB]=await Promise.all([loadGLB(path),loadGLB(playerPath),loadGLB(weaponPath),loadGLB(fileURLToPath(ASSETS.playerShield))]);
const boss=createActor(bossGLB,2.5,true,true,ASSETS.motion.boss),player=createActor(playerGLB,1.85,false,true,ASSETS.motion.player);
const cloud=JSON.parse(await fs.readFile('docs/combat-revision/scythe-socket-vertex-cloud.json'));
if(cloud.weaponSha256!==await hash(weaponPath))throw new Error('Scythe vertex cloud is stale');
let weaponMesh;weaponGLB.scene.traverse(mesh=>{if(mesh.isMesh&&mesh.geometry.attributes.position.count===cloud.xyz.length/3)weaponMesh=mesh;});
if(!weaponMesh)throw new Error('Scythe topology does not match normalized vertex cloud');
const points=Array.from({length:cloud.xyz.length/3},(_,i)=>new T.Vector3(...cloud.xyz.slice(i*3,i*3+3))),edges=[],seen=new Set(),idx=weaponMesh.geometry.index;
for(let i=0;i<idx.count;i+=3)for(let [a,b] of [[idx.getX(i),idx.getX(i+1)],[idx.getX(i+1),idx.getX(i+2)],[idx.getX(i+2),idx.getX(i)]]){
 const key=a<b?`${a},${b}`:`${b},${a}`;if(seen.has(key))continue;seen.add(key);
 let x=points[a].clone(),y=points[b].clone();if(x.z<2.1&&y.z<2.1)continue;
 if(x.z<2.1)x.lerp(y,(2.1-x.z)/(y.z-x.z));if(y.z<2.1)y.lerp(x,(2.1-y.z)/(x.z-y.z));
 if(x.x<bladeMinX&&y.x<bladeMinX)continue;
 if(x.x<bladeMinX)x.lerp(y,(bladeMinX-x.x)/(y.x-x.x));if(y.x<bladeMinX)y.lerp(x,(bladeMinX-y.x)/(x.x-y.x));
 if(x.distanceToSquared(y)>1e-12)edges.push([x,y]);
}
function prepare(root,height){const wrapper=new T.Group();wrapper.add(root);root.rotation.y=-Math.PI/2;wrapper.updateMatrixWorld(true);const box=new T.Box3().setFromObject(root);root.scale.multiplyScalar(height/box.getSize(new T.Vector3()).y);root.updateMatrixWorld(true);box.setFromObject(root);const center=box.getCenter(new T.Vector3());root.position.sub(new T.Vector3(center.x,box.min.y,center.z));return wrapper;}
player.shield=prepare(shieldGLB.scene,.73);player.body.getObjectByName('ShieldSocket').add(player.shield);player.shield.rotation.set(Math.PI/2,Math.PI/2,0);
const cell=.18,gridKey=(x,y,z)=>`${x},${y},${z}`,point=new T.Vector3(),a=new T.Vector3(),b=new T.Vector3(),direction=new T.Vector3(),hit=new T.Vector3(),edgeBox=new T.Box3(),ray=new T.Ray();
function region(source,ids){const totals=new Map();for(const id of ids)for(let j=0;j<4;j++){const name=source.skeleton.bones[source.geometry.attributes.skinIndex.getComponent(id,j)].name;totals.set(name,(totals.get(name)||0)+source.geometry.attributes.skinWeight.getComponent(id,j));}return [...totals].sort((a,b)=>b[1]-a[1])[0][0];}
function targetGeometry(){
 const grid=new Map(),bounds=new T.Box3();let count=0;
 function addMesh(mesh){
  if(!mesh.isMesh)return;const g=mesh.geometry,index=g.index,p=g.attributes.position;
  const vertices=Array.from({length:p.count},(_,i)=>(mesh.isSkinnedMesh?mesh.getVertexPosition(i,new T.Vector3()):new T.Vector3().fromBufferAttribute(p,i)).applyMatrix4(mesh.matrixWorld));
  for(let i=0;i<(index?.count??p.count);i+=3){const ids=[0,1,2].map(j=>index?index.getX(i+j):i+j),tri=new T.Triangle(...ids.map(id=>vertices[id]));const box=new T.Box3().setFromPoints([tri.a,tri.b,tri.c]),entry={tri,region:mesh.isSkinnedMesh?region(mesh,ids):'shield'};bounds.union(box);count++;
   for(let x=Math.floor(box.min.x/cell);x<=Math.floor(box.max.x/cell);x++)for(let y=Math.floor(box.min.y/cell);y<=Math.floor(box.max.y/cell);y++)for(let z=Math.floor(box.min.z/cell);z<=Math.floor(box.max.z/cell);z++){const key=gridKey(x,y,z);if(!grid.has(key))grid.set(key,[]);grid.get(key).push(entry);}
  }
 }
 player.body.traverse(mesh=>{if(mesh.isSkinnedMesh)addMesh(mesh);});player.shield.traverse(addMesh);
 return {grid,bounds,triangles:count};
}
function intersect(target,start,end){
 edgeBox.setFromPoints([start,end]);if(!edgeBox.intersectsBox(target.bounds))return [];
 direction.subVectors(end,start);const length=direction.length();if(length<1e-10)return [];ray.set(start,direction.divideScalar(length));const tested=new Set(),hits=[];
 for(let x=Math.floor(edgeBox.min.x/cell);x<=Math.floor(edgeBox.max.x/cell);x++)for(let y=Math.floor(edgeBox.min.y/cell);y<=Math.floor(edgeBox.max.y/cell);y++)for(let z=Math.floor(edgeBox.min.z/cell);z<=Math.floor(edgeBox.max.z/cell);z++)for(const entry of target.grid.get(gridKey(x,y,z))||[]){
  if(tested.has(entry))continue;tested.add(entry);
  if(ray.intersectTriangle(entry.tri.a,entry.tri.b,entry.tri.c,false,hit)&&hit.distanceToSquared(start)<=length*length+1e-12)hits.push({region:entry.region,point:hit.toArray()});
 }
 return hits;
}
const aimYawDegrees=Number(process.env.VESPER_ACTOR_YAW_DEGREES||0);
const rows=[],origin={x:0,z:0,yaw:T.MathUtils.degToRad(aimYawDegrees)};
for(const stance of (process.env.VESPER_CONTACT_STANCES||'idle,block').split(',')){
 player.reset({x:0,z:0,yaw:Math.PI});player.update(0,1,{health:100,action:{name:stance,elapsed:1,directClipTime:true}},{x:0,z:0,yaw:Math.PI});player.root.updateMatrixWorld(true);
 const target=targetGeometry(),chest=player.body.getObjectByName('mixamorigSpine2').getWorldPosition(new T.Vector3());
 const control=intersect(target,chest.clone().add(new T.Vector3(-1,0,0)),chest.clone().add(new T.Vector3(1,0,0)));
 if(!control.length)throw new Error('Actual-armor positive control failed');
 for(const range of ranges){const samples=[];let nearest=null;
  for(let frame=Math.ceil(window[0]*fps);frame<window[1]*fps;frame++){
   const time=frame/fps;boss.update(0,time,{health:100,action:{name:clipName,elapsed:time,directClipTime:true}},origin);const matrix=boss.body.getObjectByName('WeaponSocket').matrixWorld.clone().multiply(weaponAdjustment);const contacts=[];
   for(const edge of edges){a.copy(edge[0]).applyMatrix4(matrix);b.copy(edge[1]).applyMatrix4(matrix);a.z-=range;b.z-=range;
    for(const result of intersect(target,a,b)){result.point[2]+=range;contacts.push(result);}
   }
   if(contacts.length)samples.push({time,intersectionCount:contacts.length,regions:[...new Set(contacts.map(c=>c.region))],first:contacts[0],bounds:new T.Box3().setFromPoints(contacts.map(c=>point.clone().fromArray(c.point)))});
   if(measureNearest&&!contacts.length)for(const local of points){
    if(local.z<2.1||local.x<bladeMinX)continue;a.copy(local).applyMatrix4(matrix);a.z-=range;
    const [x,y,z]=a.toArray().map(value=>Math.floor(value/cell)),tested=new Set();
    for(let xx=x-1;xx<=x+1;xx++)for(let yy=y-1;yy<=y+1;yy++)for(let zz=z-1;zz<=z+1;zz++)for(const entry of target.grid.get(gridKey(xx,yy,zz))||[]){
     if(tested.has(entry))continue;tested.add(entry);entry.tri.closestPointToPoint(a,point);const distance=a.distanceTo(point);
     if(!nearest||distance<nearest.distance){const blade=a.toArray(),armor=point.toArray();blade[2]+=range;armor[2]+=range;nearest={time,distance,blade,armor,region:entry.region,bladeLocal:local.toArray()};}
    }
   }
  }
  const row={stance,range,triangleCount:target.triangles,contactFrames:samples.length,firstContact:samples[0]?.time??null,lastContact:samples.at(-1)?.time??null,regions:[...new Set(samples.flatMap(s=>s.regions))],nearestVertexToTriangle:nearest,samples};rows.push(row);console.log(JSON.stringify({...row,samples:undefined}));
 }
}
const report={createdAt:new Date().toISOString(),asset:path,sha256,snapshotStillCurrent:sha256===await hash(path),playerAsset:playerPath,playerSha256:await hash(playerPath),weapon:weaponPath,weaponSha256:cloud.weaponSha256,worldScale:1.3,weaponAdjustment:{aimYawDegrees,rollDegrees:weaponRoll,reverse:reverseWeapon,oldAnchor,newAnchor,newGripStation:rollPivot?null:weaponGripStation,diagnosticOnly:!!(weaponRoll||reverseWeapon||aimYawDegrees||weaponGripStation!==.6)},clip:clipName,window,sampleHz:fps,bladeEdges:edges.length,bladeMinX,playerPoseTime:1,method:'Actual normalized scythe forward curved-wing triangle edges (socket-local z>=2.1 and x>=bladeMinX) intersect actual posed currently selected player skinned armor and independent normalized shield triangles. Narrow stem/haft is excluded. Three.Ray.intersectTriangle is double sided. A uniform triangle grid only culls candidates; no spheres or capsule decide contact. Positive-control rays cross the actual posed chest in both stances.',limitations:'Discrete static-player pose samples, not swept mesh-volume collisions. Triangle edges do not prove complete separation when one solid entirely contains another; reported intersections prove visible surface crossing. Only one idle/block phase and directly forward target roots are checked. Optional nearest distance samples actual blade vertices against target triangles and is not a certified full surface-distance minimum.',rows};
await fs.writeFile(process.env.VESPER_ARMOR_REPORT||'docs/combat-revision/boss-v52-paced-armor-contact.json',JSON.stringify(report,null,2)+'\n');
