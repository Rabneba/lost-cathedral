import fs from 'node:fs';
import * as T from 'three';
import {loadGLB} from '../load-glb-node.mjs';
import {ActorAnimation} from '../../src/game/animation-controller.js';
import {SoleClearance} from '../../src/game/sole-clearance.js';
import metadata from '../../docs/player-essential-manifest.json' with {type:'json'};
const g=await loadGLB('assets/production/player-essential.glb');
const animation=new ActorAnimation(g.scene,g.animations,metadata),sole=new SoleClearance(g.scene);
const sides=['Left','Right'],legs=Object.fromEntries(sides.map(s=>[s,['UpLeg','Leg','Foot'].map(n=>g.scene.getObjectByName('mixamorig'+s+n))]));
const wp=b=>b.getWorldPosition(new T.Vector3()),wq=b=>b.getWorldQuaternion(new T.Quaternion());
function worldRotate(b,q){b.quaternion.copy(wq(b.parent).invert().multiply(q).multiply(wq(b)));b.updateMatrixWorld(true);}
function solve([upper,knee,foot],rise){
 const pa=wp(upper),pb=wp(knee),pc=wp(foot),orientation=wq(foot),target=pc.clone().add(new T.Vector3(0,rise,0));
 const l1=pa.distanceTo(pb),l2=pb.distanceTo(pc),axis=target.clone().sub(pa).normalize(),d=T.MathUtils.clamp(target.distanceTo(pa),1e-5,l1+l2-1e-5);
 const along=(l1*l1+d*d-l2*l2)/(2*d),height=Math.sqrt(Math.max(0,l1*l1-along*along));
 const plane=pb.clone().sub(pa).addScaledVector(axis,-pb.clone().sub(pa).dot(axis)).normalize();
 if(plane.lengthSq()<.5)return;
 const bend=pa.clone().addScaledVector(axis,along).addScaledVector(plane,height);
 worldRotate(upper,new T.Quaternion().setFromUnitVectors(pb.clone().sub(pa).normalize(),bend.clone().sub(pa).normalize()));
 const k=wp(knee),f=wp(foot);worldRotate(knee,new T.Quaternion().setFromUnitVectors(f.sub(k).normalize(),target.clone().sub(k).normalize()));
 foot.quaternion.copy(wq(foot.parent).invert().multiply(orientation));foot.updateMatrixWorld(true);
}
function kneeMetrics(side){const [h,k,f]=legs[side].map(wp),a=k.clone().sub(h).normalize(),b=f.clone().sub(k).normalize();return {flexion:a.angleTo(b)*180/Math.PI,knee:k.toArray(),foot:f.toArray(),hip:h.toArray(),footOrientation:wq(legs[side][2]).toArray()};}
function captureMesh(){const meshes=[];g.scene.traverse(m=>{if(!m.isSkinnedMesh)return;const p=m.geometry.attributes.position,uv=m.geometry.attributes.uv;meshes.push({name:m.name,positions:Array.from({length:p.count},(_,i)=>m.getVertexPosition(i,new T.Vector3()).applyMatrix4(m.matrixWorld).toArray()),indices:Array.from(m.geometry.index.array),uv:uv?Array.from({length:uv.count},(_,i)=>[uv.getX(i),uv.getY(i)]):[]});});const sockets=Object.fromEntries(['WeaponSocket','ShieldSocket'].map(n=>[n,g.scene.getObjectByName(n).matrixWorld.toArray()]));return {meshes,sockets};}
const rows=[],poses={};
for(let pass=0;pass<2;pass++){
 animation.reset();let frame=0;
 const selected=pass?new Set(['enter','exit'].map(s=>rows.filter(x=>x.segment===s).sort((a,b)=>a.raw-b.raw)[0].frame)):new Set();
 for(const [name,len,segment]of [['idle',.5,'start'],['run-forward',3,'enter'],['idle',.5,'exit']]){
  for(let t=0;t<len-1e-6;t+=1/60,frame++){
   animation.update(1/60,name,{speed:name==='run-forward'?metadata.locomotionSpeed:0});g.scene.updateMatrixWorld(true);
   const raw=sole.minimumHeight(),before=Object.fromEntries(sides.map(s=>[s,kneeMetrics(s)]));
   const chest=g.scene.getObjectByName('mixamorigSpine2').matrixWorld.clone();
   if(selected.has(frame))poses[segment+'-raw']=captureMesh();
   for(let correction=0;correction<2;correction++)for(const side of sides){const rise=Math.max(0,-sole.minimumHeight(side));if(rise>.0001)solve(legs[side],Math.min(.16,rise));}
   const after=Object.fromEntries(sides.map(s=>[s,kneeMetrics(s)]));
   if(selected.has(frame))poses[segment+'-corrected']=captureMesh();
   if(!pass)rows.push({frame,t,segment,name,raw,corrected:sole.minimumHeight(),blend:animation.debugState(),before,after,chestMatrixChanged:chest.elements.some((v,i)=>Math.abs(v-g.scene.getObjectByName('mixamorigSpine2').matrixWorld.elements[i])>1e-10)});
  }
 }
}
const worst=Object.fromEntries(['enter','exit'].map(s=>[s,rows.filter(x=>x.segment===s).sort((a,b)=>a.raw-b.raw)[0]]));
const summary={worst,maxFlexion:Math.max(...rows.flatMap(r=>sides.map(s=>r.after[s].flexion))),maxFootOrientationChangeDegrees:Math.max(...rows.flatMap(r=>sides.map(s=>new T.Quaternion().fromArray(r.before[s].footOrientation).angleTo(new T.Quaternion().fromArray(r.after[s].footOrientation))*180/Math.PI))),maxFootHorizontalChange:Math.max(...rows.flatMap(r=>sides.map(s=>Math.hypot(r.before[s].foot[0]-r.after[s].foot[0],r.before[s].foot[2]-r.after[s].foot[2])))),upperBodyChanged:rows.some(r=>r.chestMatrixChanged)};
fs.writeFileSync('docs/player-transition-ik-review.json',JSON.stringify({summary,rows},null,2));fs.writeFileSync('assets/player-essential-motion/player-transition-ik-poses.json',JSON.stringify(poses));console.log(JSON.stringify(summary,null,2));
