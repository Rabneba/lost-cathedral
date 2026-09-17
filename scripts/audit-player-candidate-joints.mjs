import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as T from 'three';
import {loadGLB} from './load-glb-node.mjs';
import {createActor} from '../src/game/actors.js';
const path=process.env.VESPER_PLAYER_CANDIDATE||'assets/player-combat-revision/player-video-candidate-v2.glb';
const metadata=JSON.parse(await fs.readFile(process.env.VESPER_PLAYER_METADATA||'docs/player-combat-revision/player-video-candidate-v2-manifest.json'));
const hash=async()=>createHash('sha256').update(await fs.readFile(path)).digest('hex'),sha256=await hash();
const gltf=await loadGLB(path),actor=createActor(gltf,1.85,false,true,metadata);
const joints=['mixamorigRightArm','mixamorigRightForeArm','mixamorigRightHand','mixamorigLeftArm','mixamorigLeftForeArm','mixamorigLeftHand','WeaponSocket','ShieldSocket'];
const nodes=joints.map(name=>{const node=actor.body.getObjectByName(name);if(!node)throw new Error('Missing '+name);return node;});
const rows=[],origin={x:0,z:0,yaw:0};
for(const clip of gltf.animations){
 const row={clip:clip.name,duration:clip.duration,joints:Object.fromEntries(joints.map(name=>[name,{maxLocalDegreesPer60Frame:0,maxWorldDegreesPer60Frame:0,maxWorldStepMeters:0,localAt:null,worldAt:null,stepAt:null}]))};
 actor.reset(origin);let previous=null;
 for(let frame=0;frame<=Math.ceil(clip.duration*60);frame++){
  const time=Math.min(frame/60,clip.duration);actor.update(0,time,{health:100,action:{name:clip.name,elapsed:time,directClipTime:true}},origin);
  const current=nodes.map(node=>({local:node.quaternion.clone(),world:node.getWorldQuaternion(new T.Quaternion()),position:node.getWorldPosition(new T.Vector3())}));
  if(previous)for(let j=0;j<joints.length;j++){
   const value=row.joints[joints[j]],a=previous[j],b=current[j];
   const local=a.local.angleTo(b.local)*180/Math.PI,world=a.world.angleTo(b.world)*180/Math.PI,step=a.position.distanceTo(b.position);
   if(local>value.maxLocalDegreesPer60Frame){value.maxLocalDegreesPer60Frame=local;value.localAt=time;}
   if(world>value.maxWorldDegreesPer60Frame){value.maxWorldDegreesPer60Frame=world;value.worldAt=time;}
   if(step>value.maxWorldStepMeters){value.maxWorldStepMeters=step;value.stepAt=time;}
  }
  previous=current;
 }
 rows.push(row);
}
const report={createdAt:new Date().toISOString(),asset:path,sha256,snapshotStillCurrent:sha256===await hash(),method:'Actual createActor direct-clip evaluation at60Hz, quaternion geodesic angle (q and -q equivalent). Continuous pure clips, no pose-transition blending. This measures temporal jumps; it does not establish realistic joint limits or armor clearance.',rows};
report.suspiciousJumps=rows.flatMap(row=>Object.entries(row.joints).filter(([,v])=>v.maxLocalDegreesPer60Frame>35||v.maxWorldDegreesPer60Frame>35||v.maxWorldStepMeters>.35).map(([joint,v])=>({clip:row.clip,joint,...v})));
await fs.writeFile(process.env.VESPER_JOINT_REPORT||'docs/player-combat-revision/runtime-joint-v2-diagnostic.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({sha256:report.sha256,snapshotStillCurrent:report.snapshotStillCurrent,suspiciousJumps:report.suspiciousJumps,actions:rows.filter(r=>['light','heavy'].includes(r.clip))},null,2));
