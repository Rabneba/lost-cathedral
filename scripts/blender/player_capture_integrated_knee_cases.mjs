import fs from'node:fs';import *as T from'three';import{loadGLB}from'../load-glb-node.mjs';import{createActor}from'../../src/game/actors.js';import meta from'../../docs/player-essential-manifest.json'with{type:'json'};
const cases=[{label:'new-maximum',from:'run-right',to:'run-forward',phase:.125},{label:'largest-regression',from:'run-forward',to:'walk-backward',phase:.375}];
for(const spec of cases){
 const g=await loadGLB('assets/production/player-essential.glb'),actor=createActor(g,1.85,false,true,meta),meshes=[];g.scene.traverse(m=>{if(m.isSkinnedMesh)meshes.push(m);});
 const dir=`docs/player-integrated-knee-${spec.label}`;fs.mkdirSync(dir,{recursive:true});const frames=[],motion={x:0,z:0,yaw:0};
 actor.reset(motion);actor.moveDirection=spec.from.replace(/^(run|walk)-/,'');actor.moving=true;actor.animation.update(0,spec.from,{speed:meta.clips[spec.from].sourceSpeed});actor.animation.layers.get(spec.from).time=meta.clips[spec.from].duration*spec.phase;actor.animation.update(0,spec.from,{speed:meta.clips[spec.from].sourceSpeed});actor.root.updateMatrixWorld(true);actor.footPlant.correct();
 function capture(frame){
  const positions=new Float32Array(meshes.reduce((n,m)=>n+m.geometry.attributes.position.count*3,0));let offset=0;
  for(const m of meshes)for(let i=0;i<m.geometry.attributes.position.count;i++){const v=m.getVertexPosition(i,new T.Vector3()).applyMatrix4(m.matrixWorld).sub(new T.Vector3(motion.x,0,motion.z));positions[offset++]=v.x;positions[offset++]=-v.z;positions[offset++]=v.y;}
  const name=`skin-${String(frame).padStart(3,'0')}.bin`;fs.writeFileSync(`${dir}/${name}`,Buffer.from(positions.buffer));const untravel=new T.Matrix4().makeTranslation(-motion.x,0,-motion.z);
  frames.push({frame,positions:name,sockets:Object.fromEntries(['WeaponSocket','ShieldSocket'].map(n=>[n,untravel.clone().multiply(g.scene.getObjectByName(n).matrixWorld).toArray()]))});
 }
 capture(0);const d=new T.Vector3(spec.to.includes('left')?1:spec.to.includes('right')?-1:0,0,spec.to.includes('forward')?1:spec.to.includes('back')?-1:0).normalize().multiplyScalar(meta.clips[spec.to].sourceSpeed/60);
 for(let frame=1;frame<=8;frame++){motion.x+=d.x;motion.z+=d.z;actor.update(1/60,frame/60,{health:100,blocking:spec.to.startsWith('walk-'),action:null},motion);if([1,2,3,5,8].includes(frame))capture(frame);}
 fs.writeFileSync(`${dir}/manifest.json`,JSON.stringify({asset:'assets/production/player-essential.glb',...spec,method:'Actual production createActor.update; frame0 before transition; later frames are60Hz updates. Root horizontal travel removed only for stationary deformation review.',meshes:meshes.map(m=>({name:m.name,count:m.geometry.attributes.position.count,indices:Array.from(m.geometry.index.array),uv:Array.from(m.geometry.attributes.uv.array)})),frames}));
 console.log('Captured',spec.label);
}
