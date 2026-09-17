import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createActor,weaponSegmentFor} from '../src/game/actors.js';
import {MotionState} from '../src/game/motion.js';
import {ASSETS} from '../src/game/asset-paths.js';
import {actorDimensions,actorCapsule} from '../src/game/actor-scale.js';
import {actionTravelAt} from '../src/game/action-travel.js';
import {strikeIndex,sweptWeaponContact} from '../src/game/weapon-motion.js';

const candidatePath=process.env.VESPER_PLAYER_CANDIDATE||'assets/player-combat-revision/player-video-candidate.glb',metadataPath=process.env.VESPER_PLAYER_METADATA||'docs/player-combat-revision/player-video-candidate-manifest.json';
const [bytes,manifestBytes,baselineBytes]=await Promise.all([fs.readFile(candidatePath),fs.readFile(metadataPath),fs.readFile(fileURLToPath(ASSETS.playerRig))]);
const hash=b=>createHash('sha256').update(b).digest('hex'),metadata=JSON.parse(manifestBytes),report={createdAt:new Date().toISOString(),scope:'Diagnostic only, no production promotion; actual createActor and MotionState with candidate file snapshots held in memory.',asset:candidatePath,sha256:hash(bytes),metadataSha256:hash(manifestBytes),baselineSha256:hash(baselineBytes),actions:[],transitions:[],gaits:[],timingIssues:[],checks:{}};
if(report.sha256!==metadata.sha256)throw new Error('Candidate manifest hash does not match loaded bytes');
async function parse(buffer){
 const n=buffer.readUInt32LE(12),json=JSON.parse(buffer.subarray(20,20+n));json.buffers[0].uri='data:application/octet-stream;base64,'+buffer.subarray(28+n).toString('base64');
 for(const mesh of json.meshes||[])for(const primitive of mesh.primitives)delete primitive.material;
 for(const key of ['images','textures','samplers','materials'])delete json[key];
 globalThis.ProgressEvent??=class{constructor(type,init){Object.assign(this,init);}};
 return new GLTFLoader().parseAsync(JSON.stringify(json),'');
}
const [gltf,baseline]=await Promise.all([parse(bytes),parse(baselineBytes)]);
const actor=createActor(gltf,1.85,false,true,metadata),base=createActor(baseline,1.85,false,true,ASSETS.motion.player);
for(const a of [actor,base]){
 a.weapon=new T.Group();a.weapon.rotation.x=Math.PI/2;a.body.getObjectByName('WeaponSocket').add(a.weapon);a.weaponSegment=weaponSegmentFor(false,ASSETS);
}
const meshes=[],footVertices=[];let bodyVertexCount=0;
actor.body.traverse(mesh=>{if(!mesh.isSkinnedMesh)return;meshes.push(mesh);const {position,skinWeight,skinIndex}=mesh.geometry.attributes;bodyVertexCount+=position.count;
 for(let index=0;index<position.count;index++){let weight=0;for(let c=0;c<4;c++)if(/(?:Foot|ToeBase)$/.test(mesh.skeleton.bones[skinIndex.getComponent(index,c)].name))weight+=skinWeight.getComponent(index,c);if(weight>=.5)footVertices.push({mesh,index});}
});
report.bodyVertexCount=bodyVertexCount;report.footVertexCount=footVertices.length;
const point=new T.Vector3();
function fullMinimum(){let min=Infinity;for(const mesh of meshes)for(let i=0;i<mesh.geometry.attributes.position.count;i++)min=Math.min(min,mesh.getVertexPosition(i,point).applyMatrix4(mesh.matrixWorld).y);return min;}
function footMinimum(){let min=Infinity;for(const {mesh,index} of footVertices)min=Math.min(min,mesh.getVertexPosition(index,point).applyMatrix4(mesh.matrixWorld).y);return min;}
function palm(root,side){const p=new T.Vector3();for(const finger of ['Index','Middle','Ring','Pinky'])for(const j of [1,3])p.addScaledVector(root.getObjectByName(`mixamorig${side}Hand${finger}${j}`).getWorldPosition(new T.Vector3()),.1);return p.addScaledVector(root.getObjectByName(`mixamorig${side}HandThumb3`).getWorldPosition(new T.Vector3()),.2);}
function grip(a){const socket=a.body.getObjectByName('WeaponSocket'),local=palm(a.body,'Right').applyMatrix4(socket.matrixWorld.clone().invert());return{along:local.z,offset:Math.hypot(local.x,local.y)};}
for(const [name,spec] of Object.entries(metadata.clips)){
 const clip=gltf.animations.find(c=>c.name===name);
 if(!clip||Math.abs(clip.duration-spec.duration)>1e-5)report.timingIssues.push({name,manifest:spec.duration,clip:clip?.duration});
}
let rawProbeMin=0;const correct=actor.footPlant.correct.bind(actor.footPlant);actor.footPlant.correct=()=>{rawProbeMin=actor.soleClearance.minimumHeight();correct();};
const bossDimensions=actorDimensions(true,ASSETS.motion.boss),near=actor.dimensions.bodyRadius+bossDimensions.bodyRadius+.05;
report.targetGeometry={nearDistance:near,marginDistance:near+.15,bossDimensions};
for(const name of ['idle','block','light','heavy','hit','dodge']){
 const spec=metadata.clips[name],duration=spec.duration,step=1/120;
 const motion=new MotionState({animationMetadata:{player:metadata,boss:ASSETS.motion.boss},bounds:{minX:-20,maxX:20,minZ:-20,maxZ:20}});
 motion.player={x:0,z:0,yaw:0};motion.boss={x:0,z:-15,yaw:0};
 const state={status:'fighting',player:{health:100,action:null,blocking:false},boss:{phase:1,action:{name:'awaken',elapsed:0}},timings:{player:actor.timings}};
 actor.reset(motion.player);for(let frame=0;frame<60;frame++)actor.update(step,-(60-frame)*step,state.player,motion.player);
 const action={name,elapsed:0};state.player.action=action;if(name==='dodge')motion.beginDodge({forward:-1});
 const row={name,duration,travelDirection:spec.direction??null,expectedTravel:spec.travelCurve?actionTravelAt(spec,duration):0,actualTravel:0,maxTravelTimingError:0,minBody:Infinity,minFoot:Infinity,minRawProbe:Infinity,maxLegCorrection:0,maxRootLift:0,maxRigidTilt:0,maxGripOffset:0,contacts:[],nearBladeContacts:[],marginBladeContacts:[],farBladeContacts:[],worstBody:null,worstFoot:null};
 for(let frame=0;frame<=Math.ceil((duration+.35)*120);frame++){
  const time=frame/120,playing=time<duration;
  state.player.action=playing?action:null;action.elapsed=time;
  motion.step(step,{forward:0,right:0,lockOn:false},state);actor.update(step,time,state.player,motion.player);
  const sign=spec.direction==='backward'?-1:1,expected=sign*actionTravelAt(spec,Math.min(time,duration));
  if(spec.travelCurve)row.maxTravelTimingError=Math.max(row.maxTravelTimingError,Math.abs(motion.player.z-expected),Math.abs(motion.player.x));
  row.actualTravel=motion.player.z;row.minRawProbe=Math.min(row.minRawProbe,rawProbeMin);row.maxLegCorrection=Math.max(row.maxLegCorrection,actor.footPlant.maxCorrection);row.maxRootLift=Math.max(row.maxRootLift,actor.visualRoot.position.y);
  row.maxRigidTilt=Math.max(row.maxRigidTilt,Math.abs(actor.root.rotation.x),Math.abs(actor.root.rotation.z),Math.abs(actor.visualRoot.rotation.x),Math.abs(actor.visualRoot.rotation.z));
  row.maxGripOffset=Math.max(row.maxGripOffset,grip(actor).offset);
  if(frame%2===0){const body=fullMinimum(),feet=footMinimum();if(body<row.minBody){row.minBody=body;row.worstBody={time,phase:playing?'clip':'exit',minimum:body};}if(feet<row.minFoot){row.minFoot=feet;row.worstFoot={time,phase:playing?'clip':'exit',minimum:feet};}}
  for(const c of actor.footsteps)row.contacts.push({time,kind:c.kind,side:c.side,position:c.position.toArray(),phase:playing?'clip':'exit'});
  if(playing&&actor.timings[name]?.damage&&strikeIndex(name,time,false,actor.timings)>=0){
   if(sweptWeaponContact(actor.previousSegment,actor.segment,actorCapsule({x:0,z:near},bossDimensions),bossDimensions.hurtRadius))row.nearBladeContacts.push(time);
   if(sweptWeaponContact(actor.previousSegment,actor.segment,actorCapsule({x:0,z:near+.15},bossDimensions),bossDimensions.hurtRadius))row.marginBladeContacts.push(time);
   if(sweptWeaponContact(actor.previousSegment,actor.segment,actorCapsule({x:0,z:4},bossDimensions),bossDimensions.hurtRadius))row.farBladeContacts.push(time);
  }
 }
 report.actions.push(row);
}

