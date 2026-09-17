import fs from 'node:fs';
import * as T from 'three';
import {loadGLB} from './load-glb-node.mjs';
const g=await loadGLB('assets/production/boss-essential.glb');
const original=await loadGLB('assets/approved/boss-idle.glb');
const mixer=new T.AnimationMixer(g.scene),oldMixer=new T.AnimationMixer(original.scene);
const names=['Hips','Spine2','Head','LeftFoot','RightFoot','LeftHand','RightHand'];
const smooth=t=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);};
function anchors(name,t){const source=t/4.2*(215/30),slide=name==='slam'?smooth(source/1.8)*(1-smooth((source-3.6)/2.1)):0;return[['Right',.6+.2*slide],['Left',1.55-.25*slide]];}
function p(root,name){return root.getObjectByName('mixamorig'+name).getWorldPosition(new T.Vector3());}
function grip(root,side){const result=new T.Vector3();for(const d of ['Index','Middle','Ring','Pinky'])for(const n of[1,3])result.add(p(root,side+'Hand'+d+n));return result.multiplyScalar(.8/8).addScaledVector(p(root,side+'HandThumb3'),.2);}
const out={};let idleDifference=0;
oldMixer.clipAction(original.animations[0]).setLoop(T.LoopOnce,1).play().clampWhenFinished=true;
for(const clip of g.animations){
 mixer.stopAllAction();const a=mixer.clipAction(clip).setLoop(T.LoopOnce,1).play();a.clampWhenFinished=true;
 const points=[];const poseSamples=[];let minFloor=Infinity,maxFloor=-Infinity,gripError=0;
 const count=Math.ceil(clip.duration*30);
 for(let i=0;i<=count;i++){
  const t=clip.duration*i/count;a.time=t;mixer.update(0);g.scene.updateMatrixWorld(true);
  let floor=Infinity;g.scene.traverse(n=>{if(n.isSkinnedMesh){n.computeBoundingBox();floor=Math.min(floor,n.boundingBox.clone().applyMatrix4(n.matrixWorld).min.y);}});
  minFloor=Math.min(minFloor,floor);maxFloor=Math.max(maxFloor,floor);
  const socket=g.scene.getObjectByName('WeaponSocket'),origin=socket.getWorldPosition(new T.Vector3()),axis=new T.Vector3(0,0,1).applyQuaternion(socket.getWorldQuaternion(new T.Quaternion()));
  for(const[side,z]of anchors(clip.name,t))gripError=Math.max(gripError,grip(g.scene,side).distanceTo(origin.clone().addScaledVector(axis,z)));
  if(clip.name==='idle'){
   oldMixer.setTime(t);original.scene.updateMatrixWorld(true);
   for(const n of names)idleDifference=Math.max(idleDifference,p(g.scene,n).distanceTo(p(original.scene,n)));
  }
  const sample=Object.fromEntries(names.map(n=>[n,p(g.scene,n).toArray()]));poseSamples.push(sample);
  points.push({time:t,position:origin.toArray(),quaternion:socket.getWorldQuaternion(new T.Quaternion()).toArray()});
 }
 const spans=Object.fromEntries(names.map(n=>{const ps=poseSamples.map(s=>s[n]);return[n,[0,1,2].map(axis=>Math.max(...ps.map(p=>p[axis]))-Math.min(...ps.map(p=>p[axis])))];}));
 const seam=Math.max(...names.map(n=>new T.Vector3(...poseSamples[0][n]).distanceTo(new T.Vector3(...poseSamples.at(-1)[n]))));
 out[clip.name]={duration:clip.duration,floorRange:[minFloor,maxFloor],maxGripError:gripError,bodySpans:spans,seamPositionError:seam,weaponSamples:points};
 console.log(clip.name,JSON.stringify({duration:clip.duration,floor:[minFloor,maxFloor],grip:gripError,seam,spineSpan:spans.Spine2}));
}
out.approvedIdleMaxJointDifference=idleDifference;
fs.writeFileSync('docs/boss-essential-export-audit.json',JSON.stringify(out,null,2)+'\n');
console.log('Approved idle maximum joint difference',idleDifference);
