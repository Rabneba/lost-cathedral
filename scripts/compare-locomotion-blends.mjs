import fs from 'node:fs';
import crypto from 'node:crypto';
import * as T from 'three';
import {loadGLB} from './load-glb-node.mjs';
import {ActorAnimation} from '../src/game/animation-controller.js';
import {SoleClearance} from '../src/game/sole-clearance.js';
import {FootPlant} from '../src/game/foot-plant.js';
import sourceMetadata from '../docs/player-essential-manifest.json' with {type:'json'};
const path='assets/production/player-essential.glb',assetHash=crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex');
const g=await loadGLB(path),names=g.animations.filter(c=>/^(run|walk)-/.test(c.name)).map(c=>c.name);
const soles=new SoleClearance(g.scene),plant=new FootPlant(g.scene,soles),v=[new T.Vector3(),new T.Vector3(),new T.Vector3()];
const legs=['Left','Right'].map(side=>['UpLeg','Leg','Foot'].map(part=>g.scene.getObjectByName('mixamorig'+side+part)));
function flexion(leg){leg.forEach((bone,i)=>bone.getWorldPosition(v[i]));const a=v[0].distanceTo(v[1]),b=v[1].distanceTo(v[2]),c=v[0].distanceTo(v[2]);return (Math.PI-Math.acos(T.MathUtils.clamp((a*a+b*b-c*c)/(2*a*b),-1,1)))*180/Math.PI;}
const variants=[];
for(const blendIn of [.22,.28,.34,.40]){
 const metadata=structuredClone(sourceMetadata);for(const name of names)metadata.clips[name].blendIn=blendIn;
 const anim=new ActorAnimation(g.scene,g.animations,metadata),steps=[];let minimum=0,maxCorrection=0,worst={step:0};
 for(const from of names)for(const to of names){if(from===to)continue;
  for(const phase of [0,.125,.25,.375]){
   anim.reset();anim.update(0,from,{speed:metadata.clips[from].sourceSpeed});anim.layers.get(from).time=anim.layers.get(from).action.getClip().duration*phase;anim.update(0,from,{speed:metadata.clips[from].sourceSpeed});g.scene.updateMatrixWorld(true);plant.correct();let previous=legs.map(flexion);
   for(let frame=0;frame<36;frame++){
    anim.update(1/60,to,{speed:metadata.clips[to].sourceSpeed});g.scene.updateMatrixWorld(true);plant.correct();const values=legs.map(flexion),step=Math.max(...values.map((value,i)=>Math.abs(value-previous[i])));previous=values;
    steps.push(step);minimum=Math.min(minimum,soles.minimumHeight());maxCorrection=Math.max(maxCorrection,plant.maxCorrection);
    if(step>worst.step)worst={from,to,phase,frame,step};
   }
  }
 }
 steps.sort((a,b)=>a-b);const row={blendIn,minimum,maxCorrection,p95FlexStepDegrees:steps[Math.floor(steps.length*.95)],p99FlexStepDegrees:steps[Math.floor(steps.length*.99)],worst};variants.push(row);anim.reset();console.log(JSON.stringify(row));
}
fs.writeFileSync('docs/locomotion-blend-comparison.json',JSON.stringify({asset:path,assetHash,method:'960 gait transitions, four normalized phases, 36 frames at60Hz each. Actual world hip/knee/ankle flexion after FootPlant. Metadata changes only inside this diagnostic.',variants},null,2));
