import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as T from 'three';
import {loadGLB} from './load-glb-node.mjs';
import {createActor} from '../src/game/actors.js';
import {ASSETS} from '../src/game/asset-paths.js';
const asset=process.env.VESPER_UPPERARM_ASSET||'assets/combat-revision/boss/v65-close-cutting-wing/boss-combat-candidate.glb',clipName=process.env.VESPER_UPPERARM_CLIP||'sweep';
const g=await loadGLB(asset),actor=createActor(g,2.5,true,true,ASSETS.motion.boss),origin={x:0,z:0,yaw:0};
const p=name=>g.scene.getObjectByName('mixamorig'+name).getWorldPosition(new T.Vector3()),q=name=>g.scene.getObjectByName('mixamorig'+name).getWorldQuaternion(new T.Quaternion());
actor.update(0,0,{health:100,action:{name:'idle',elapsed:0,directClipTime:true}},origin);
const normals={};for(const side of ['Left','Right']){const s=p(side+'Arm'),e=p(side+'ForeArm'),w=p(side+'Hand');normals[side]=e.sub(s).cross(w.sub(p(side+'ForeArm'))).normalize().applyQuaternion(q(side+'Arm').invert());}
const clip=g.animations.find(c=>c.name===clipName),rows=[];
for(let frame=0;frame<=Math.ceil(clip.duration*60);frame++){
 const time=Math.min(frame/60,clip.duration);actor.update(0,time,{health:100,action:{name:clipName,elapsed:time,directClipTime:true}},origin);const row={time,sourceFrame30:time*30,hands:{}};
 for(const side of ['Left','Right']){
  const shoulder=p(side+'Arm'),elbow=p(side+'ForeArm'),wrist=p(side+'Hand'),upper=elbow.clone().sub(shoulder),fore=wrist.clone().sub(elbow),axis=upper.clone().normalize(),normal=axis.clone().cross(fore),planeMagnitude=normal.length();normal.normalize();
  const current=normals[side].clone().applyQuaternion(q(side+'Arm'));current.addScaledVector(axis,-current.dot(axis)).normalize();
  const roll=Math.atan2(axis.dot(current.clone().cross(normal)),current.dot(normal))*180/Math.PI;
  row.hands[side]={humerusRollErrorFromIdleHinge:planeMagnitude>1e-6?roll:null,planeMagnitude,elbowBendDegrees:upper.angleTo(fore)*180/Math.PI,shoulder:shoulder.toArray(),elbow:elbow.toArray(),wrist:wrist.toArray(),elbowHeightRelativeShoulder:elbow.y-shoulder.y,elbowHeadDistance:elbow.distanceTo(p('Head'))};
 }
 rows.push(row);
}
function summary(samples){return Object.fromEntries(['Left','Right'].map(side=>[side,samples.filter(row=>row.hands[side].humerusRollErrorFromIdleHinge!==null).sort((a,b)=>Math.abs(b.hands[side].humerusRollErrorFromIdleHinge)-Math.abs(a.hands[side].humerusRollErrorFromIdleHinge)).slice(0,4).map(row=>({time:row.time,sourceFrame30:row.sourceFrame30,...row.hands[side]}))]));}
const report={createdAt:new Date().toISOString(),asset,sha256:createHash('sha256').update(await fs.readFile(asset)).digest('hex'),clip:clipName,calibration:'Same physical metric as scripts/blender/audit_boss_upperarm.py: approved idle0 elbow-plane normal expressed in each Arm-local frame; signed roll needed to align its posed normal with current shoulder/elbow/wrist bend plane about the humerus axis.',sampleHz:60,scope:'This diagnoses humerus axial orientation relative to the authored hinge, not complete skin self-intersection or anatomical approval. Both bend angle and plane magnitude are included; nearly straight elbow planes are poorly conditioned.',wholeClipWorst:summary(rows),twoHandIntervalWorst:summary(rows.filter(r=>r.time>=4/3&&r.time<=11/3)),rows};
await fs.writeFile(process.env.VESPER_UPPERARM_REPORT||'docs/combat-revision/boss-v65-upperarm.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,rows:undefined},null,2));
