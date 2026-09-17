import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as T from 'three';
import {loadGLB} from '../scripts/load-glb-node.mjs';
import {ASSETS} from '../src/game/asset-paths.js';
import {createActor,weaponSegmentFor} from '../src/game/actors.js';
import {strikeIndex,sweptWeaponContact} from '../src/game/weapon-motion.js';
import {actorCapsule,actorDimensions} from '../src/game/actor-scale.js';

// Use the same selection and timing data as the game, rather than the archived
// first combat bundle. These are integration safeguards, not visual approval.
for(const kind of ['player','boss'])test(`current ${kind}: selected rig contains every configured clip and matching duration`,async()=>{
 const gltf=await loadGLB(fileURLToPath(ASSETS[kind+'Rig']));
 const metadata=ASSETS.motion[kind];
 assert.ok(fileURLToPath(ASSETS[kind+'Rig']).endsWith(metadata.asset));
 assert.equal(new Set(gltf.animations.map(clip=>clip.name)).size,gltf.animations.length);
 for(const [name,spec] of Object.entries(metadata.clips)){
  const clip=gltf.animations.find(candidate=>candidate.name===name);
  assert.ok(clip,`${kind} is missing ${name}`);
  assert.ok(Math.abs(clip.duration-spec.duration)<1e-5,`${kind}/${name} timing differs from the loaded asset`);
  for(const [start,end] of spec.hitWindows||[])
   assert.ok(start>=0&&end>start&&end<=clip.duration,`${kind}/${name} has an invalid damage window`);
 }
 assert.ok(gltf.scene.getObjectByName('WeaponSocket'));
});

test('current boss preserves the approved quarter-paced idle throughout its full clip',async()=>{
 const [current,approved]=await Promise.all([
  loadGLB(fileURLToPath(ASSETS.bossRig)),loadGLB('assets/approved/boss-idle.glb'),
 ]);
 const pairs=[current,approved].map(gltf=>{
  const clip=gltf.animations.find(clip=>clip.name==='idle'),mixer=new T.AnimationMixer(gltf.scene);
  const action=mixer.clipAction(clip).setLoop(T.LoopOnce,1).play();action.clampWhenFinished=true;
  return {gltf,clip,mixer,action};
 });
 assert.ok(pairs[0].clip.duration>26&&pairs[0].clip.duration<27);
 assert.ok(Math.abs(pairs[0].clip.duration-pairs[1].clip.duration)<1e-5);
 assert.equal(ASSETS.motion.boss.clips.idle.rate,1,'quarter pace is already baked; do not slow it again');
 for(let sample=0;sample<=24;sample++){
  const time=pairs[0].clip.duration*sample/24;
  for(const item of pairs){item.action.time=time;item.mixer.update(0);item.gltf.scene.updateMatrixWorld(true);}
  for(const joint of ['Hips','Spine2','Head','LeftFoot','RightFoot','LeftHand','RightHand']){
   const points=pairs.map(item=>item.gltf.scene.getObjectByName('mixamorig'+joint).getWorldPosition(new T.Vector3()));
   assert.ok(points[0].distanceTo(points[1])<.00005,`approved idle changed at ${time}s / ${joint}`);
  }
 }
});

function palm(root,side){
 const center=new T.Vector3();
 for(const finger of ['Index','Middle','Ring','Pinky'])for(const joint of [1,3])
  center.addScaledVector(root.getObjectByName(`mixamorig${side}Hand${finger}${joint}`).getWorldPosition(new T.Vector3()),.1);
 return center.addScaledVector(root.getObjectByName(`mixamorig${side}HandThumb3`).getWorldPosition(new T.Vector3()),.2);
}

async function measuredShaft(){
 const [context,cloud,weapon]=await Promise.all([
  fs.readFile('assets/combat-revision/boss/trajectory-context/context.json','utf8').then(JSON.parse),
  fs.readFile('docs/combat-revision/scythe-socket-vertex-cloud.json','utf8').then(JSON.parse),
  fs.readFile(fileURLToPath(ASSETS.scythe)),
 ]);
 assert.equal(createHash('sha256').update(weapon).digest('hex'),cloud.weaponSha256,'shaft calibration must match the actual selected scythe');
 const points=Array.from({length:cloud.xyz.length/3},(_,index)=>cloud.xyz.slice(index*3,index*3+3));
 const median=values=>{values.sort((a,b)=>a-b);const mid=Math.floor(values.length/2);return values.length%2?values[mid]:(values[mid-1]+values[mid])/2;};
 // Reconstruct the authoring calibration from the hash-qualified actual
 // normalized mesh. Its finite, offset centerline is not the socket's Z axis.
 for(const [center,radius] of context.shaftSections){
  const section=points.filter(p=>Math.abs(p[2]-center[2])<.03&&Math.hypot(p[0],p[1])<.18);
  assert.ok(section.length>=3,'each calibrated section needs real mesh vertices');
  const x=median(section.map(p=>p[0])),y=median(section.map(p=>p[1]));
  assert.ok(Math.hypot(x-center[0],y-center[1])<.00005,'shaft centerline differs from the fitted mesh');
  assert.ok(Math.abs(Math.max(...section.map(p=>Math.hypot(p[0]-x,p[1]-y)))-radius)<.00005,'shaft radius differs from the fitted mesh');
 }
 const centers=context.shaftSections.map(([center])=>new T.Vector3(...center));
 return centers.slice(1).map((center,index)=>new T.Line3(centers[index],center));
}

