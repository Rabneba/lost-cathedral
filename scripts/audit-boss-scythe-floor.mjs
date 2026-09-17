import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import * as T from 'three';
import {loadGLB} from './load-glb-node.mjs';
import {createActor,weaponSegmentFor} from '../src/game/actors.js';
import {ASSETS} from '../src/game/asset-paths.js';
import {withActorScale} from '../src/game/actor-scale.js';
const asset=process.env.VESPER_BOSS_CANDIDATE||'assets/combat-revision/boss/v24-whole-prefix-diagnostic/boss-combat-candidate.glb',weaponPath=fileURLToPath(ASSETS.scythe);
const hash=async path=>createHash('sha256').update(await fs.readFile(path)).digest('hex'),sha256=await hash(asset),weaponSha256=await hash(weaponPath);
const [gltf,weaponGLB]=await Promise.all([loadGLB(asset),loadGLB(weaponPath)]),metadata=withActorScale(ASSETS.motion.boss,1.3),actor=createActor(gltf,2.5,true,true,metadata),socket=actor.body.getObjectByName('WeaponSocket');
// Exact loadActors normalization: height, yaw, bottom-center and handle median.
const wrapper=new T.Group(),root=weaponGLB.scene;wrapper.add(root);root.rotation.y=-Math.PI/2;wrapper.updateMatrixWorld(true);const box=new T.Box3().setFromObject(root),size=box.getSize(new T.Vector3());root.scale.multiplyScalar(ASSETS.scytheHeight/size.y);root.updateMatrixWorld(true);box.setFromObject(root);const center=box.getCenter(new T.Vector3());root.position.sub(new T.Vector3(center.x,box.min.y,center.z));wrapper.updateMatrixWorld(true);socket.add(wrapper);actor.weapon=wrapper;actor.root.updateMatrixWorld(true);
const inverse=wrapper.matrixWorld.clone().invert(),xs=[],zs=[],point=new T.Vector3();root.traverse(mesh=>{if(!mesh.isMesh)return;const p=mesh.geometry.attributes.position;for(let index=0;index<p.count;index++){point.fromBufferAttribute(p,index).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse);if(point.y>.55&&point.y<1.25){xs.push(point.x);zs.push(point.z);}}});xs.sort((a,b)=>a-b);zs.sort((a,b)=>a-b);const handleShift={x:xs[Math.floor(xs.length/2)],z:zs[Math.floor(zs.length/2)]};root.position.x-=handleShift.x;root.position.z-=handleShift.z;wrapper.rotation.x=Math.PI/2;actor.root.updateMatrixWorld(true);
const normalizedInverse=wrapper.matrixWorld.clone().invert(),socketInverse=socket.matrixWorld.clone().invert(),vertices=[],socketVertices=[];let meshIndex=0;
root.traverse(mesh=>{if(!mesh.isMesh)return;const p=mesh.geometry.attributes.position,m=normalizedInverse.clone().multiply(mesh.matrixWorld),s=socketInverse.clone().multiply(mesh.matrixWorld);for(let index=0;index<p.count;index++){const local=new T.Vector3().fromBufferAttribute(p,index).applyMatrix4(m),socketLocal=new T.Vector3().fromBufferAttribute(p,index).applyMatrix4(s);vertices.push({meshIndex,index,local:local.toArray(),socketLocal:socketLocal.toArray()});socketVertices.push(...socketLocal.toArray());}meshIndex++;});
const band=p=>p[1]<.35?'butt_y_below_0.35':p[1]<2.1?'shaft_y_0.35_to_2.1':'curved_head_y_above_2.1';
const cloud={createdAt:new Date().toISOString(),weapon:weaponPath,weaponSha256,normalization:{authoredHeight:ASSETS.scytheHeight,yaw:-Math.PI/2,handleMedianY:[.55,1.25],handleShift,wrapperRotationX:Math.PI/2},space:'Three.js WeaponSocket-local metres, BEFORE actor scale. Multiply each point by WeaponSocket.matrixWorld (which already includes runtime scale1.3). No wrapper rotation or extra1.3 should be applied.',vertices:vertices.length,xyz:socketVertices};
if(process.env.VESPER_SCYTHE_SKIP_CLOUD!=='1')await fs.writeFile('docs/combat-revision/scythe-socket-vertex-cloud.json',JSON.stringify(cloud)+'\n');
const clipName=process.env.VESPER_FLOOR_CLIP||'slam',clip=gltf.animations.find(c=>c.name===clipName);
if(!clip)throw new Error(`Missing requested clip ${clipName}`);
const end=Math.min(Number(process.env.VESPER_FLOOR_END)||4.333333333333333,clip.duration),fps=240,origin={x:0,z:0,yaw:0};
function evaluate(){const e=wrapper.matrixWorld.elements;let minimum=Infinity,index=-1,below=0;const bands={};for(let i=0;i<vertices.length;i++){const p=vertices[i].local,y=p[0]*e[1]+p[1]*e[5]+p[2]*e[9]+e[13],name=band(p);if(y<minimum){minimum=y;index=i;}if(y<0)below++;if(!bands[name]||y<bands[name].minimum)bands[name]={minimum:y,index:i};}return{minimum,index,below,bands};}
function detail(index){const v=vertices[index];return{...v,world:new T.Vector3(...v.local).applyMatrix4(wrapper.matrixWorld).toArray(),band:band(v.local)};}
const activeWindow=(process.env.VESPER_FLOOR_ACTIVE_WINDOW||'2,2.8').split(',').map(Number);
const modes=[];
for(const rawPose of [true,false]){
 actor.reset(origin);const action={name:clipName,elapsed:0,directClipTime:true,rawPose},samples=[],bands={};let worst={minimum:Infinity},activeWorst={minimum:Infinity};
 for(let frame=0;frame<=Math.ceil(end*fps);frame++){
  const time=Math.min(end,frame/fps);action.elapsed=time;actor.update(0,time,{health:100,action},origin);const value=evaluate();
  if(value.minimum<worst.minimum)worst={time,clipFrameAt30Hz:time*30,...value,vertex:detail(value.index),visualRootLift:actor.visualRoot.position.y*actor.worldScale};
  if(time>=activeWindow[0]&&time<=activeWindow[1]&&value.minimum<activeWorst.minimum)activeWorst={time,clipFrameAt30Hz:time*30,...value,vertex:detail(value.index)};
  for(const [name,b]of Object.entries(value.bands))if(!bands[name]||b.minimum<bands[name].minimum)bands[name]={time,clipFrameAt30Hz:time*30,...b,vertex:detail(b.index)};
  if(frame%4===0||time===end)samples.push({time,clipFrameAt30Hz:time*30,minimum:value.minimum,belowFloorVertices:value.below});
 }
 action.elapsed=worst.time;actor.update(0,worst.time,{health:100,action},origin);const ordered=vertices.map((_,index)=>detail(index)).sort((a,b)=>a.world[1]-b.world[1]),penetrating=ordered.filter(v=>v.world[1]<0),normalizedBox=new T.Box3().setFromPoints(penetrating.map(v=>new T.Vector3(...v.local))),worldBox=new T.Box3().setFromPoints(penetrating.map(v=>new T.Vector3(...v.world)));
 const belowIntervals=[];let current=null;for(const sample of samples){if(sample.minimum<0){if(!current){current={start:sample.time,end:sample.time,maximumDepth:0};belowIntervals.push(current);}current.end=sample.time;current.maximumDepth=Math.max(current.maximumDepth,-sample.minimum);}else current=null;}
 modes.push({mode:rawPose?'source_socket_no_floor_correction':'actual_runtime_sole_clearance',worst,activeWorst,bands,belowIntervals,penetratingAtWorst:{count:penetrating.length,normalizedBounds:penetrating.length?{min:normalizedBox.min.toArray(),max:normalizedBox.max.toArray()}:null,worldBounds:penetrating.length?{min:worldBox.min.toArray(),max:worldBox.max.toArray()}:null,lowestVertices:ordered.slice(0,24)},samples});
}
const report={createdAt:new Date().toISOString(),asset,sha256,snapshotStillCurrent:sha256===await hash(asset),weapon:weaponPath,weaponSha256,worldScale:1.3,authoredScytheHeight:ASSETS.scytheHeight,fullWorldScytheHeight:ASSETS.scytheHeight*1.3,clip:clipName,range:[0,end],activeWindow,sampleHz:fps,savedTrajectoryHz:60,vertices:vertices.length,meshCount:meshIndex,vertexCloud:'docs/combat-revision/scythe-socket-vertex-cloud.json',geometricBandNote:'Labels use exact normalized prop Y bands; they distinguish the long shaft from upper curved head but are not semantic segmentation. Exact local/socket coordinates are included for solver use.',modes};
await fs.writeFile(process.env.VESPER_SCYTHE_FLOOR_REPORT||'docs/combat-revision/boss-v24-scythe-floor.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({sha256,snapshotStillCurrent:report.snapshotStillCurrent,vertices:vertices.length,modes:modes.map(({samples,penetratingAtWorst,...mode})=>({...mode,penetratingBounds:{...penetratingAtWorst,lowestVertices:penetratingAtWorst.lowestVertices.slice(0,3)}}))},null,2));
