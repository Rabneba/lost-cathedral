import fs from 'node:fs';import {createHash} from 'node:crypto';import * as T from 'three';
import {loadGLB} from '../load-glb-node.mjs';import {createActor} from '../../src/game/actors.js';
import metadata from '../../docs/player-essential-manifest.json' with {type:'json'};
const asset='assets/production/player-essential.glb';
function probes(root){const result=[];root.traverse(m=>{if(!m.isSkinnedMesh)return;const {skinIndex,skinWeight}=m.geometry.attributes;for(let i=0;i<skinIndex.count;i++){let w=0;for(let c=0;c<4;c++)if(/(Left|Right)(Foot|ToeBase)$/.test(m.skeleton.bones[skinIndex.getComponent(i,c)].name))w+=skinWeight.getComponent(i,c);if(w>=.5)result.push({m,i});}});return result;}
const point=new T.Vector3();function fullMinimum(vertices){let min=Infinity;for(const {m,i}of vertices)min=Math.min(min,m.getVertexPosition(i,point).applyMatrix4(m.matrixWorld).y);return min;}
function flex(root,side){const a=root.getObjectByName('mixamorig'+side+'UpLeg').getWorldPosition(new T.Vector3()),b=root.getObjectByName('mixamorig'+side+'Leg').getWorldPosition(new T.Vector3()),c=root.getObjectByName('mixamorig'+side+'Foot').getWorldPosition(new T.Vector3());return 180-a.sub(b).angleTo(c.sub(b))*180/Math.PI;}
function direction(name){return new T.Vector3(name.includes('left')?1:name.includes('right')?-1:0,0,name.includes('forward')?1:name.includes('back')?-1:0).normalize();}
const result={asset,sha256:createHash('sha256').update(fs.readFileSync(asset)).digest('hex'),method:'Actual createActor.update hook; all240 ordered locomotion pairs at4 phases and20 frames60Hz. Every >=50% foot/toe weighted skinned vertex measured each frame. Source-speed playback isolates phase/geometry.',variants:{}};
for(const mode of ['baseline','integrated']){
 const g=await loadGLB(asset),actor=createActor(g,1.85,false,true,metadata),vertices=probes(actor.body),names=g.animations.filter(c=>/^(run|walk)-/.test(c.name)).map(c=>c.name),upper=['Hips','Spine2','LeftHand','RightHand'].map(n=>actor.body.getObjectByName('mixamorig'+n));
 if(mode==='baseline')actor.locomotionFootBlend=null;
 const rows=[],hash=createHash('sha256'),nativeHash=createHash('sha256');let maximumFallbackLift=0;let minimum=Infinity,maxStep=0,worst=null,totalApplied=0,totalFrames=0;
 for(const from of names)for(const to of names){if(from===to)continue;let pairMin=Infinity,pairStep=0,pairWorst=null;
  for(const phase of [0,.125,.25,.375]){
   actor.reset({x:0,z:0,yaw:0});actor.visualRoot.position.set(0,0,0);actor.moveDirection=from.replace(/^(run|walk)-/,'');actor.moving=true;
   actor.animation.update(0,from,{speed:metadata.clips[from].sourceSpeed});actor.animation.layers.get(from).time=metadata.clips[from].duration*phase;actor.animation.update(0,from,{speed:metadata.clips[from].sourceSpeed});actor.root.updateMatrixWorld(true);actor.footPlant.correct();
   let previous=['Left','Right'].map(s=>flex(actor.body,s));const delta=direction(to).multiplyScalar(metadata.clips[to].sourceSpeed/60),motion={x:0,z:0,yaw:0};
   for(let frame=0;frame<20;frame++){
    motion.x+=delta.x;motion.z+=delta.z;actor.update(1/60,frame/60,{health:100,blocking:to.startsWith('walk-'),action:null},motion);
    if(actor.animation.current!==to)throw Error(`Direction mismatch ${actor.animation.current}/${to}`);
    const min=fullMinimum(vertices),angles=['Left','Right'].map(s=>flex(actor.body,s)),step=Math.max(...angles.map((v,i)=>Math.abs(v-previous[i])));previous=angles;
    pairMin=Math.min(pairMin,min);if(step>pairStep){pairStep=step;pairWorst={phase,frame};}
    if(step>maxStep){maxStep=step;worst={from,to,phase,frame};}minimum=Math.min(minimum,min);totalApplied+=Number(!!actor.locomotionFootBlend?.applied);totalFrames++;
    maximumFallbackLift=Math.max(maximumFallbackLift,actor.visualRoot.position.y);
    for(const bone of upper){hash.update(Buffer.from(new Float64Array(bone.matrixWorld.elements).buffer));nativeHash.update(Buffer.from(new Float64Array(bone.matrix.elements).buffer));}
   }
  }rows.push({from,to,minimumActualSoleMeters:pairMin,maxAnatomicalFlexStepDegrees:pairStep,worst:pairWorst});
 }
 result.variants[mode]={rows,minimumActualSoleMeters:minimum,maxAnatomicalFlexStepDegrees:maxStep,worst,actualFootVertexCount:vertices.length,totalFrames,totalApplied,maximumFallbackLiftMeters:maximumFallbackLift,upperBodyWorldMatrixHash:hash.digest('hex'),upperBodyNativeMatrixHash:nativeHash.digest('hex')};console.log(mode,{minimum,maxStep,worst,totalFrames});
}
const a=result.variants.baseline,b=result.variants.integrated;
result.upperBodyWorldExactlyPreserved=a.upperBodyWorldMatrixHash===b.upperBodyWorldMatrixHash;
result.upperBodyNativePoseExactlyPreserved=a.upperBodyNativeMatrixHash===b.upperBodyNativeMatrixHash;
result.worsenedPairs=b.rows.flatMap((r,i)=>r.maxAnatomicalFlexStepDegrees>a.rows[i].maxAnatomicalFlexStepDegrees+.5?[{...r,baselineDegrees:a.rows[i].maxAnatomicalFlexStepDegrees,increaseDegrees:r.maxAnatomicalFlexStepDegrees-a.rows[i].maxAnatomicalFlexStepDegrees}]:[]);
fs.writeFileSync('docs/player-integrated-foot-blend-audit.json',JSON.stringify(result,null,2));
if(!result.upperBodyNativePoseExactlyPreserved||a.maximumFallbackLiftMeters>.000101||b.maximumFallbackLiftMeters>.000101||b.minimumActualSoleMeters<-.001)throw Error('Integrated preservation/contact check failed');
