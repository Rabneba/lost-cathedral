import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import * as T from 'three';
import {loadGLB} from './load-glb-node.mjs';
import {createActor,shieldMountTransform} from '../src/game/actors.js';
import {ASSETS} from '../src/game/asset-paths.js';
import {actionTravelAt} from '../src/game/action-travel.js';
const path=process.env.VESPER_PLAYER_CANDIDATE||'assets/player-combat-revision/player-video-candidate.glb',metadata=JSON.parse(await fs.readFile(process.env.VESPER_PLAYER_METADATA||'docs/player-combat-revision/player-video-candidate-manifest.json','utf8'));
const hash=async path=>createHash('sha256').update(await fs.readFile(path)).digest('hex'),initialHash=await hash(path);
const [gltf,swordGLB,shieldGLB]=await Promise.all([loadGLB(path),loadGLB(fileURLToPath(ASSETS.playerSword)),loadGLB(fileURLToPath(ASSETS.playerShield))]);
const actor=createActor(gltf,1.85,false,true,metadata);
// Same local fitting sequence as loadActors, without loading texture images.
function prepare(root,height){const wrapper=new T.Group();wrapper.add(root);root.rotation.y=-Math.PI/2;wrapper.updateMatrixWorld(true);const box=new T.Box3().setFromObject(root),size=box.getSize(new T.Vector3());root.scale.multiplyScalar(height/size.y);root.updateMatrixWorld(true);box.setFromObject(root);const center=box.getCenter(new T.Vector3());root.position.sub(new T.Vector3(center.x,box.min.y,center.z));wrapper.updateMatrixWorld(true);return wrapper;}
swordGLB.scene.rotation.z=Math.PI;actor.weapon=prepare(swordGLB.scene,1.28);actor.body.getObjectByName('WeaponSocket').add(actor.weapon);
const shieldMount=shieldMountTransform(metadata);actor.shield=prepare(shieldGLB.scene,shieldMount.height);actor.body.getObjectByName("ShieldSocket").add(actor.shield);actor.shield.quaternion.copy(shieldMount.quaternion);actor.shield.position.copy(shieldMount.position);actor.shieldMount=shieldMount;
actor.root.updateMatrixWorld(true);const inverse=actor.weapon.matrixWorld.clone().invert(),xs=[],zs=[];
actor.weapon.children[0].traverse(mesh=>{if(!mesh.isMesh)return;const a=mesh.geometry.attributes.position;for(let i=0;i<a.count;i++){const p=new T.Vector3().fromBufferAttribute(a,i).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse);if(p.y>.08&&p.y<.25){xs.push(p.x);zs.push(p.z);}}});
xs.sort((a,b)=>a-b);zs.sort((a,b)=>a-b);if(xs.length){actor.weapon.children[0].position.x-=xs[Math.floor(xs.length/2)];actor.weapon.children[0].position.z-=zs[Math.floor(zs.length/2)];}
actor.weapon.rotation.set(Math.PI/2,0,0);actor.root.updateMatrixWorld(true);
function localVertices(wrapper){const points=[],inverse=wrapper.matrixWorld.clone().invert();wrapper.traverse(mesh=>{if(!mesh.isMesh)return;const m=inverse.clone().multiply(mesh.matrixWorld),a=mesh.geometry.attributes.position;for(let i=0;i<a.count;i++){const p=new T.Vector3().fromBufferAttribute(a,i).applyMatrix4(m);points.push(p.x,p.y,p.z);}});return new Float64Array(points);}
const props=[{name:'sword',root:actor.weapon,points:localVertices(actor.weapon)},{name:'shield',root:actor.shield,points:localVertices(actor.shield)}];
function minimum(prop){const p=prop.points,e=prop.root.matrixWorld.elements;let min=Infinity;for(let i=0;i<p.length;i+=3)min=Math.min(min,p[i]*e[1]+p[i+1]*e[5]+p[i+2]*e[9]+e[13]);return min;}
const rows=[],fps=Number(process.env.VESPER_PROP_FPS)||60,selectedClips=process.env.VESPER_PROP_CLIPS?.split(',');
for(const clip of gltf.animations.filter(c=>!selectedClips||selectedClips.includes(c.name))){
 const origin={x:0,z:0,yaw:0},spec=metadata.clips[clip.name]||{},row={name:clip.name,duration:clip.duration,pure:{},entryExit:{}};
 for(const prop of props){row.pure[prop.name]={minimum:Infinity,time:null};row.entryExit[prop.name]={minimum:Infinity,time:null,phase:null};}
 const action={name:clip.name,elapsed:0,directClipTime:true};actor.reset(origin);
 for(let frame=0;frame<=Math.ceil(clip.duration*fps);frame++){
  const t=Math.min(clip.duration,frame/fps);action.elapsed=t;origin.z=(spec.direction==='backward'?-1:1)*actionTravelAt(spec,t);actor.update(0,t,{health:100,action},origin);
  for(const prop of props){const value=minimum(prop);if(value<row.pure[prop.name].minimum)row.pure[prop.name]={minimum:value,time:t};}
 }
 origin.z=0;actor.reset(origin);let clock=0;for(let frame=0;frame<30;frame++)actor.update(1/60,clock+=1/60,{health:100,action:null},origin);
 const runtimeAction={name:clip.name,elapsed:0};
 // Action entry/exit blends; gait transitions are handled in the body audit.
 if(!/^(run|walk)-/.test(clip.name))for(let frame=0;frame<=Math.ceil((clip.duration+.3)*fps);frame++){
  const t=frame/fps,playing=t<clip.duration;runtimeAction.elapsed=t;origin.z=(spec.direction==='backward'?-1:1)*actionTravelAt(spec,Math.min(t,clip.duration));actor.update(1/fps,clock+=1/fps,{health:100,action:playing?runtimeAction:null},origin);
  if(!actor.animation.transition)continue;
  for(const prop of props){const value=minimum(prop);if(value<row.entryExit[prop.name].minimum)row.entryExit[prop.name]={minimum:value,time:t,phase:playing?'entry':'exit'};}
 }
 rows.push(row);
}
const report={createdAt:new Date().toISOString(),asset:path,sha256:initialHash,snapshotStillCurrent:initialHash===await hash(path),scope:'Exact current runtime independent prop fitting, all mesh vertices, pure clips and non-gait entry/exit blends; no asset changes.',sampleHz:fps,selectedClips:selectedClips||'all',vertices:Object.fromEntries(props.map(p=>[p.name,p.points.length/3])),rows,failures:rows.flatMap(row=>Object.entries(row.pure).filter(([,v])=>v.minimum<-.005).map(([prop,v])=>({clip:row.name,mode:'pure',prop,...v}))).concat(rows.flatMap(row=>Object.entries(row.entryExit).filter(([,v])=>v.minimum<-.005).map(([prop,v])=>({clip:row.name,mode:'blend',prop,...v}))))};
report.passed=report.failures.length===0;await fs.writeFile(process.env.VESPER_PROP_REPORT||'docs/player-combat-revision/runtime-prop-floor-diagnostic.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