// The same actual runtime hooks act during direction/start/stop transitions.
for(const gait of ['run-forward','run-left','run-backward','walk-forward','walk-left']){
 const origin={x:0,z:0,yaw:0},state={health:100,action:null,blocking:false};actor.reset(origin);
 let clock=0;const row={name:gait,minFoot:Infinity,minBody:Infinity,maxLegCorrection:0,worst:null,maxGripOffset:0};
 for(const [phase,length] of [['idle',.3],['gait',.7],['idle',.5]])for(let frame=0;frame<Math.ceil(length*60);frame++){
  const dt=1/60;clock+=dt;
  const isWalk=gait.startsWith('walk-');state.blocking=phase==='gait'&&isWalk;
  if(phase==='gait'){
   const speed=isWalk?metadata.guardSpeed:metadata.locomotionSpeed;
   if(gait.endsWith('left'))origin.x+=speed*dt;else origin.z+=(gait.endsWith('backward')?-1:1)*speed*dt;
  }
  actor.update(dt,clock,state,origin);
  const foot=footMinimum(),body=fullMinimum();if(foot<row.minFoot){row.minFoot=foot;row.worst={time:clock,phase};}row.minBody=Math.min(row.minBody,body);row.maxLegCorrection=Math.max(row.maxLegCorrection,actor.footPlant.maxCorrection);row.maxGripOffset=Math.max(row.maxGripOffset,grip(actor).offset);
 }
 report.transitions.push(row);
}

