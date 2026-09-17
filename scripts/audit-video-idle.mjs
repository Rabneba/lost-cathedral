import fs from 'node:fs';
import * as T from 'three';
import {loadGLB} from './load-glb-node.mjs';
const g=await loadGLB('assets/idle-video-motion/boss-idle-video.glb');
const source=await loadGLB('assets/idle-video-motion/boss-source.glb');
const clip=g.animations.find(a=>a.name==='idle-video'),mixer=new T.AnimationMixer(g.scene),srcMixer=new T.AnimationMixer(source.scene);
const action=mixer.clipAction(clip),srcAction=srcMixer.clipAction(source.animations[0]);action.clampWhenFinished=true;srcAction.clampWhenFinished=true;action.setLoop(T.LoopOnce,1).play();srcAction.setLoop(T.LoopOnce,1).play();
const names=['Hips','Spine2','Head','LeftFoot','RightFoot','LeftHand','RightHand'];
const samples=[];let maxGripError=0,minFloor=Infinity,maxFloor=-Infinity,maxFingerDeviation=0,minShaftToChest=Infinity;
function position(root,n){return root.getObjectByName(n).getWorldPosition(new T.Vector3());}
function grip(root,side){let p=new T.Vector3();for(const digit of ['Index','Middle','Ring','Pinky'])for(const j of[1,3])p.add(position(root,'mixamorig'+side+'Hand'+digit+j));return p.multiplyScalar(.8/8).addScaledVector(position(root,'mixamorig'+side+'HandThumb3'),.2);}
for(let i=0;i<=80;i++){
 const time=clip.duration*i/80;mixer.setTime(time);srcMixer.setTime(time);g.scene.updateMatrixWorld(true);source.scene.updateMatrixWorld(true);
 samples.push(Object.fromEntries(names.map(n=>{const b=g.scene.getObjectByName('mixamorig'+n);return[n,{p:b.getWorldPosition(new T.Vector3()).toArray(),q:b.getWorldQuaternion(new T.Quaternion()).toArray()}]})));
 let floor=Infinity;g.scene.traverse(n=>{if(n.isSkinnedMesh){n.computeBoundingBox();floor=Math.min(floor,n.boundingBox.clone().applyMatrix4(n.matrixWorld).min.y)}});minFloor=Math.min(minFloor,floor);maxFloor=Math.max(maxFloor,floor);
 const socket=g.scene.getObjectByName('WeaponSocket');const start=socket.getWorldPosition(new T.Vector3()),axis=new T.Vector3(0,0,1).applyQuaternion(socket.getWorldQuaternion(new T.Quaternion()));
 for(const [side,h] of [['Right',.6],['Left',1.55]])maxGripError=Math.max(maxGripError,grip(g.scene,side).distanceTo(start.clone().addScaledVector(axis,h)));
 const chest=position(g.scene,'mixamorigSpine2'),height=T.MathUtils.clamp(chest.clone().sub(start).dot(axis),.2,2.2);minShaftToChest=Math.min(minShaftToChest,chest.distanceTo(start.clone().addScaledVector(axis,height)));
 if(time<clip.duration-.45)g.scene.traverse(b=>{if(b.isBone&&/Hand(?:Index|Middle|Ring|Pinky|Thumb)/.test(b.name)){const raw=source.scene.getObjectByName(b.name);maxFingerDeviation=Math.max(maxFingerDeviation,b.quaternion.angleTo(raw.quaternion));}});
}
const span=Object.fromEntries(names.map(n=>{const p=samples.map(s=>new T.Vector3(...s[n].p)),q=samples.map(s=>new T.Quaternion(...s[n].q));return[n,{travelCm:Math.max(...p.flatMap(a=>p.map(b=>a.distanceTo(b))))*100,rotationDegrees:Math.max(...q.flatMap(a=>q.map(b=>a.angleTo(b))))*180/Math.PI}]}));
const loopPositionError=Math.max(...names.map(n=>new T.Vector3(...samples[0][n].p).distanceTo(new T.Vector3(...samples.at(-1)[n].p))));
const report={duration:clip.duration,sourceDuration:source.animations[0].duration,span,maxGripErrorCm:maxGripError*100,loopPositionErrorCm:loopPositionError*100,meshFloorRangeCm:[minFloor*100,maxFloor*100],minShaftToChestCenterCm:minShaftToChest*100,maxFingerLocalDeviationDegrees:maxFingerDeviation*180/Math.PI};
fs.writeFileSync('docs/boss-video-idle-export-audit.json',JSON.stringify(report,null,2));console.log(report);
if(maxGripError>.015||loopPositionError>.01||span.LeftFoot.travelCm>.1||span.RightFoot.travelCm>.1)throw Error('Video idle contact/loop export regression');
