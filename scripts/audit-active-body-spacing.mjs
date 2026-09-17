import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createActor} from '../src/game/actors.js';
import {ASSETS} from '../src/game/asset-paths.js';

const paths={player:'assets/player-combat-revision/player-video-candidate.glb',boss:'assets/combat-revision/boss/boss-combat-candidate.glb'};
const metadata={player:JSON.parse(await fs.readFile('docs/player-combat-revision/player-video-candidate-manifest.json')),boss:ASSETS.motion.boss};
const snapshots=Object.fromEntries(await Promise.all(Object.entries(paths).map(async([kind,path])=>[kind,await fs.readFile(path)])));
async function loadSnapshot(bytes){
 const n=bytes.readUInt32LE(12),json=JSON.parse(bytes.subarray(20,20+n));
 json.buffers[0].uri='data:application/octet-stream;base64,'+bytes.subarray(28+n).toString('base64');
 for(const mesh of json.meshes||[])for(const primitive of mesh.primitives)delete primitive.material;
 for(const key of ['images','textures','samplers','materials'])delete json[key];
 globalThis.ProgressEvent??=class{constructor(t,info){Object.assign(this,info);}};
 return new GLTFLoader().parseAsync(JSON.stringify(json),'');
}
const binSize=Number(process.env.VESPER_BODY_BIN_SIZE)||.05,dilation=process.env.VESPER_BODY_BIN_DILATION==='0'?0:1,point=new T.Vector3(),poses={};
for(const kind of ['player','boss']){
 const gltf=await loadSnapshot(snapshots[kind]),actor=createActor(gltf,kind==='boss'?2.5:1.85,kind==='boss',true,metadata[kind]);
 const vertices=[];
 actor.body.traverse(mesh=>{if(!mesh.isSkinnedMesh)return;const {position,skinIndex,skinWeight}=mesh.geometry.attributes;
  for(let index=0;index<position.count;index++){
   let coreWeight=0,torsoWeight=0;
   for(let c=0;c<4;c++){
    const name=mesh.skeleton.bones[skinIndex.getComponent(index,c)].name,w=skinWeight.getComponent(index,c);
    if(/(?:Hips|Spine\d*|Neck|Head|UpLeg|Leg)$/.test(name))coreWeight+=w;
    if(/(?:Hips|Spine\d*|Neck|Head)$/.test(name))torsoWeight+=w;
   }
   if(coreWeight>=.5)vertices.push({mesh,index,torso:torsoWeight>=.5});
  }
 });
 const origin={x:0,z:0,yaw:kind==='boss'?Math.PI:0};poses[kind]=[];
 for(const name of kind==='boss'?['idle','walk','sweep','slam']:['idle','block','light','heavy']){
  const clip=gltf.animations.find(c=>c.name===name);if(!clip)continue;
  const sampleCount=name==='idle'||name==='block'?8:Math.ceil(clip.duration*10);
  for(let sample=0;sample<=sampleCount;sample++){
   const time=clip.duration*sample/sampleCount;actor.reset(origin);actor.update(0,time,{health:100,action:{name,elapsed:time,directClipTime:true}},origin);
   const bins=new Map(),torsoBins=new Map();let maxRadius=0,torsoRadius=0;
   for(const v of vertices){
    v.mesh.getVertexPosition(v.index,point).applyMatrix4(v.mesh.matrixWorld);
    maxRadius=Math.max(maxRadius,Math.hypot(point.x,point.z));if(v.torso)torsoRadius=Math.max(torsoRadius,Math.hypot(point.x,point.z));
    const x=Math.floor(point.x/binSize),y=Math.floor(point.y/binSize);
    // Dilate in X/Y by one bin so near-boundary vertices cannot hide contact.
    for(let dx=-dilation;dx<=dilation;dx++)for(let dy=-dilation;dy<=dilation;dy++){
     const key=(x+dx)+','+(y+dy),pick=kind==='player'?Math.max:Math.min,empty=kind==='player'?-Infinity:Infinity;
     bins.set(key,pick(bins.get(key)??empty,point.z));
     if(v.torso)torsoBins.set(key,pick(torsoBins.get(key)??empty,point.z));
    }
   }
   poses[kind].push({name,time,bins,torsoBins,maxRadius,torsoRadius});
  }
 }
 console.log(kind,poses[kind].length,'poses',vertices.length,'weighted core vertices');
}
function separation(player,boss,key,bossKey=key){let required=-Infinity,at=null;for(const [cell,front]of player[key]){const rear=boss[bossKey].get(cell);if(rear!==undefined&&front-rear>required){required=front-rear;at={cell,playerForwardZ:front,bossRearZ:rear};}}return {required,at};}
const pairings={};let worstCore={required:-Infinity},worstTorso={required:-Infinity},worstTorsoAgainstLegs={required:-Infinity};
for(const player of poses.player)for(const boss of poses.boss){
 const key=player.name+' / '+boss.name,result={player:{name:player.name,time:player.time},boss:{name:boss.name,time:boss.time}},core={...result,...separation(player,boss,'bins')},torso={...result,...separation(player,boss,'torsoBins')};
 const group=pairings[key]??={core:{required:-Infinity},torso:{required:-Infinity}};
 if(core.required>group.core.required)group.core=core;if(torso.required>group.torso.required)group.torso=torso;
 for(const [playerKey,bossKey]of [['torsoBins','bins'],['bins','torsoBins']]){const mixed={...result,...separation(player,boss,playerKey,bossKey),playerRegion:playerKey,bossRegion:bossKey};if(mixed.required>worstTorsoAgainstLegs.required)worstTorsoAgainstLegs=mixed;}
 if(core.required>worstCore.required)worstCore=core;if(torso.required>worstTorso.required)worstTorso=torso;
}
const proposedSeparation=1.4,report={createdAt:new Date().toISOString(),paths,hashes:Object.fromEntries(Object.entries(snapshots).map(([kind,bytes])=>[kind,createHash('sha256').update(bytes).digest('hex')])),proposedSeparation,worldScale:{player:1,boss:1.3},sampleCount:Object.fromEntries(Object.entries(poses).map(([kind,p])=>[kind,p.length])),posePairCount:poses.player.length*poses.boss.length,method:{sampleHz:10,idleSamples:9,binSize,xYDilation:binSize*dilation,coreWeightThreshold:.5,coreBones:'Hips, Spine*, Neck, Head, UpLeg, Leg',torsoBones:'Hips, Spine*, Neck, Head',limitation:'Actual weighted skin vertex forward envelopes, not triangle intersections. Excludes weapons, arms, hands and feet from solid core. Facing actors sampled at all Cartesian pose pairings; no animation quality approval.'},maximumPoseRadii:Object.fromEntries(Object.entries(poses).map(([kind,p])=>[kind,{core:Math.max(...p.map(s=>s.maxRadius)),torso:Math.max(...p.map(s=>s.torsoRadius))}])),worstCore,worstTorso,worstTorsoAgainstLegs,coreClearance:proposedSeparation-worstCore.required,torsoClearance:proposedSeparation-worstTorso.required,torsoAgainstLegClearance:proposedSeparation-worstTorsoAgainstLegs.required,pairings};
await fs.writeFile(process.env.VESPER_BODY_SPACING_REPORT||'docs/player-combat-revision/active-body-spacing-diagnostic.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({hashes:report.hashes,worstCore,worstTorso,worstTorsoAgainstLegs,coreClearance:report.coreClearance,torsoClearance:report.torsoClearance},null,2));
