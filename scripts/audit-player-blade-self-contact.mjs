import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import * as T from 'three';
import {loadGLB} from './load-glb-node.mjs';
import {createActor} from '../src/game/actors.js';
import {ASSETS} from '../src/game/asset-paths.js';

const asset=process.env.VESPER_PLAYER_CANDIDATE||'assets/player-combat-revision/player-video-candidate-v2.glb';
const metadataPath=process.env.VESPER_PLAYER_METADATA||'docs/player-combat-revision/player-video-candidate-v2-manifest.json';
const metadata=JSON.parse(await fs.readFile(metadataPath)),hash=async path=>createHash('sha256').update(await fs.readFile(path)).digest('hex'),sha256=await hash(asset);
const [gltf,swordGLB,shieldGLB]=await Promise.all([loadGLB(asset),loadGLB(fileURLToPath(ASSETS.playerSword)),loadGLB(fileURLToPath(ASSETS.playerShield))]);
const actor=createActor(gltf,1.85,false,true,metadata),material=new T.MeshBasicMaterial({side:T.DoubleSide});
function prepare(root,height){const wrapper=new T.Group();wrapper.add(root);root.rotation.y=-Math.PI/2;wrapper.updateMatrixWorld(true);const box=new T.Box3().setFromObject(root),size=box.getSize(new T.Vector3());root.scale.multiplyScalar(height/size.y);root.updateMatrixWorld(true);box.setFromObject(root);const center=box.getCenter(new T.Vector3());root.position.sub(new T.Vector3(center.x,box.min.y,center.z));wrapper.updateMatrixWorld(true);return wrapper;}
swordGLB.scene.rotation.z=Math.PI;actor.weapon=prepare(swordGLB.scene,1.28);actor.body.getObjectByName('WeaponSocket').add(actor.weapon);
actor.shield=prepare(shieldGLB.scene,.73);actor.body.getObjectByName('ShieldSocket').add(actor.shield);actor.shield.rotation.set(Math.PI/2,Math.PI/2,0);
actor.root.updateMatrixWorld(true);const inverse=actor.weapon.matrixWorld.clone().invert(),xs=[],zs=[];
actor.weapon.children[0].traverse(mesh=>{if(!mesh.isMesh)return;const a=mesh.geometry.attributes.position;for(let i=0;i<a.count;i++){const p=new T.Vector3().fromBufferAttribute(a,i).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse);if(p.y>.08&&p.y<.25){xs.push(p.x);zs.push(p.z);}}});
xs.sort((a,b)=>a-b);zs.sort((a,b)=>a-b);if(xs.length){actor.weapon.children[0].position.x-=xs[Math.floor(xs.length/2)];actor.weapon.children[0].position.z-=zs[Math.floor(zs.length/2)];}
actor.weapon.rotation.set(Math.PI/2,0,0);actor.root.updateMatrixWorld(true);

