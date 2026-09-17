import fs from 'node:fs/promises';
import * as T from 'three';
import {loadGLB} from './load-glb-node.mjs';
import {createActor} from '../src/game/actors.js';
import metadata from '../docs/boss-essential-manifest.json' with {type:'json'};
const gltf=await loadGLB('assets/production/boss-essential.glb');
const actor=createActor(gltf,2.5,true,true,metadata),origin={x:0,z:0,yaw:0};
const p=name=>gltf.scene.getObjectByName('mixamorig'+name).getWorldPosition(new T.Vector3());
const grip=side=>{const v=new T.Vector3();for(const d of ['Index','Middle','Ring','Pinky'])for(const j of [1,3])v.add(p(side+'Hand'+d+j));return v.multiplyScalar(.1).addScaledVector(p(side+'HandThumb3'),.2);};
const smooth=t=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);};
function anchors(name,t){const source=t/4.2*(215/30),slide=name==='slam'?smooth(source/1.8)*(1-smooth((source-3.6)/2.1)):0;return {Right:.6+.2*slide,Left:1.55-.25*slide};}
const sequence=[['idle',.5],['walk-forward',1.4],['idle',.5],['sweep',3.7],['idle',.5],['walk-forward',.8],['slam',4.2],['idle',.7],['death',3.6]];
let clock=0,index=0,maxGrip=0,minFloor=Infinity,maxFloor=-Infinity;const errors=[];
actor.reset(origin);
for(const[name,length]of sequence){
 const action=['idle','walk-forward'].includes(name)?null:{name,elapsed:0,hits:[]};
 for(let t=0;t<length;t+=1/60){
  clock+=1/60;if(name==='walk-forward')origin.z+=metadata.locomotionSpeed/60;
  if(action)action.elapsed=t;
  actor.update(1/60,clock,{health:100,action},origin);
  const layers=actor.animation.debugState().layers,expected={Right:0,Left:0};
  for(const layer of layers){const at=anchors(layer.name,layer.time);for(const side of ['Right','Left'])expected[side]+=at[side]*layer.weight;}
  const socket=gltf.scene.getObjectByName('WeaponSocket');
  const error=Math.max(...['Right','Left'].map(side=>grip(side).distanceTo(new T.Vector3(0,0,expected[side]).applyMatrix4(socket.matrixWorld))));
  maxGrip=Math.max(maxGrip,error);if(error>.02)errors.push({time:clock,requested:name,error,layers});
  if(index++%8===0){let floor=Infinity;gltf.scene.traverse(n=>{if(n.isSkinnedMesh){n.computeBoundingBox();floor=Math.min(floor,n.boundingBox.clone().applyMatrix4(n.matrixWorld).min.y);}});minFloor=Math.min(minFloor,floor);maxFloor=Math.max(maxFloor,floor);}
 }
}
const report={createdAt:new Date().toISOString(),sequence,maxGripError:maxGrip,floorRange:[minFloor,maxFloor],contactViolationsOver2cm:errors};
await fs.writeFile('docs/boss-blend-contact-audit.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({maxGripError:maxGrip,floorRange:report.floorRange,violations:errors.length,worst:errors.sort((a,b)=>b.error-a.error).slice(0,3)},null,2));
