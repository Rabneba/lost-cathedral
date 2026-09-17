// Diagnostic only: capture the real ActorAnimation/FootPlant skin at 60 Hz.
import fs from 'node:fs';
import * as T from 'three';
import {loadGLB} from '../load-glb-node.mjs';
import {ActorAnimation} from '../../src/game/animation-controller.js';
import {SoleClearance} from '../../src/game/sole-clearance.js';
import {FootPlant} from '../../src/game/foot-plant.js';
import metadata from '../../docs/player-essential-manifest.json' with {type:'json'};

const asset='assets/production/player-essential.glb';
const g=await loadGLB(asset),anim=new ActorAnimation(g.scene,g.animations,metadata);
const sole=new SoleClearance(g.scene),plant=new FootPlant(g.scene,sole);
const from='run-forward-left',to='walk-back-left';
const dir='assets/player-essential-motion/gait-transition-continuous';
fs.mkdirSync(dir,{recursive:true});
const meshes=[];g.scene.traverse(m=>{if(m.isSkinnedMesh)meshes.push(m);});
const descriptions=meshes.map(m=>({name:m.name,count:m.geometry.attributes.position.count,
  indices:Array.from(m.geometry.index.array),uv:Array.from(m.geometry.attributes.uv.array)}));
const frames=[];
anim.update(0,from,{speed:metadata.clips[from].sourceSpeed});
anim.layers.get(from).time=metadata.clips[from].duration*.375-.2;
anim.update(0,from,{speed:metadata.clips[from].sourceSpeed});
for(let frame=0;frame<=60;frame++){
  if(frame)anim.update(1/60,frame<=12?from:to,{speed:metadata.clips[frame<=12?from:to].sourceSpeed});
  g.scene.updateMatrixWorld(true);plant.correct();
  const positions=new Float32Array(meshes.reduce((sum,m)=>sum+m.geometry.attributes.position.count*3,0));
  let off=0;for(const m of meshes)for(let i=0;i<m.geometry.attributes.position.count;i++){
    const v=m.getVertexPosition(i,new T.Vector3()).applyMatrix4(m.matrixWorld);
    positions[off++]=v.x;positions[off++]=-v.z;positions[off++]=v.y;
  }
  const name=`skin-${String(frame).padStart(3,'0')}.bin`;
  fs.writeFileSync(`${dir}/${name}`,Buffer.from(positions.buffer));
  frames.push({frame,time:frame/60,positions:name,sockets:Object.fromEntries(['WeaponSocket','ShieldSocket'].map(n=>[n,g.scene.getObjectByName(n).matrixWorld.toArray()]))});
}
fs.writeFileSync(`${dir}/manifest.json`,JSON.stringify({asset,from,to,fps:60,transitionStartsAfterFrame:12,worstAngularStepFrame:15,controllerTranslation:'held at origin for deformation inspection',meshes:descriptions,frames}));
console.log(`Captured ${frames.length} actual runtime-skinned frames.`);
