import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import * as T from 'three';
import {loadGLB} from './load-glb-node.mjs';
import {createActor} from '../src/game/actors.js';
import {ASSETS} from '../src/game/asset-paths.js';

const report={createdAt:new Date().toISOString(),actors:{}};
for(const kind of ['boss','player']){
  const path=fileURLToPath(ASSETS[kind+'Rig']),gltf=await loadGLB(path),metadata=ASSETS.motion[kind];
  const actor=createActor(gltf,kind==='boss'?2.5:1.85,kind==='boss',true,metadata),origin={x:0,z:0,yaw:0};
  const vertices=[];
  gltf.scene.traverse(mesh=>{
    if(!mesh.isSkinnedMesh)return;
    const {position,skinIndex,skinWeight}=mesh.geometry.attributes;
    for(let index=0;index<position.count;index++){
      let weight=0;
      for(let component=0;component<4;component++){
        if(/(?:Foot|ToeBase)$/.test(mesh.skeleton.bones[skinIndex.getComponent(index,component)].name))weight+=skinWeight.getComponent(index,component);
      }
      if(weight>=.5)vertices.push({mesh,index});
    }
  });
  const gait=kind==='boss'?'walk-forward':'run-forward';
  const duration=name=>metadata.clips[name]?.duration??gltf.animations.find(clip=>clip.name===name)?.duration;
  const actions=kind==='boss'?['sweep','slam','hit','awaken','death']:['light','heavy','block','hit','dodge','heal','death'];
  const sequence=[['idle',.5],[gait,3],['idle',.5],
    ...actions.flatMap(name=>[[name,duration(name)],['idle',.7,{reset:name==='death'}]])];
  if(sequence.some(([,seconds])=>!Number.isFinite(seconds)||seconds<=0))throw new Error(`Missing clip duration for ${kind}`);
  let clock=0,previousLift=0,rawFootMinimum=0;const point=new T.Vector3(),rows=[];actor.reset(origin);
  const minimum=()=>{
    let height=Infinity;
    for(const {mesh,index} of vertices)height=Math.min(height,mesh.getVertexPosition(index,point).applyMatrix4(mesh.matrixWorld).y);
    return height;
  };
  // Capture the uncorrected blended skin in this audit, before the normal runtime IK.
  if(actor.footPlant){const correct=actor.footPlant.correct.bind(actor.footPlant);actor.footPlant.correct=()=>{rawFootMinimum=minimum();correct();};}
  for(const [name,duration,options={}] of sequence){
    // Death is terminal in gameplay. Retry resets the actor; it never blends
    // the collapsed body back into the living idle pose.
    if(options.reset){actor.reset(origin);previousLift=0;rawFootMinimum=0;}
    const action=['idle',gait].includes(name)?null:{name,elapsed:0};
    const row={name,duration,resetBefore:!!options.reset,rawMinimum:Infinity,correctedMinimum:Infinity,maxLift:0,maxLegCorrection:0,maxLiftStep:0,highestBothFeet:0,airborneFrames:0,airborneLift:0,settledIdleLift:0};
    for(let time=0;time<duration;time+=1/60){
      clock+=1/60;if(name===gait)origin.z+=metadata.locomotionSpeed/60;if(action)action.elapsed=time;
      actor.update(1/60,clock,{health:100,action},origin);
      const floor=minimum(),lift=actor.visualRoot.position.y*actor.worldScale,legCorrection=actor.footPlant?.maxCorrection??0,raw=actor.footPlant?rawFootMinimum:floor-lift;
      row.rawMinimum=Math.min(row.rawMinimum,raw);row.correctedMinimum=Math.min(row.correctedMinimum,floor);
      row.maxLift=Math.max(row.maxLift,lift);row.maxLiftStep=Math.max(row.maxLiftStep,Math.abs(lift-previousLift));
      row.maxLegCorrection=Math.max(row.maxLegCorrection,legCorrection);
      row.highestBothFeet=Math.max(row.highestBothFeet,raw);previousLift=lift;
      if(raw>.02){row.airborneFrames++;row.airborneLift=Math.max(row.airborneLift,lift+legCorrection);}
      if(name==='idle'&&!actor.animation.transition)row.settledIdleLift=Math.max(row.settledIdleLift,lift+legCorrection);
    }
    rows.push(row);
  }
  report.actors[kind]={path,sha256:createHash('sha256').update(await fs.readFile(path)).digest('hex'),worldScale:actor.worldScale,units:'world metres',probeCount:actor.soleClearance.probes.length,verifiedFootVertices:vertices.length,rows};
}
const rows=Object.values(report.actors).flatMap(actor=>actor.rows);
report.passed=Object.values(report.actors).every(actor=>actor.rows.every(row=>row.correctedMinimum>-.003&&row.maxLift<=.06*actor.worldScale&&row.airborneLift===0&&row.settledIdleLift<.001))
  // A run needs a flight phase unless the manifest declares it a grounded walk-jog (gait:'walk'), as the user's chosen reference B is.
  &&report.actors.player.rows.filter(row=>['run-forward','dodge'].includes(row.name)&&!(row.name==='run-forward'&&ASSETS.motion.player.clips['run-forward']?.gait==='walk')).every(row=>row.airborneFrames>0);
await fs.writeFile('docs/runtime-sole-clearance-audit.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
if(!report.passed)process.exitCode=1;
