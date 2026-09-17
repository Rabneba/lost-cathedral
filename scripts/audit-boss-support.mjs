import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {Vector3} from 'three';
import {loadGLB} from './load-glb-node.mjs';
import {createActor} from '../src/game/actors.js';
import {ASSETS} from '../src/game/asset-paths.js';

// A toe touching the floor is insufficient: evaluate both ends of each boot.
// Optional arguments permit a held candidate and a known-bad regression control.
const [asset=fileURLToPath(ASSETS.bossRig),timingPath,onlyClip,output='docs/boss-support-audit.json']=process.argv.slice(2);
const timing=timingPath?JSON.parse(await fs.readFile(timingPath)):{};
const metadata={...ASSETS.motion.boss,clips:{...ASSETS.motion.boss.clips,...timing.clips}};
const gltf=await loadGLB(asset),actor=createActor(gltf,2.5,true,true,metadata);
const origin={x:0,z:0,yaw:0},state={health:100,action:null},point=new Vector3(),step=1/120;
actor.reset(origin);actor.update(step,0,state,origin);
const probes={Left:[],Right:[]};
gltf.scene.traverse(mesh=>{
 if(!mesh.isSkinnedMesh)return;
 const {position,skinIndex,skinWeight}=mesh.geometry.attributes;
 for(const side of ['Left','Right']){
  const foot=actor.footBones[side].getWorldPosition(new Vector3());
  const forward=gltf.scene.getObjectByName('mixamorig'+side+'ToeBase').getWorldPosition(new Vector3()).sub(foot);
  forward.y=0;forward.normalize();
  const vertices=[];
  for(let i=0;i<position.count;i++){
   let weight=0;
   for(let j=0;j<4;j++)if(new RegExp(side+'(?:Foot|ToeBase)$').test(mesh.skeleton.bones[skinIndex.getComponent(i,j)].name))weight+=skinWeight.getComponent(i,j);
   if(weight<.5)continue;
   mesh.getVertexPosition(i,point).applyMatrix4(mesh.matrixWorld);
   vertices.push({mesh,index:i,along:point.clone().sub(foot).dot(forward)});
  }
  if(!vertices.length)continue;
  const lo=Math.min(...vertices.map(v=>v.along)),hi=Math.max(...vertices.map(v=>v.along));
  for(const v of vertices){const fraction=(v.along-lo)/(hi-lo);v.band=fraction<.25?'heel':fraction>.75?'toe':'middle';probes[side].push(v);}
 }
});
function measure(){
 const result={};
 for(const side of ['Left','Right']){
  const heights={sole:Infinity,heel:Infinity,toe:Infinity};
  for(const {mesh,index,band} of probes[side]){
   mesh.getVertexPosition(index,point).applyMatrix4(mesh.matrixWorld);
   heights.sole=Math.min(heights.sole,point.y);
   if(band!=='middle')heights[band]=Math.min(heights[band],point.y);
  }
  result[side]=heights;
 }
 return result;
}
const baseline=measure();
if(Object.values(baseline).some(foot=>Object.values(foot).some(v=>!Number.isFinite(v))))throw new Error('Cannot measure both heel and toe regions');
const clips=[];
for(const name of onlyClip?[onlyClip]:['sweep','slam']){
 if(!metadata.clips[name]||!actor.clips.has(name))throw new Error('Missing required boss attack: '+name);
 actor.reset(origin);state.action=null;
 for(let i=0;i<48;i++)actor.update(step,i*step,state,origin);
 const duration=metadata.clips[name].duration,unsupported=[],row={name,duration,minimumSole:Infinity,maximumUnsupportedRun:0,unsupportedFrames:0};
 let run=0;
 for(let frame=0;frame<Math.ceil((duration+.4)/step);frame++){
  const time=frame*step;
  if(frame===0)state.action={name,elapsed:0,hits:[]};
  if(time>=duration)state.action=null;
  if(state.action)state.action.elapsed=time;
  actor.update(step,time,state,origin);
  const feet=measure();
  const supported=Object.entries(feet).some(([side,f])=>f.sole<=.025&&f.heel<=baseline[side].heel+.025&&f.toe<=baseline[side].toe+.05);
  row.minimumSole=Math.min(row.minimumSole,feet.Left.sole,feet.Right.sole);
  if(!supported){run+=step;row.unsupportedFrames++;if(unsupported.length<12)unsupported.push({time,feet});}else run=0;
  row.maximumUnsupportedRun=Math.max(row.maximumUnsupportedRun,run);
 }
 row.examples=unsupported;
 row.passed=row.minimumSole>=-.003&&row.maximumUnsupportedRun<=2*step+1e-6;
 clips.push(row);
}
const report={createdAt:new Date().toISOString(),asset,sha256:createHash('sha256').update(await fs.readFile(asset)).digest('hex'),worldScale:actor.worldScale,sampleHz:120,baseline,weightedVertices:Object.fromEntries(Object.entries(probes).map(([s,p])=>[s,p.length])),clips,passed:clips.every(c=>c.passed),scope:'Grounded boss sweep/slam: actual createActor.update, settled idle → attack → idle. Foremost/rearmost quarters of weighted boot vertices are evaluated, preserving the approved curved armored toe shape. At least one boot must have sole ≤25mm, heel within25mm of idle and toe within50mm of idle. Two interpolation samples of grace. This checks support, not visual quality, skin twist or weapon clearance.'};
await fs.writeFile(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
if(!report.passed)process.exitCode=1;
