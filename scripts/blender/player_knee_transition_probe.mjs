// Independent prototype only; production runtime and assets are not modified.
import fs from 'node:fs';
import * as T from 'three';
import {loadGLB} from '../load-glb-node.mjs';
import {ActorAnimation} from '../../src/game/animation-controller.js';
import {SoleClearance} from '../../src/game/sole-clearance.js';
import {FootPlant} from '../../src/game/foot-plant.js';
import meta from '../../docs/player-essential-manifest.json' with {type:'json'};

const asset='assets/production/player-essential.glb';
const from=process.argv[2]||'run-forward-left',to=process.argv[3]||'walk-back-left';
const phase=Number(process.argv[4]||.375),speedScale=Number(process.argv[5]||1);
const sides=['Left','Right'];
const pos=(root,n)=>root.getObjectByName('mixamorig'+n).getWorldPosition(new T.Vector3());
const flex=(root,side)=>180-pos(root,side+'UpLeg').sub(pos(root,side+'Leg')).angleTo(pos(root,side+'Foot').sub(pos(root,side+'Leg')))*180/Math.PI;

class TargetPlant extends FootPlant {
  targetLeg(leg,target,rotation) {
    const {upper,knee,foot}=leg;
    const a=upper.getWorldPosition(new T.Vector3()),b=knee.getWorldPosition(new T.Vector3()),c=foot.getWorldPosition(new T.Vector3());
    const l1=a.distanceTo(b),l2=b.distanceTo(c),distance=T.MathUtils.clamp(a.distanceTo(target),1e-5,l1+l2-1e-5);
    this.maxReachExcess=Math.max(this.maxReachExcess||0,a.distanceTo(target)-l1-l2);
    const axis=target.clone().sub(a).normalize(),along=(l1*l1+distance*distance-l2*l2)/(2*distance);
    const plane=b.clone().sub(a);plane.addScaledVector(axis,-plane.dot(axis));
    this.minPlaneLengthSq=Math.min(this.minPlaneLengthSq??Infinity,plane.lengthSq());
    if(plane.lengthSq()<1e-8)return;
    const bend=a.clone().addScaledVector(axis,along).addScaledVector(plane.normalize(),Math.sqrt(Math.max(0,l1*l1-along*along)));
    this.rotateInWorld(upper,new T.Quaternion().setFromUnitVectors(b.clone().sub(a).normalize(),bend.sub(a).normalize()));
    knee.getWorldPosition(b);foot.getWorldPosition(c);
    this.rotateInWorld(knee,new T.Quaternion().setFromUnitVectors(c.sub(b).normalize(),target.clone().sub(b).normalize()));
    foot.quaternion.copy(foot.parent.getWorldQuaternion(new T.Quaternion()).invert().multiply(rotation));
    foot.updateMatrixWorld(true);
  }
}

