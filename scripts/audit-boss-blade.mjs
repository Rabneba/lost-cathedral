import fs from 'node:fs/promises';
import * as T from 'three';
import {loadGLB} from './load-glb-node.mjs';
import {sweptWeaponContact} from '../src/game/weapon-motion.js';

// Measured on the fitted 2.85m prop after runtime normalization and grip centering.
// This follows the cutting edge, including its offset from the handle's plane.
const edge=[[.2,2.79,-.29],[.825,2.39,-.315]];
const gltf=await loadGLB('assets/production/boss-essential.glb');
const mixer=new T.AnimationMixer(gltf.scene),socket=gltf.scene.getObjectByName('WeaponSocket');
const report={asset:'assets/production/boss-essential.glb',weapon:'assets/idle-video-motion/scythe-fitted.glb',weaponHeight:2.85,edge,clips:{}};
const intervals=times=>times.reduce((ranges,t)=>{
 if(!ranges.length||t-ranges.at(-1)[1]>.02)ranges.push([t,t]);else ranges.at(-1)[1]=t;
 return ranges;
},[]);
for(const name of ['sweep','slam']){
 mixer.stopAllAction();const clip=gltf.animations.find(c=>c.name===name),action=mixer.clipAction(clip);
 action.setLoop(T.LoopOnce,1);action.clampWhenFinished=true;action.play();
 const contacts=Object.fromEntries([1.2,1.6,1.8,2,2.2,2.4,2.8,4].map(d=>[d,[]]));
 const floor=[];let previous=null;
 for(let t=0;t<=clip.duration;t+=1/120){
  action.time=t;mixer.update(0);gltf.scene.updateMatrixWorld(true);
  const matrix=socket.matrixWorld.clone().multiply(new T.Matrix4().makeRotationX(Math.PI/2));
  const segment=edge.map(point=>new T.Vector3(...point).applyMatrix4(matrix).toArray());
  for(const range of Object.keys(contacts))if(sweptWeaponContact(previous,segment,[[0,.45,+range],[0,1.5,+range]],.42))contacts[range].push(+t.toFixed(3));
  floor.push({time:+t.toFixed(3),height:Math.min(...segment.map(p=>p[1]))});previous=segment;
 }
 report.clips[name]={duration:clip.duration,contacts:Object.fromEntries(Object.entries(contacts).map(([d,times])=>[d,intervals(times)])),lowestBlade:floor.reduce((a,b)=>a.height<b.height?a:b)};
}
await fs.writeFile('docs/boss-blade-contact-audit.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
