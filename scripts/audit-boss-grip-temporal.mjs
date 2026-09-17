import fs from 'node:fs/promises';
import * as T from 'three';
import {loadGLB} from './load-glb-node.mjs';
const path=process.argv[2]||'assets/combat-revision/boss/v75-slam-bounded-grip-review/boss-combat-candidate.glb',tag=process.argv[3]||'v75';
const g=await loadGLB(path),root=g.scene;root.scale.multiplyScalar(1.3);const bones={};root.traverse(o=>{if(o.isBone)bones[o.name.replace(/^mixamorig:?/,'')]=o;});
const clip=g.animations.find(a=>a.name==='slam'),mixer=new T.AnimationMixer(root),action=mixer.clipAction(clip);action.setLoop(T.LoopOnce,1);action.clampWhenFinished=true;action.play();
const cloud=JSON.parse(await fs.readFile('docs/combat-revision/scythe-socket-vertex-cloud.json')).xyz;
const P=n=>bones[n].getWorldPosition(new T.Vector3()),Q=n=>bones[n].getWorldQuaternion(new T.Quaternion());
const grip=s=>{let v=new T.Vector3();for(const d of ['Index','Middle','Ring','Pinky'])for(const j of [1,3])v.addScaledVector(P(s+'Hand'+d+j),.1);return v.addScaledVector(P(s+'HandThumb3'),.2);};
let prev=null;const peaks={floor:{value:Infinity},weaponStep:{value:0},Left:{},Right:{}},rows=[];
const maximum=(obj,k,v,time)=>{if(!obj[k]||v>obj[k].value)obj[k]={value:v,time};};
for(let i=0;i<=Math.ceil(clip.duration*240);i++){
 const time=Math.min(clip.duration,i/240);action.time=time;mixer.update(0);root.updateMatrixWorld(true);const w=bones.WeaponSocket,m=w.matrixWorld.elements,axis=new T.Vector3(0,0,1).applyQuaternion(Q('WeaponSocket')),origin=P('WeaponSocket');let floor=Infinity;
 for(let j=0;j<cloud.length;j+=3)floor=Math.min(floor,m[1]*cloud[j]+m[5]*cloud[j+1]+m[9]*cloud[j+2]+m[13]);
 if(floor<peaks.floor.value)peaks.floor={value:floor,time};const sample={time,weaponQ:Q('WeaponSocket'),hands:{}};
 if(prev)maximum(peaks,'weaponStep',prev.weaponQ.angleTo(sample.weaponQ)*180/Math.PI,time);
 for(const s of ['Left','Right']){
  const shoulder=P(s+'Arm'),elbow=P(s+'ForeArm'),wrist=P(s+'Hand'),fore=wrist.clone().sub(elbow).normalize(),upper=elbow.clone().sub(shoulder).normalize(),hinge=upper.clone().cross(fore).normalize(),neutral=hinge.clone().cross(fore).normalize(),thumb=P(s+'HandIndex1').sub(P(s+'HandPinky1'));thumb.addScaledVector(fore,-thumb.dot(fore)).normalize();const phi=Math.atan2(fore.dot(neutral.clone().cross(thumb)),neutral.dot(thumb))*180/Math.PI,long=P(s+'HandMiddle1').sub(wrist).normalize(),bend=long.angleTo(fore)*180/Math.PI,palm=grip(s),relative=palm.clone().sub(origin),gap=relative.clone().addScaledVector(axis,-relative.dot(axis)).length();const h={wrist,elbow,localWrist:bones[s+'Hand'].quaternion.clone(),localForearm:bones[s+'ForeArm'].quaternion.clone(),phi,bend,gap};sample.hands[s]=h;maximum(peaks[s],'absolutePronation',Math.abs(phi),time);maximum(peaks[s],'wristBend',bend,time);if(s==='Right'||(time>=35/30&&time<=125/30))maximum(peaks[s],'heldPalmAxisGap',gap,time);
  if(prev){const p=prev.hands[s];maximum(peaks[s],'wristStep',p.wrist.distanceTo(wrist),time);maximum(peaks[s],'elbowStep',p.elbow.distanceTo(elbow),time);maximum(peaks[s],'localWristStep',p.localWrist.angleTo(h.localWrist)*180/Math.PI,time);maximum(peaks[s],'localForearmStep',p.localForearm.angleTo(h.localForearm)*180/Math.PI,time);}
 }
 if(i%8===0)rows.push({time,floor,hands:Object.fromEntries(['Left','Right'].map(s=>[s,{pronation:sample.hands[s].phi,bend:sample.hands[s].bend,palmGap:sample.hands[s].gap}]))});prev=sample;
}
const out={asset:path,scale:1.3,fps:240,duration:clip.duration,method:'Actual exported GLB quaternion interpolation, geometric anatomy and full scythe vertex floor. Surface grip and skin still require visual inspection.',peaks,rows};await fs.writeFile(`docs/combat-revision/boss-${tag}-grip-temporal.json`,JSON.stringify(out,null,2));console.log(JSON.stringify(peaks,null,2));
