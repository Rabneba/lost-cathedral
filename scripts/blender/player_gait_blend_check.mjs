import fs from 'node:fs';import * as T from 'three';
import {loadGLB} from '../load-glb-node.mjs';import{ActorAnimation}from'../../src/game/animation-controller.js';import{SoleClearance}from'../../src/game/sole-clearance.js';import{FootPlant}from'../../src/game/foot-plant.js';import metadata from '../../docs/player-essential-manifest.json'with{type:'json'};
const paths=[['baseline','assets/production/player-essential.glb'],['study','assets/player-essential-motion/player-material-support-study.glb']],out={};
for(const [label,path]of paths){const g=await loadGLB(path),anim=new ActorAnimation(g.scene,g.animations,metadata),sole=new SoleClearance(g.scene),plant=new FootPlant(g.scene,sole),rows=[];const legs=['Left','Right'].map(s=>['UpLeg','Leg','Foot'].map(x=>g.scene.getObjectByName('mixamorig'+s+x)));
for(const direction of ['forward','forward-left','left','back-left','backward','back-right','right','forward-right']){anim.reset();let minimum=0,raw=0,maxCorrection=0,maxFlexion=0,maxKneeStep=0,previous=null;
 for(const [name,len]of [['idle',.5],['run-forward',1.01],['run-'+direction,1.01],['run-forward',1.01],['idle',.5]])for(let t=0;t<len-1e-6;t+=1/60){anim.update(1/60,name,{speed:metadata.clips[name]?.sourceSpeed||0});g.scene.updateMatrixWorld(true);raw=Math.min(raw,sole.minimumHeight());plant.correct();minimum=Math.min(minimum,sole.minimumHeight());maxCorrection=Math.max(maxCorrection,plant.maxCorrection);
 const ks=[];for(const [upper,knee,foot]of legs){const a=upper.getWorldPosition(new T.Vector3()),b=knee.getWorldPosition(new T.Vector3()),c=foot.getWorldPosition(new T.Vector3());maxFlexion=Math.max(maxFlexion,b.clone().sub(a).angleTo(c.clone().sub(b))*180/Math.PI);ks.push(knee.quaternion.clone());}if(previous)maxKneeStep=Math.max(maxKneeStep,...ks.map((q,i)=>q.angleTo(previous[i])*180/Math.PI));previous=ks;
 }
 rows.push({direction,raw,minimum,maxCorrection,maxFlexion,maxKneeStep});}
 out[label]=rows;
}
fs.writeFileSync('docs/player-material-support-blends.json',JSON.stringify(out,null,2));console.log(JSON.stringify(out,null,2));
