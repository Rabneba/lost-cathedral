import fs from'node:fs/promises';import{createHash}from'node:crypto';import * as T from'three';
import{loadGLB}from'./load-glb-node.mjs';import{createActor}from'../src/game/actors.js';
const path=process.env.VESPER_PLAYER_CANDIDATE||'assets/player-combat-revision/player-video-candidate-v5.glb',metadata=JSON.parse(await fs.readFile(process.env.VESPER_PLAYER_METADATA||'docs/player-combat-revision/player-video-candidate-v5-manifest.json'));
const hash=async()=>createHash('sha256').update(await fs.readFile(path)).digest('hex'),sha256=await hash(),gltf=await loadGLB(path),actor=createActor(gltf,1.85,false,true,metadata),meshes=[],feet=[];
actor.body.traverse(mesh=>{if(!mesh.isSkinnedMesh)return;meshes.push(mesh);const {position,skinWeight,skinIndex}=mesh.geometry.attributes;for(let index=0;index<position.count;index++){let weight=0;for(let c=0;c<4;c++)if(/(?:Foot|ToeBase)$/.test(mesh.skeleton.bones[skinIndex.getComponent(index,c)].name))weight+=skinWeight.getComponent(index,c);if(weight>=.5)feet.push({mesh,index});}});
const directionNames=['forward','forward-left','left','back-left','backward','back-right','right','forward-right'],point=new T.Vector3(),rows=[];
for(let directionIndex=0;directionIndex<8;directionIndex++){
 const name='walk-'+directionNames[directionIndex],angle=directionIndex*Math.PI/4,origin={x:0,z:0,yaw:0},state={health:100,blocking:true,action:null};actor.reset(origin);let clock=0;
 const row={gait:name,minimumBody:Infinity,minimumFoot:Infinity,maxLegCorrection:0,worstBody:null,worstFoot:null};
 for(const [phase,duration]of [['block',.4],['walk',.8],['block',.4]])for(let frame=0;frame<Math.ceil(duration*60);frame++){
  const dt=1/60;clock+=dt;if(phase==='walk'){origin.x+=Math.sin(angle)*metadata.guardSpeed*dt;origin.z+=Math.cos(angle)*metadata.guardSpeed*dt;}
  actor.update(dt,clock,state,origin);let body=Infinity,foot=Infinity;
  for(const mesh of meshes)for(let index=0;index<mesh.geometry.attributes.position.count;index++)body=Math.min(body,mesh.getVertexPosition(index,point).applyMatrix4(mesh.matrixWorld).y);
  for(const p of feet)foot=Math.min(foot,p.mesh.getVertexPosition(p.index,point).applyMatrix4(p.mesh.matrixWorld).y);
  if(body<row.minimumBody){row.minimumBody=body;row.worstBody={phase,time:clock};}if(foot<row.minimumFoot){row.minimumFoot=foot;row.worstFoot={phase,time:clock};}
  row.maxLegCorrection=Math.max(row.maxLegCorrection,actor.footPlant.maxCorrection);
 }
 rows.push(row);
}
const report={createdAt:new Date().toISOString(),asset:path,sha256,snapshotStillCurrent:sha256===await hash(),scope:'Actual createActor guarded movement: new block to all8 existing walk directions and back, full weighted body and foot surface at60Hz. Shield stays raised (blocking true throughout); no asset edits.',rows,passed:rows.every(r=>r.minimumBody>-.003&&r.minimumFoot>-.003)};
await fs.writeFile(process.env.VESPER_GUARD_REPORT||'docs/player-combat-revision/guard-walk-transitions-v5.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