for(const kind of ['player','boss'])test(`current ${kind}: animated blade reaches a close target inside damage windows and misses at 4m`,async()=>{
 const isBoss=kind==='boss',gltf=await loadGLB(fileURLToPath(ASSETS[kind+'Rig']));
 const actor=createActor(gltf,isBoss?2.5:1.85,isBoss,true,ASSETS.motion[kind]);
 const socket=actor.body.getObjectByName('WeaponSocket');
 actor.weapon=new T.Group();actor.weapon.rotation.x=Math.PI/2;socket.add(actor.weapon);
 actor.weaponSegment=weaponSegmentFor(isBoss,ASSETS);
 const targetDimensions=actorDimensions(!isBoss,ASSETS.motion[isBoss?'player':'boss']);
 const origin={x:0,z:0,yaw:0},shaft=isBoss?await measuredShaft():null,closest=new T.Vector3();
 const capsule=distance=>actorCapsule({x:0,z:distance},targetDimensions);
 for(const name of isBoss?['sweep','slam']:['light','heavy']){
  actor.reset(origin);
  const action={name,elapsed:0},state={health:100,blocking:false,action};
  const spec=ASSETS.motion[kind].clips[name],range=spec.engagementRange;
  if(isBoss)assert.ok(range&&range[0]<=spec.preferredDistance&&spec.preferredDistance<=range[1],`${name}: a valid individual engagement band is required`);
  const nearDistances=isBoss?[...new Set([range[0],spec.preferredDistance,range[1]])]:[actor.dimensions.bodyRadius+targetDimensions.bodyRadius+.05];
  const torsoPositions=[],weaponEnds=[],nearHits=nearDistances.map(()=>0),release={preparation:0,recovery:0};let farHits=0,maxGripOffset=0,maxPrimaryOffset=0;
  const duration=spec.duration;
  for(let frame=0;frame<=Math.ceil(duration*120);frame++){
   action.elapsed=Math.min(duration,frame/120);
   actor.update(1/120,action.elapsed,state,origin);
   const active=strikeIndex(name,action.elapsed,isBoss,actor.timings)>=0;
   if(active){
    nearDistances.forEach((near,index)=>{nearHits[index]+=Number(sweptWeaponContact(actor.previousSegment,actor.segment,capsule(near),targetDimensions.hurtRadius));});
    farHits+=Number(sweptWeaponContact(actor.previousSegment,actor.segment,capsule(4),targetDimensions.hurtRadius));
   }
   torsoPositions.push(actor.body.getObjectByName('mixamorigSpine2').getWorldPosition(new T.Vector3()));
   weaponEnds.push(new T.Vector3(...actor.segment[1]));
   if(isBoss){
    for(const side of ['Left','Right']){
     const local=socket.worldToLocal(palm(actor.body,side));
     const gap=Math.min(...shaft.map(segment=>segment.closestPointToPoint(local,true,closest).distanceTo(local)));
     if(active)maxGripOffset=Math.max(maxGripOffset,gap);
     if(side==='Right')maxPrimaryOffset=Math.max(maxPrimaryOffset,gap);
     if(side==='Left'&&!active&&gap>.05){
      if(action.elapsed<spec.windup)release.preparation++;
      else if(action.elapsed>spec.windup+spec.active)release.recovery++;
     }
     if(frame===Math.ceil(duration*120))assert.ok(gap<.025,`${name}: ${side} must regrasp at the idle endpoint`);
    }
   }
  }
  nearDistances.forEach((near,index)=>assert.ok(nearHits[index]>=2,`${name}: the visible blade must reach its own band target ${near}m within its configured damage window (got ${nearHits[index]} samples)`));
  assert.equal(farHits,0,`${name}: no invisible range extension to 4m`);
  assert.ok(new T.Box3().setFromPoints(torsoPositions).getSize(new T.Vector3()).length()>.08,`${name}: torso motion cannot be frozen`);
  assert.ok(new T.Box3().setFromPoints(weaponEnds).getSize(new T.Vector3()).length()>1,`${name}: weapon arc cannot be static`);
  if(isBoss){
   assert.ok(maxGripOffset<.025,`${name}: active palm moved ${(maxGripOffset*100).toFixed(2)}cm away from the measured shaft`);
   assert.ok(maxPrimaryOffset<.025,`${name}: primary palm moved ${(maxPrimaryOffset*100).toFixed(2)}cm away from the measured shaft`);
   assert.ok(release.preparation>=3&&release.recovery>=3,`${name}: deliberate secondary-hand preparation/recovery releases must remain outside the active held phase`);
  }
 }
});