const refs={};
for(const name of [from,to]){
  const g=await loadGLB(asset),mixer=new T.AnimationMixer(g.scene),action=mixer.clipAction(g.animations.find(c=>c.name===name));
  action.play();action.paused=true;refs[name]={g,mixer,action,soles:new SoleClearance(g.scene)};
}
function sampleSource(name,time){
  const r=refs[name];r.action.time=time;r.mixer.update(0);r.g.scene.updateMatrixWorld(true);
  return Object.fromEntries(sides.map(side=>[side,{ankle:pos(r.g.scene,side+'Foot'),knee:pos(r.g.scene,side+'Leg'),hip:pos(r.g.scene,side+'UpLeg'),rotation:r.g.scene.getObjectByName('mixamorig'+side+'Foot').getWorldQuaternion(new T.Quaternion()),flex:flex(r.g.scene,side),sole:r.soles.minimumHeight(side)}]));
}
const results={asset,from,to,phase,speedScale,variants:{}};
for(const variant of (process.env.PLAYER_KNEE_VARIANT?[process.env.PLAYER_KNEE_VARIANT]:['raw','floor','position','position-rotation','position-smooth','position-smooth-tapered','position-smooth-ramp'])){
  const g=await loadGLB(asset),anim=new ActorAnimation(g.scene,g.animations,meta),soles=new SoleClearance(g.scene),plant=new TargetPlant(g.scene,soles);
  anim.update(0,from,{speed:meta.clips[from].sourceSpeed*speedScale});
  anim.layers.get(from).time=meta.clips[from].duration*phase-.2;
  anim.update(0,from,{speed:meta.clips[from].sourceSpeed*speedScale});
  let previous=null;const rows=[];const captureDir=process.env.PLAYER_KNEE_CAPTURE;
  const captureMeshes=[];g.scene.traverse(m=>{if(m.isSkinnedMesh)captureMeshes.push(m);});const captured=[];
  if(captureDir)fs.mkdirSync(captureDir,{recursive:true});
  for(let frame=0;frame<=60;frame++){
    if(frame)anim.update(1/60,frame<=12?from:to,{speed:meta.clips[frame<=12?from:to].sourceSpeed*speedScale});
    g.scene.updateMatrixWorld(true);
    const sourceLayers=[...anim.layers].map(([name,l])=>({name,weight:l.weight,time:l.time,pose:sampleSource(name,l.time)}));
    const original=Object.fromEntries(sides.map(side=>[side,{flex:flex(g.scene,side),sole:soles.minimumHeight(side),ankle:pos(g.scene,side+'Foot').toArray()}]));
    if(variant.startsWith('position')&&anim.transition){
      for(const leg of plant.legs){
        const target=new T.Vector3(),rotation=new T.Quaternion();let weight=0;
        for(const layer of sourceLayers){const source=layer.pose[leg.side];target.addScaledVector(source.ankle,layer.weight);if(!weight)rotation.copy(source.rotation);else rotation.slerp(source.rotation,layer.weight/(weight+layer.weight));weight+=layer.weight;}
        if(variant==='position'||variant.includes('smooth'))rotation.copy(leg.foot.getWorldQuaternion(new T.Quaternion()));
        if(variant.includes('smooth')){
          const filtered=new T.Vector3();
          for(const layer of sourceLayers){
            for(const [offset,w]of[[-2/60,1/9],[-1/60,2/9],[0,3/9],[1/60,2/9],[2/60,1/9]]){
              const duration=meta.clips[layer.name].duration;
              filtered.addScaledVector(sampleSource(layer.name,(layer.time+offset+duration)%duration)[leg.side].ankle,layer.weight*w);
            }
          }
          // During a crossfade only, round the reconstructed task-space trajectory.
          // Preserve the original blended source height so authored flight is never lowered.
          filtered.y=Math.max(filtered.y,target.y);
          let strength=variant==='position-smooth-tapered'?Math.sin(Math.PI*Math.min(1,anim.transition.elapsed/anim.transition.duration)):1;
          if(variant==='position-smooth-ramp'){const u=Math.max(0,Math.min(1,anim.transition.elapsed/(2/60),(anim.transition.duration-anim.transition.elapsed)/(2/60)));strength=u*u*(3-2*u);}
          target.lerp(filtered,strength);
        }
        plant.targetLeg(leg,target,rotation);
      }
    }
    if(variant!=='raw')plant.correct();
    const feet=Object.fromEntries(sides.map(side=>[side,{flex:flex(g.scene,side),sole:soles.minimumHeight(side),ankle:pos(g.scene,side+'Foot').toArray()}]));
    const step=previous?Math.max(...sides.map(side=>Math.abs(feet[side].flex-previous[side].flex))):0;
    if(captureDir){
      const positions=new Float32Array(captureMeshes.reduce((sum,m)=>sum+m.geometry.attributes.position.count*3,0));let off=0;
      for(const m of captureMeshes)for(let i=0;i<m.geometry.attributes.position.count;i++){const v=m.getVertexPosition(i,new T.Vector3()).applyMatrix4(m.matrixWorld);positions[off++]=v.x;positions[off++]=-v.z;positions[off++]=v.y;}
      const file=`skin-${String(frame).padStart(3,'0')}.bin`;fs.writeFileSync(`${captureDir}/${file}`,Buffer.from(positions.buffer));
      captured.push({frame,positions:file,sockets:Object.fromEntries(['WeaponSocket','ShieldSocket'].map(n=>[n,g.scene.getObjectByName(n).matrixWorld.toArray()]))});
    }
    rows.push({frame,step,correction:plant.maxCorrection,feet,original,sources:sourceLayers.map(l=>({name:l.name,time:l.time,weight:l.weight,feet:Object.fromEntries(sides.map(side=>[side,{flex:l.pose[side].flex,sole:l.pose[side].sole,hip:l.pose[side].hip.toArray(),ankle:l.pose[side].ankle.toArray()}]))}))});previous=feet;
  }
  if(captureDir)fs.writeFileSync(`${captureDir}/manifest.json`,JSON.stringify({asset,variant,fps:60,meshes:captureMeshes.map(m=>({name:m.name,count:m.geometry.attributes.position.count,indices:Array.from(m.geometry.index.array),uv:Array.from(m.geometry.attributes.uv.array)})),frames:captured}));
  results.variants[variant]={maxReachExcess:plant.maxReachExcess||0,minPlaneLengthSq:plant.minPlaneLengthSq??null,maxFlexStep:Math.max(...rows.map(r=>r.step)),minSole:Math.min(...rows.flatMap(r=>sides.map(s=>r.feet[s].sole))),maxCorrection:Math.max(...rows.map(r=>r.correction)),rows};
}
const file=process.env.PLAYER_KNEE_REPORT||'docs/player-knee-transition-diagnosis.json';fs.writeFileSync(file,JSON.stringify(results,null,2));
console.log(Object.fromEntries(Object.entries(results.variants).map(([k,v])=>[k,{maxFlexStep:v.maxFlexStep,minSole:v.minSole,maxCorrection:v.maxCorrection}])));
