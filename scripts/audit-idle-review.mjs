import fs from 'node:fs';
import * as T from 'three';
import {loadGLB} from './load-glb-node.mjs';
const g=await loadGLB('assets/idle-trial/boss-idle-study.glb');
const baseline=await loadGLB('assets/production/boss-combat.glb');
const prev=g.animations.find(a=>a.name==='idle'),original=baseline.animations.find(a=>a.name==='idle');
const clip=g.animations.find(a=>a.name==='idle-study'),mixer=new T.AnimationMixer(g.scene);
mixer.clipAction(clip).play();
const names=['Hips','Spine2','Head','LeftFoot','RightFoot','LeftHand','RightHand'],samples=[];
let minY=Infinity;
for(let i=0;i<=64;i++){
 mixer.setTime(i*clip.duration/64);g.scene.updateMatrixWorld(true);
 samples.push(Object.fromEntries(names.map(n=>{const b=g.scene.getObjectByName('mixamorig'+n);return[n,{p:b.getWorldPosition(new T.Vector3()).toArray(),q:b.getWorldQuaternion(new T.Quaternion()).toArray()}]})));
 g.scene.traverse(n=>{if(n.isSkinnedMesh){n.computeBoundingBox();minY=Math.min(minY,n.boundingBox.clone().applyMatrix4(n.matrixWorld).min.y)}});
}
const span=Object.fromEntries(names.map(n=>{
 const a=samples.map(s=>new T.Vector3(...s[n].p)),q=samples.map(s=>new T.Quaternion(...s[n].q));
 return[n,{travelCm:Math.max(...a.flatMap(x=>a.map(y=>x.distanceTo(y))))*100,rotationDegrees:Math.max(...q.flatMap(x=>q.map(y=>x.angleTo(y))))*180/Math.PI}];
}));
const exactPrevious=prev.duration===original.duration&&prev.tracks.length===original.tracks.length&&prev.tracks.every((t,i)=>t.name===original.tracks[i].name&&t.times.every((v,k)=>v===original.tracks[i].times[k])&&t.values.every((v,k)=>v===original.tracks[i].values[k]));
const report={clips:g.animations.map(a=>[a.name,a.duration]),exactPrevious,bodyLowestPoint:minY,span,loopErrorCm:Math.max(...names.map(n=>new T.Vector3(...samples[0][n].p).distanceTo(new T.Vector3(...samples.at(-1)[n].p))*100))};
fs.writeFileSync('docs/boss-idle-export-audit.json',JSON.stringify(report,null,2));console.log(report);
if(!exactPrevious||report.loopErrorCm>.01||span.LeftFoot.travelCm>.1||span.RightFoot.travelCm>.1)throw Error('Idle export regression');
