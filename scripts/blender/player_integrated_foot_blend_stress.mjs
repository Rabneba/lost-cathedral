import fs from 'node:fs';import {createHash} from 'node:crypto';import * as T from 'three';
import {loadGLB} from '../load-glb-node.mjs';import {createActor} from '../../src/game/actors.js';
import metadata from '../../docs/player-essential-manifest.json' with {type:'json'};
const asset='assets/production/player-essential.glb';
function probes(root){const result=[];root.traverse(m=>{if(!m.isSkinnedMesh)return;const {skinIndex,skinWeight}=m.geometry.attributes;for(let i=0;i<skinIndex.count;i++){let w=0;for(let c=0;c<4;c++)if(/(Left|Right)(Foot|ToeBase)$/.test(m.skeleton.bones[skinIndex.getComponent(i,c)].name))w+=skinWeight.getComponent(i,c);if(w>=.5)result.push({m,i});}});return result;}
const point=new T.Vector3();function fullMinimum(vertices){let min=Infinity;for(const {m,i}of vertices)min=Math.min(min,m.getVertexPosition(i,point).applyMatrix4(m.matrixWorld).y);return min;}
function flex(root,side){const a=root.getObjectByName('mixamorig'+side+'UpLeg').getWorldPosition(new T.Vector3()),b=root.getObjectByName('mixamorig'+side+'Leg').getWorldPosition(new T.Vector3()),c=root.getObjectByName('mixamorig'+side+'Foot').getWorldPosition(new T.Vector3());return 180-a.sub(b).angleTo(c.sub(b))*180/Math.PI;}
function direction(name){return new T.Vector3(name.includes('left')?1:name.includes('right')?-1:0,0,name.includes('forward')?1:name.includes('back')?-1:0).normalize();}
const speeds=Object.fromEntries(JSON.parse(fs.readFileSync('docs/player-combat-cadence.json')).rows.map(r=>[r.clip,r.newGameSpeed]));
const names=['run-forward-left','walk-back-left','run-right','walk-forward-right','run-backward','walk-left','run-forward','walk-back-right'];
const result={asset,method:'Actual actor hook, eight interrupted directions every4frames, current game heading speeds and1.45m/s guard pace, translated/rotated actor. Full weighted boot vertices each frame; timings exclude dense validation.',variants:{}};
for(const mode of ['baseline','integrated']){
 const g=await loadGLB(asset),actor=createActor(g,1.85,false,true,metadata),vertices=probes(actor.body);if(mode==='baseline')actor.locomotionFootBlend=null;
 const stats=actor.locomotionFootBlend?.cacheStats;let correctionTimes=[];
 if(actor.locomotionFootBlend){const original=actor.locomotionFootBlend.apply.bind(actor.locomotionFootBlend);actor.locomotionFootBlend.apply=(...args)=>{const t=performance.now();original(...args);correctionTimes.push(performance.now()-t);};}
 const motion={x:12,z:-7,yaw:1.1};actor.reset(motion);let previous=null,maxStep=0,minimum=Infinity,maxLayers=0,applied=0;const costs=[],upper=createHash('sha256');
 for(let frame=0;frame<360;frame++){
  const name=names[Math.floor(frame/4)%names.length],speed=name.startsWith('walk-')?1.45:speeds[name],d=direction(name).multiplyScalar(speed/60).applyAxisAngle(new T.Vector3(0,1,0),motion.yaw);motion.x+=d.x;motion.z+=d.z;
  const start=performance.now();actor.update(1/60,frame/60,{health:100,blocking:name.startsWith('walk-'),action:null},motion);const elapsed=performance.now()-start;if(frame>60)costs.push(elapsed);
  const angles=['Left','Right'].map(s=>flex(actor.body,s));if(previous)maxStep=Math.max(maxStep,...angles.map((v,i)=>Math.abs(v-previous[i])));previous=angles;minimum=Math.min(minimum,fullMinimum(vertices));maxLayers=Math.max(maxLayers,actor.animation.layers.size);applied+=Number(!!actor.locomotionFootBlend?.applied);
  for(const n of ['Hips','Spine2','LeftHand','RightHand'])upper.update(Buffer.from(new Float64Array(actor.body.getObjectByName('mixamorig'+n).matrix.elements).buffer));
 }
 function percentile(values,q){return values.sort((a,b)=>a-b)[Math.floor((values.length-1)*q)]??0;}
 correctionTimes=correctionTimes.slice(60);
 result.variants[mode]={maxAnatomicalFlexStepDegrees:maxStep,minimumActualSoleMeters:minimum,maxLayers,applied,cache:stats,actorUpdateMedianMs:percentile(costs,.5),actorUpdateP95Ms:percentile(costs,.95),correctionMedianMs:percentile(correctionTimes,.5),correctionP95Ms:percentile(correctionTimes,.95),upperNativeHash:upper.digest('hex')};
}
result.nativeUpperBodyExactlyPreserved=result.variants.baseline.upperNativeHash===result.variants.integrated.upperNativeHash;
fs.writeFileSync('docs/player-integrated-foot-blend-stress.json',JSON.stringify(result,null,2));console.log(result);
if(!result.nativeUpperBodyExactlyPreserved||result.variants.integrated.minimumActualSoleMeters<-.001)throw Error('Integrated interruption preservation/contact failed');
