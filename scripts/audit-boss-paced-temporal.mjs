import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as T from 'three';
import {loadGLB} from './load-glb-node.mjs';
import {createActor} from '../src/game/actors.js';
import {ASSETS} from '../src/game/asset-paths.js';
const folder=process.env.VESPER_PACED_FOLDER||'assets/combat-revision/boss/v62-paced-aimed-slam',path=folder+'/boss-paced-candidate.glb';
const timing=JSON.parse(await fs.readFile(folder+'/timing-map.json')).clips.slam,g=await loadGLB(path),actor=createActor(g,2.5,true,true,{...ASSETS.motion.boss,clips:{...ASSETS.motion.boss.clips,slam:timing}}),origin={x:0,z:0,yaw:0};
const p=name=>g.scene.getObjectByName('mixamorig'+name).getWorldPosition(new T.Vector3());
const palm=side=>{const v=new T.Vector3();for(const finger of ['Index','Middle','Ring','Pinky'])for(const joint of[1,3])v.addScaledVector(p(side+'Hand'+finger+joint),.1);return v.addScaledVector(p(side+'HandThumb3'),.2);};
const names=['RightArm','RightForeArm','RightHand','LeftArm','LeftForeArm','LeftHand','Hips','Spine2','Head'].map(n=>'mixamorig'+n).concat('WeaponSocket'),nodes=names.map(n=>g.scene.getObjectByName(n));
const stats=Object.fromEntries(names.map(n=>[n,{localDegrees:0,worldDegrees:0,worldStepMeters:0}])),grips={Right:{requiredMax:0,activeMax:0,allMax:0},Left:{requiredMax:0,activeMax:0,allMax:0}},samples=[];
function sourceAt(time){const map=timing.timeMap;let i=map.findIndex(([t])=>t>=time);if(i<0)return map.at(-1)[1];if(!i)return map[0][1];const a=map[i-1],b=map[i];return a[1]+(b[1]-a[1])*(time-a[0])/(b[0]-a[0]);}
let previous=null;
for(let frame=0;frame<=Math.ceil(timing.duration*240);frame++){
 const time=Math.min(frame/240,timing.duration),source=sourceAt(time);actor.update(0,time,{health:100,action:{name:'slam',elapsed:time,directClipTime:true}},origin);const inverse=g.scene.getObjectByName('WeaponSocket').matrixWorld.clone().invert(),row={time,sourceTime:source,grips:{}};
 for(const side of ['Right','Left']){
  const local=palm(side).applyMatrix4(inverse),error=Math.hypot(local.x,local.y)*1.3,required=side==='Right'||source<=4||source>=6.4,s=grips[side];
  if(error>s.allMax){s.allMax=error;s.allAt=time;}if(required&&error>s.requiredMax){s.requiredMax=error;s.requiredAt=time;}
  if(timing.hitWindows.some(([a,b])=>time>=a&&time<b)&&error>s.activeMax){s.activeMax=error;s.activeAt=time;}
  row.grips[side]={shaftAxisDistance:error,shaftLocalZ:local.z,required};
 }
 if(frame%4===0){
  const pose=nodes.map(n=>({local:n.quaternion.clone(),world:n.getWorldQuaternion(new T.Quaternion()),position:n.getWorldPosition(new T.Vector3())}));
  if(previous)for(let j=0;j<nodes.length;j++){
   const a=previous[j],b=pose[j],s=stats[names[j]],local=a.local.angleTo(b.local)*180/Math.PI,world=a.world.angleTo(b.world)*180/Math.PI,step=a.position.distanceTo(b.position);
   if(local>s.localDegrees){s.localDegrees=local;s.localAt=time;}if(world>s.worldDegrees){s.worldDegrees=world;s.worldAt=time;}if(step>s.worldStepMeters){s.worldStepMeters=step;s.stepAt=time;}
  }
  previous=pose;samples.push(row);
 }
}
const all=[];g.scene.traverse(n=>{if(n.isBone||n.name==='WeaponSocket')all.push(n);});
function poseAt(name,time){actor.update(0,time,{health:100,action:{name,elapsed:time,directClipTime:true}},origin);return all.map(n=>({name:n.name,q:n.getWorldQuaternion(new T.Quaternion()),p:n.getWorldPosition(new T.Vector3())}));}
function compare(a,b){let position={maximum:0},rotation={maximum:0};for(let i=0;i<a.length;i++){const d=a[i].p.distanceTo(b[i].p),angle=a[i].q.angleTo(b[i].q)*180/Math.PI;if(d>position.maximum)position={maximum:d,node:a[i].name};if(angle>rotation.maximum)rotation={maximum:angle,node:a[i].name};}return {positionMeters:position,rotationDegrees:rotation};}
const idle=poseAt('idle',0),start=poseAt('slam',0),end=poseAt('slam',timing.duration),report={createdAt:new Date().toISOString(),asset:path,sha256:createHash('sha256').update(await fs.readFile(path)).digest('hex'),gripHz:240,jointHz:60,worldScale:1.3,gripMethod:'Weighted palm radial distance from WeaponSocket-local shaft axis; contact required for right throughout and left source0–4s/6.4–end; deliberate recovery release excluded from required max.',grips,joints:stats,endpoints:{idleToStart:compare(idle,start),endToIdle:compare(end,idle),startToEnd:compare(start,end)},samples};
await fs.writeFile(process.env.VESPER_TEMPORAL_REPORT||'docs/combat-revision/boss-v62-paced-temporal-grip.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,samples:undefined},null,2));