for(const clip of gltf.animations.filter(c=>/^(run|walk)-/.test(c.name))){
 const old=baseline.animations.find(c=>c.name===clip.name),changed=[];
 for(const track of clip.tracks){
  const previous=old.tracks.find(t=>t.name===track.name);if(!previous||track.values.length!==previous.values.length){changed.push({track:track.name,shapeChanged:true});continue;}
  let delta=0;for(let i=0;i<track.values.length;i++)delta=Math.max(delta,Math.abs(track.values[i]-previous.values[i]));
  if(delta>1e-6)changed.push({track:track.name,maxComponentChange:delta});
 }
 const row={name:clip.name,duration:clip.duration,changedTracks:changed,unexpectedBodyChanges:changed.filter(c=>!/(Hand|WeaponSocket|ShieldSocket)/.test(c.track)),maxGripOffset:0,baselineMaxGripOffset:0,maxGripDelta:0};
 const origin={x:0,z:0,yaw:0};
 for(let frame=0;frame<=24;frame++){
  const action={name:clip.name,elapsed:clip.duration*frame/24,directClipTime:true};
  for(const a of [actor,base]){a.reset(origin);a.update(0,action.elapsed,{health:100,action},origin);}
  const g=grip(actor),b=grip(base);row.maxGripOffset=Math.max(row.maxGripOffset,g.offset);row.baselineMaxGripOffset=Math.max(row.baselineMaxGripOffset,b.offset);row.maxGripDelta=Math.max(row.maxGripDelta,Math.abs(g.offset-b.offset));
 }
 report.gaits.push(row);
}
report.checks={fileMatchesManifest:report.sha256===metadata.sha256,timingsMatch:report.timingIssues.length===0,travelMatchesPoseTime:report.actions.every(a=>a.maxTravelTimingError<1e-6),noRigidFlip:report.actions.every(a=>a.maxRigidTilt===0),bodyFloorWithin3mm:report.actions.every(a=>a.minBody>-.003),footFloorWithin3mm:report.actions.every(a=>a.minFoot>-.003)&&report.transitions.every(a=>a.minFoot>-.003),gaitBodyChannelsPreserved:report.gaits.every(g=>g.unexpectedBodyChanges.length===0),lightAndHeavyContact:report.actions.filter(a=>['light','heavy'].includes(a.name)).every(a=>a.nearBladeContacts.length>=2&&a.farBladeContacts.length===0),lightAndHeavyMarginContact:report.actions.filter(a=>['light','heavy'].includes(a.name)).every(a=>a.marginBladeContacts.length>=2)};
report.passed=Object.values(report.checks).every(Boolean);
report.endOfAuditFileSha256=hash(await fs.readFile(candidatePath));report.snapshotStillCurrent=report.endOfAuditFileSha256===report.sha256;
await fs.writeFile(process.env.VESPER_CANDIDATE_RUNTIME_REPORT||'docs/player-combat-revision/runtime-candidate-diagnostic.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({sha256:report.sha256,snapshotStillCurrent:report.snapshotStillCurrent,checks:report.checks,actions:report.actions.map(a=>({name:a.name,travel:a.actualTravel,error:a.maxTravelTimingError,minBody:a.minBody,minFoot:a.minFoot,maxLegCorrection:a.maxLegCorrection,maxRootLift:a.maxRootLift,contacts:a.contacts,nearHits:a.nearBladeContacts.length,marginHits:a.marginBladeContacts.length,farHits:a.farBladeContacts.length,worstBody:a.worstBody})),transitions:report.transitions,gaits:report.gaits.map(g=>({name:g.name,changedTracks:g.changedTracks.length,unexpected:g.unexpectedBodyChanges,maxGripOffset:g.maxGripOffset,baselineMaxGripOffset:g.baselineMaxGripOffset}))},null,2));
if(!report.passed)process.exitCode=1;
