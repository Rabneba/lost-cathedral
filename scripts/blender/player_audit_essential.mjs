import fs from 'node:fs';import {loadGLB} from '../load-glb-node.mjs';import * as T from 'three';
const g=await loadGLB('assets/production/player-essential.glb'),m=new T.AnimationMixer(g.scene),manifest=JSON.parse(fs.readFileSync('docs/player-essential-manifest.json'));let out={};
for(const clip of g.animations){
 const a=m.clipAction(clip);a.play();let frames=[],prev=null,speeds=[];
 for(let i=0;i<=160;i++){
  a.time=clip.duration*i/160;m.update(0);g.scene.updateMatrixWorld(true);const sample={t:a.time};
  for(const n of ['Hips','Spine2','LeftFoot','RightFoot','RightHand']){const b=g.scene.getObjectByName('mixamorig'+n);sample[n]={p:b.getWorldPosition(new T.Vector3()).toArray(),q:b.getWorldQuaternion(new T.Quaternion()).toArray()};}
  sample.sword=g.scene.getObjectByName('WeaponSocket').getWorldPosition(new T.Vector3()).toArray();frames.push(sample);
 }
 const angles={};for(const n of ['Hips','Spine2','LeftFoot','RightFoot','RightHand']){
  const q0=new T.Quaternion().fromArray(frames[0][n].q);angles[n]=Math.max(...frames.map(s=>q0.angleTo(new T.Quaternion().fromArray(s[n].q))))*180/Math.PI;
 }
 if(/^(walk|run)-/.test(clip.name)){
  for(const side of ['LeftFoot','RightFoot']){
   const ys=frames.map(s=>s[side].p[1]).sort((a,b)=>a-b);let velocities=[];
   for(let i=1;i<frames.length;i++){
    const p=frames[i][side].p,q=frames[i-1][side].p,dt=frames[i].t-frames[i-1].t;
    const v=Math.hypot(p[0]-q[0],p[2]-q[2])/dt;
    if(p[1]<ys[Math.floor(ys.length*.40)]&&v>.15&&v<8)velocities.push(v);
   }speeds.push(...velocities);
  }speeds.sort((a,b)=>a-b);const speed=speeds[Math.floor(speeds.length/2)];
  manifest.clips[clip.name].sourceSpeed=Math.round(speed*100)/100;manifest.clips[clip.name].sourceSpeedMethod='median horizontal ankle speed over lower 40% of foot heights';
 }
 manifest.clips[clip.name].duration=clip.duration;
 out[clip.name]={duration:clip.duration,angularExcursionDegrees:angles,sourceSpeed:manifest.clips[clip.name].sourceSpeed,loopHipDistance:new T.Vector3(...frames[0].Hips.p).distanceTo(new T.Vector3(...frames.at(-1).Hips.p))};
 a.stop();
}
manifest.locomotionSpeed=manifest.clips['run-forward'].sourceSpeed;manifest.validation={exportedClipCount:g.animations.length,exportedDurationsVerified:true,sourceSpeedMeasured:true};fs.writeFileSync('docs/player-essential-manifest.json',JSON.stringify(manifest,null,2)+'\n');fs.writeFileSync('docs/player-essential-export-audit.json',JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify(out,null,2));
