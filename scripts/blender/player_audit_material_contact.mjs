import fs from 'node:fs';import * as T from 'three';
import {loadGLB} from '../load-glb-node.mjs';
import {SoleClearance} from '../../src/game/sole-clearance.js';
import {FootPlant} from '../../src/game/foot-plant.js';
import metadata from '../../docs/player-essential-manifest.json' with {type:'json'};
const path=process.argv[2]||'assets/production/player-essential.glb',out=process.argv[3]||'docs/player-run-material-contact.json',clipName=process.argv[4]||'run-forward';
const g=await loadGLB(path),mixer=new T.AnimationMixer(g.scene),clip=g.animations.find(x=>x.name===clipName),action=mixer.clipAction(clip);action.play();
const soles=new SoleClearance(g.scene),plant=new FootPlant(g.scene,soles),duration=clip.duration,speed=metadata.clips[clipName].sourceSpeed;
const sides=['Left','Right'],sets=Object.fromEntries(sides.map(s=>[s,[]]));
g.scene.traverse(mesh=>{if(!mesh.isSkinnedMesh)return;const{position,skinIndex,skinWeight}=mesh.geometry.attributes;for(const side of sides){const ids=new Set(mesh.skeleton.bones.map((b,i)=>new RegExp(side+'(?:Foot|ToeBase)$').test(b.name)?i:-1).filter(i=>i>=0));for(let i=0;i<position.count;i++){let w=0;for(let j=0;j<4;j++)if(ids.has(skinIndex.getComponent(i,j)))w+=skinWeight.getComponent(i,j);if(w>.5)sets[side].push({mesh,index:i});}}});
const quant=(values,q=.5)=>{if(!values.length)return null;const v=values.slice().sort((a,b)=>a-b);return v[Math.min(v.length-1,Math.floor(v.length*q))];};
const direction=new T.Vector3(clipName.includes('left')?1:clipName.includes('right')?-1:0,0,clipName.includes('forward')?1:clipName.includes('back')?-1:0).normalize();
if(process.argv[5]==='flip-x')direction.x*=-1;
function pose(t,correct){action.time=((t%duration)+duration)%duration;mixer.update(0);g.scene.updateMatrixWorld(true);if(correct)plant.correct();return Object.fromEntries(sides.map(side=>[side,{q:g.scene.getObjectByName('mixamorig'+side+'Foot').getWorldQuaternion(new T.Quaternion()),points:sets[side].map(({mesh,index})=>mesh.getVertexPosition(index,new T.Vector3()).applyMatrix4(mesh.matrixWorld).addScaledVector(direction,speed*t))} ]));}
const variants={};const h=1/600;
for(const corrected of [false,true]){
 const frames=[],all=[],flat=[],rolling=[],rows=[];
 for(let i=0;i<240;i++){
  const t=duration*i/240,a=pose(t-h,corrected),b=pose(t,corrected),c=pose(t+h,corrected);
  for(const side of sides){const speeds=[],indices=[],ys=b[side].points.map(p=>p.y),minY=Math.min(...ys);let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
   for(let j=0;j<ys.length;j++){const p=b[side].points[j],v=c[side].points[j].clone().sub(a[side].points[j]).multiplyScalar(1/(2*h));if(p.y<.012&&a[side].points[j].y<.014&&c[side].points[j].y<.014&&Math.abs(v.y)<.20){speeds.push(Math.hypot(v.x,v.z));indices.push(j);minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minZ=Math.min(minZ,p.z);maxZ=Math.max(maxZ,p.z);}}
   const angular=a[side].q.angleTo(c[side].q)/(2*h)*180/Math.PI,span=Math.hypot(maxX-minX,maxZ-minZ),patch=indices.length>8&&span>.035;
   const flatSupport=patch&&span>.12&&angular<100;
   const row={t,side,minimumSole:minY,contactVertices:indices.length,contactSpan:indices.length?span:0,footAngularDegreesPerSecond:angular,contactSpeedMedian:quant(speeds),contactSpeedP90:quant(speeds,.9),flatSupport};rows.push(row);
   if(patch){all.push(...speeds);if(flatSupport)flat.push(...speeds);else rolling.push(...speeds);}
  }
 }
 const summary={speed,duration,footVertexCount:Object.fromEntries(sides.map(s=>[s,sets[s].length])),allNearContact:{samples:all.length,median:quant(all),p90:quant(all,.9)},flatSupport:{samples:flat.length,median:quant(flat),p90:quant(flat,.9),frames:rows.filter(r=>r.flatSupport).length},toeRollOrTransition:{samples:rolling.length,median:quant(rolling),p90:quant(rolling,.9)},minimumSole:Math.min(...rows.map(r=>r.minimumSole))};variants[corrected?'withFootPlant':'raw']={summary,rows};
}
fs.writeFileSync(out,JSON.stringify({asset:path,clip:clipName,method:'Same actual weighted sole vertices at ±1/600s, including controller travel. Contact y<12mm, endpoint y<14mm, vertical speed<0.20m/s. Flat support additionally spans>12cm with foot rotation<100deg/s. Terrain plane y=0.',variants},null,2));console.log(JSON.stringify(Object.fromEntries(Object.entries(variants).map(([k,v])=>[k,v.summary])),null,2));
