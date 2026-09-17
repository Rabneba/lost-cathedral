import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {loadGLB} from './load-glb-node.mjs';
import {createActor} from '../src/game/actors.js';
import {ASSETS} from '../src/game/asset-paths.js';
import {actionTravelAt} from '../src/game/action-travel.js';

const STEP=1/120,report={createdAt:new Date().toISOString(),assets:{},clips:[]};
for(const kind of ['player','boss']){
  const path=fileURLToPath(ASSETS[kind+'Rig']),gltf=await loadGLB(path),metadata=ASSETS.motion[kind];
  const actor=createActor(gltf,kind==='boss'?2.5:1.85,kind==='boss',true,metadata);
  report.assets[kind]={path,sha256:createHash('sha256').update(await fs.readFile(path)).digest('hex'),worldScale:actor.worldScale};
  const names=kind==='player'?['dodge','light','heavy','run-forward','hit','heal','death']:['sweep','slam','walk-forward','awaken','death'];
  for(const name of names){
    if(!actor.clips.has(name))continue;
    const gait=/^(walk|run)-/.test(name),duration=gait?12:metadata.clips[name].duration;
    const origin={x:0,z:0,yaw:0},state={health:100,action:null},contacts=[],maxSole={Left:0,Right:0};
    let airborneStart=null,airborneEnd=null,peakBoth=0,resetAfterDeath=false;
    actor.reset(origin);for(let frame=0;frame<40;frame++)actor.update(STEP,-(40-frame)*STEP,state,origin);
    if(!gait)state.action={name,elapsed:0,hits:[]};
    for(let time=0;time<duration+.4;time+=STEP){
      const playing=time<duration;
      if(!playing&&name==='death'&&!resetAfterDeath){actor.reset(origin);resetAfterDeath=true;}
      if(!playing)state.action=null;
      if(state.action)state.action.elapsed=time;
      if(gait&&playing)origin.z+=metadata.locomotionSpeed*STEP;
      const spec=metadata.clips[name];
      if(name==='dodge'||spec.travelCurve){
        origin.z=(spec.direction==='forward'?1:-1)*actionTravelAt(spec,time);
      }
      actor.update(STEP,time,state,origin);
      const heights=Object.fromEntries(['Left','Right'].map(side=>[side,actor.soleClearance.minimumHeight(side)]));
      for(const side of ['Left','Right'])maxSole[side]=Math.max(maxSole[side],heights[side]);
      const both=Math.min(...Object.values(heights));peakBoth=Math.max(peakBoth,both);
      if(both>.045*actor.worldScale&&airborneStart===null)airborneStart=time;
      if(airborneStart!==null&&airborneEnd===null&&both<=.008*actor.worldScale)airborneEnd=time;
      for(const contact of actor.footsteps)contacts.push({time:+time.toFixed(4),phase:playing?'clip':'exit',side:contact.side,kind:contact.kind,soleHeights:heights,position:contact.position.toArray()});
    }
    report.clips.push({actor:kind,name,duration,resetAfterDeath,maxSole,peakBoth,airborneStart,airborneEnd,contacts});
  }
}
const roll=report.clips.find(clip=>clip.name==='dodge');
report.passed=roll.contacts.length===1&&roll.contacts[0].kind==='landing'&&Math.abs(roll.contacts[0].time-roll.airborneEnd)<STEP*2
  &&report.clips.every(clip=>clip.contacts.every(contact=>contact.phase==='clip'&&Math.min(...Object.values(contact.soleHeights))<=.0081*report.assets[clip.actor].worldScale))
  &&report.clips.filter(clip=>['hit','heal','death','awaken'].includes(clip.name)).every(clip=>clip.contacts.length===0)
  // Planted cuts emit no footstep cue: the V9 light and the V17 heavy (retargeted Sword 4 clip,
  // right sole lifts 6 cm) keep both feet down. Only attacks that actually step, a sole raised
  // above 8 cm, are required to emit one; the boss's sweep and slam always step.
  &&report.clips.filter(clip=>['sweep','slam'].includes(clip.name)||(['light','heavy'].includes(clip.name)&&Math.max(...Object.values(clip.maxSole))>=.08*report.assets[clip.actor].worldScale)).every(clip=>clip.contacts.length>0);
await fs.writeFile('docs/foot-feedback-audit.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
if(!report.passed)process.exitCode=1;