// Use actual visible blade triangle edges, rather than capsule/line surrogates.
// Clip any edge crossing the blade base plane; the handle/hilt below it is excluded.
const bladeBase=.30,edges=new Map(),weaponInverse=actor.weapon.matrixWorld.clone().invert();
function roundedKey(p){return p.toArray().map(v=>Math.round(v*1e6)).join(',');}
actor.weapon.traverse(mesh=>{if(!mesh.isMesh)return;const g=mesh.geometry,index=g.index,m=weaponInverse.clone().multiply(mesh.matrixWorld),count=index?index.count:g.attributes.position.count;
 for(let i=0;i<count;i+=3){const ids=[0,1,2].map(j=>index?index.getX(i+j):i+j),vertices=ids.map(j=>new T.Vector3().fromBufferAttribute(g.attributes.position,j).applyMatrix4(m));
  for(const [first,second]of [[0,1],[1,2],[2,0]]){let a=vertices[first].clone(),b=vertices[second].clone();if(a.y<bladeBase&&b.y<bladeBase)continue;
   if(a.y<bladeBase)a.lerp(b,(bladeBase-a.y)/(b.y-a.y));if(b.y<bladeBase)b.lerp(a,(bladeBase-b.y)/(a.y-b.y));if(a.distanceToSquared(b)<1e-12)continue;
   const ak=roundedKey(a),bk=roundedKey(b),key=ak<bk?ak+'|'+bk:bk+'|'+ak;if(!edges.has(key))edges.set(key,[a,b]);
  }
 }
});
const bladeEdges=[...edges.values()],bodySources=[],posedTargets=[],point=new T.Vector3();
function region(name){name=name.replace('mixamorig','');if(/Hand/.test(name))return name.startsWith('Right')?'right-hand':'left-hand';if(/Arm/.test(name))return name.startsWith('Right')?'right-arm':'left-arm';if(/UpLeg|Leg|Foot|Toe/.test(name))return name.startsWith('Right')?'right-leg':'left-leg';if(/Head|Neck/.test(name))return'head-neck';return'torso-pelvis';}
actor.body.traverse(source=>{if(!source.isSkinnedMesh)return;
 const src=source.geometry,weights=src.attributes.skinWeight,indices=src.attributes.skinIndex,groups=new Map(),posedPositions=new T.Float32BufferAttribute(new Float32Array(src.attributes.position.count*3),3);
 const count=src.index?src.index.count:src.attributes.position.count;
 for(let i=0;i<count;i+=3){const ids=[0,1,2].map(j=>src.index?src.index.getX(i+j):i+j),totals=new Map();for(const id of ids)for(let c=0;c<4;c++){const name=region(source.skeleton.bones[indices.getComponent(id,c)].name);totals.set(name,(totals.get(name)||0)+weights.getComponent(id,c));}const label=[...totals].sort((a,b)=>b[1]-a[1])[0][0];if(!groups.has(label))groups.set(label,[]);groups.get(label).push(...ids);}
 const targets=[];for(const [label,indices]of groups){const geometry=new T.BufferGeometry();geometry.setAttribute('position',posedPositions);geometry.setIndex(indices);const mesh=new T.Mesh(geometry,material);mesh.matrixAutoUpdate=false;mesh.userData={kind:'body',region:label,source};const target={mesh,box:new T.Box3(),source};posedTargets.push(target);targets.push(target);}
 bodySources.push({source,posedPositions,targets});
});
actor.shield.traverse(mesh=>{if(!mesh.isMesh)return;mesh.material=material;posedTargets.push({mesh,box:new T.Box3(),source:null});mesh.userData={kind:'shield',region:'shield'};});
function updateTargets(){
 for(const {source,posedPositions,targets}of bodySources){for(let index=0;index<posedPositions.count;index++){source.getVertexPosition(index,point);posedPositions.setXYZ(index,point.x,point.y,point.z);}posedPositions.needsUpdate=true;
  for(const target of targets){const mesh=target.mesh;mesh.matrixWorld.copy(source.matrixWorld);mesh.geometry.boundingBox=new T.Box3();const ids=mesh.geometry.index;for(let i=0;i<ids.count;i++)mesh.geometry.boundingBox.expandByPoint(point.fromBufferAttribute(posedPositions,ids.getX(i)));mesh.geometry.boundingSphere=mesh.geometry.boundingBox.getBoundingSphere(new T.Sphere());target.box.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld);}
 }
 for(const target of posedTargets)if(!target.source){target.mesh.geometry.computeBoundingBox();target.box.copy(target.mesh.geometry.boundingBox).applyMatrix4(target.mesh.matrixWorld);}
}
const raycaster=new T.Raycaster(),edgeBox=new T.Box3(),a=new T.Vector3(),b=new T.Vector3(),direction=new T.Vector3(),intersections=[],localHit=new T.Vector3();
function contacts(){
 const byRegion=new Map(),weaponInverse=actor.weapon.matrixWorld.clone().invert();
 for(const edge of bladeEdges){a.copy(edge[0]).applyMatrix4(actor.weapon.matrixWorld);b.copy(edge[1]).applyMatrix4(actor.weapon.matrixWorld);edgeBox.setFromPoints([a,b]);direction.subVectors(b,a);const length=direction.length();if(length<1e-9)continue;direction.divideScalar(length);raycaster.set(a,direction);raycaster.near=0;raycaster.far=length;
  for(const target of posedTargets){if(!edgeBox.intersectsBox(target.box))continue;intersections.length=0;target.mesh.raycast(raycaster,intersections);
   for(const hit of intersections){const label=target.mesh.userData.kind+'/'+target.mesh.userData.region;if(!byRegion.has(label))byRegion.set(label,{region:label,count:0,minBladeY:Infinity,maxBladeY:-Infinity,points:[],pointKeys:new Set()});const group=byRegion.get(label),key=hit.point.toArray().map(v=>Math.round(v*1000)).join(',');if(group.pointKeys.has(key))continue;group.pointKeys.add(key);group.count++;localHit.copy(hit.point).applyMatrix4(weaponInverse);group.minBladeY=Math.min(group.minBladeY,localHit.y);group.maxBladeY=Math.max(group.maxBladeY,localHit.y);
    if(group.points.length<12)group.points.push({world:hit.point.toArray(),bladeLocal:localHit.toArray(),triangle:[hit.face.a,hit.face.b,hit.face.c]});
   }
  }
 }
 return [...byRegion.values()].map(({pointKeys,...group})=>group);
}
const fps=Number(process.env.VESPER_SELF_CONTACT_FPS)||60,rows=[],origin={x:0,z:0,yaw:0};
const selectedClips=(process.env.VESPER_SELF_CONTACT_CLIPS||'light,heavy').split(',');
// VESPER_SELF_CONTACT_CHAIN=<from>:<seconds> adds a 'chain' mode for each selected clip: the runtime
// plays <from> (out of idle) up to <seconds> and hands over to the clip with a fresh action object,
// exactly as the encounter chains light -> light2, so the cross-fade at the chain is what is sampled.
const chain=process.env.VESPER_SELF_CONTACT_CHAIN?{from:process.env.VESPER_SELF_CONTACT_CHAIN.split(':')[0],at:+process.env.VESPER_SELF_CONTACT_CHAIN.split(':')[1]}:null;
for(const name of selectedClips){
 const duration=gltf.animations.find(c=>c.name===name).duration;
 for(const mode of ['pure','entry-exit',...(chain?['chain']:[])]){
  actor.reset(origin);let clock=0;if(mode!=='pure')for(let i=0;i<30;i++)actor.update(1/60,clock+=1/60,{health:100,action:null},origin);
  if(mode==='chain'){const previous={name:chain.from,elapsed:0};for(let frame=1;frame<=Math.round(chain.at*fps);frame++){previous.elapsed=frame/fps;actor.update(1/fps,clock+=1/fps,{health:100,action:previous},origin);}}
  const action={name,elapsed:0,directClipTime:mode==='pure'},samples=[];
  for(let frame=0;frame<=Math.ceil((duration+(mode==='pure'?0:.3))*fps);frame++){
   const time=frame/fps;action.elapsed=Math.min(duration,time);const playing=time<=duration;actor.update(mode==='pure'?0:1/fps,clock+=1/fps,{health:100,action:playing?action:null},origin);
   if(mode==='entry-exit'&&!actor.animation.transition)continue;
   updateTargets();const hits=contacts();samples.push({time,contacts:hits});
  }
  const intervals=[];for(const label of new Set(samples.flatMap(s=>s.contacts.map(c=>c.region)))){let current=null;for(const sample of samples){const hit=sample.contacts.find(c=>c.region===label);if(hit){if(!current||sample.time-current.end>1.5/fps){current={region:label,start:sample.time,end:sample.time,samples:0,maxPoints:0,minBladeY:Infinity,maxBladeY:-Infinity};intervals.push(current);}current.end=sample.time;current.samples++;current.maxPoints=Math.max(current.maxPoints,hit.count);current.minBladeY=Math.min(current.minBladeY,hit.minBladeY);current.maxBladeY=Math.max(current.maxBladeY,hit.maxBladeY);}else current=null;}}
  rows.push({clip:name,mode,sampledFrames:samples.length,intersectionFrames:samples.filter(s=>s.contacts.length).length,intervals,frames:samples.filter(s=>s.contacts.length)});
  console.log(name,mode,JSON.stringify(intervals));
 }
}
// Positive controls exercise the same exact-surface path with a diagnostic-only
// translated sword. They must report real crossings, so an empty result cannot
// silently come from stale bounds or an incorrect normalization transform.
actor.reset(origin);actor.update(0,0,{health:100,action:{name:'idle',elapsed:0,directClipTime:true}},origin);updateTargets();
const savedWeaponMatrix=actor.weapon.matrixWorld.clone(),unit=new T.Vector3(1,1,1),across=new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),new T.Vector3(1,0,0));
const chest=actor.body.getObjectByName('mixamorigSpine2').getWorldPosition(new T.Vector3());
actor.weapon.matrixWorld.compose(chest.clone().add(new T.Vector3(-.75,0,0)),across,unit);const bodyControl=contacts();
const shieldInverse=actor.shield.matrixWorld.clone().invert(),shieldBox=new T.Box3();actor.shield.traverse(mesh=>{if(!mesh.isMesh)return;const positions=mesh.geometry.attributes.position;for(let i=0;i<positions.count;i++)shieldBox.expandByPoint(point.fromBufferAttribute(positions,i).applyMatrix4(mesh.matrixWorld).applyMatrix4(shieldInverse));});
const shieldSize=shieldBox.getSize(new T.Vector3()),thinAxis=shieldSize.toArray().indexOf(Math.min(...shieldSize.toArray())),axis=new T.Vector3().setComponent(thinAxis,1),normalRotation=new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),axis),throughShield=new T.Matrix4().compose(shieldBox.getCenter(new T.Vector3()).addScaledVector(axis,-.75),normalRotation,unit);
actor.weapon.matrixWorld.multiplyMatrices(actor.shield.matrixWorld,throughShield);const shieldControl=contacts();actor.weapon.matrixWorld.copy(savedWeaponMatrix);
const positiveControls={body:{passed:bodyControl.some(c=>c.region.startsWith('body/')),contacts:bodyControl.map(({points,...c})=>c)},shield:{passed:shieldControl.some(c=>c.region==='shield/shield'),contacts:shieldControl.map(({points,...c})=>c)}};
if(!positiveControls.body.passed||!positiveControls.shield.passed)throw new Error('Exact-mesh positive controls failed: '+JSON.stringify(positiveControls));
const report={createdAt:new Date().toISOString(),asset,sha256,snapshotStillCurrent:sha256===await hash(asset),metadataPath,bodyVertices:bodySources.reduce((sum,s)=>sum+s.posedPositions.count,0),bladeTriangleEdgeSegments:bladeEdges.length,excludedBelowBladeLocalY:bladeBase,sampleHz:fps,selectedClips,positiveControls,method:'Exact mesh-edge/surface intersections: every unique triangle edge of the visible normalized sword above0.30m is transformed by its animated socket and raycast against actual posed skinned body triangles and the normalized shield triangles. Body vertices are evaluated with SkinnedMesh.getVertexPosition each sampled frame; region meshes preserve all triangles and use THREE.Mesh.raycast. Bounds only cull impossible candidates, never decide contact. Double-sided triangles avoid winding omissions.',limitations:'Discrete pose samples, not swept surface volumes. This catches intersecting blade edges but cannot certify complete mesh-volume separation or entirely contained surfaces. The excluded hilt/handle is the only permitted grip area; blade contact with hands/armor is reported. Regions use dominant triangle skin weights. Vertex-edge intersection counts are not penetration depths.',rows};
report.sampledBladeEdgesClear=rows.every(row=>row.intersectionFrames===0);
await fs.writeFile(process.env.VESPER_SELF_CONTACT_REPORT||'docs/player-combat-revision/player-blade-self-contact-v2.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({sha256,edges:bladeEdges.length,intersectionFrames:rows.map(r=>({clip:r.clip,mode:r.mode,frames:r.intersectionFrames,sampled:r.sampledFrames})),snapshotStillCurrent:report.snapshotStillCurrent},null,2));

if(!report.sampledBladeEdgesClear)process.exitCode=1;
