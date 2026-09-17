// Shield behaviour through the roll, measured on the real runtime actor (no rendering).
// Reports, per frame of the dodge clip: the shield centroid in the actor's local frame
// (x = the character's right, z = forward), the lowest shield vertex above the floor, how
// far the shield centroid sits from the left forearm, and the per-frame jump of the centroid
// (a pop shows up as a spike). Usage:
//   VESPER_PLAYER_CANDIDATE=assets/…/player-video-candidate-v15.glb \
//   VESPER_PLAYER_METADATA=docs/…/player-video-candidate-v15-manifest.json \
//   node scripts/audit-shield-roll.mjs [--out docs/…/shield-roll.json]
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import * as T from 'three';
import {loadGLB} from './load-glb-node.mjs';
import {createActor, shieldMountTransform} from '../src/game/actors.js';
import {ASSETS} from '../src/game/asset-paths.js';
import {actionTravelAt} from '../src/game/action-travel.js';

const arg=(name,fallback)=>{const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:fallback;};
const rigPath=process.env.VESPER_PLAYER_CANDIDATE||fileURLToPath(ASSETS.playerRig);
const metadata=JSON.parse(await fs.readFile(process.env.VESPER_PLAYER_METADATA||'docs/player-motion-revision-2/player-video-candidate-v15-manifest.json','utf8'));
const out=arg('--out','docs/overnight-2026-09-16/C-stills/shield-roll.json');

const [gltf,swordGLB,shieldGLB]=await Promise.all([loadGLB(rigPath),loadGLB(fileURLToPath(ASSETS.playerSword)),loadGLB(fileURLToPath(ASSETS.playerShield))]);
const actor=createActor(gltf,1.85,false,true,metadata);
// The same local fitting sequence loadActors() uses, without loading texture images.
function prepare(root,height){const wrapper=new T.Group();wrapper.add(root);root.rotation.y=-Math.PI/2;wrapper.updateMatrixWorld(true);const box=new T.Box3().setFromObject(root),size=box.getSize(new T.Vector3());root.scale.multiplyScalar(height/size.y);root.updateMatrixWorld(true);box.setFromObject(root);const center=box.getCenter(new T.Vector3());root.position.sub(new T.Vector3(center.x,box.min.y,center.z));wrapper.updateMatrixWorld(true);return wrapper;}
swordGLB.scene.rotation.z=Math.PI;actor.weapon=prepare(swordGLB.scene,1.28);actor.body.getObjectByName('WeaponSocket').add(actor.weapon);
actor.weapon.rotation.set(Math.PI/2,0,0);
const shieldMount=shieldMountTransform(metadata);
actor.shield=prepare(shieldGLB.scene,shieldMount.height);
actor.body.getObjectByName('ShieldSocket').add(actor.shield);
actor.shield.quaternion.copy(shieldMount.quaternion);actor.shield.position.copy(shieldMount.position);actor.shieldMount=shieldMount;
actor.root.updateMatrixWorld(true);

function localVertices(wrapper){const points=[],inverse=wrapper.matrixWorld.clone().invert();wrapper.traverse(mesh=>{if(!mesh.isMesh)return;const m=inverse.clone().multiply(mesh.matrixWorld),a=mesh.geometry.attributes.position;for(let i=0;i<a.count;i++){const p=new T.Vector3().fromBufferAttribute(a,i).applyMatrix4(m);points.push(p.x,p.y,p.z);}});return new Float64Array(points);}
const shieldPoints=localVertices(actor.shield);
const forearm=actor.body.getObjectByName('mixamorigLeftForeArm'),hand=actor.body.getObjectByName('mixamorigLeftHand');

// --- Readability ------------------------------------------------------------------
// A 1.545 m shield presented face-on from the gameplay camera hides the whole character
// (round 1 blocker). Two numbers per frame: `faceUp`, how much the shield's face normal
// points at the sky (1 = broadside to a camera looking down at it, 0 = edge-on), and
// `cover`, the fraction of the character's joints that fall behind the shield's silhouette
// from the real gameplay camera (src/game/main.js cameraStep: distance 5.2, pitch .15).
const shieldFaceAxis=(()=>{
 // The shield's own thin axis is its face normal; take it from the local bounding box.
 const box=new T.Box3(),inverse=actor.shield.matrixWorld.clone().invert(),point=new T.Vector3();
 actor.shield.traverse(mesh=>{if(!mesh.isMesh)return;const m=inverse.clone().multiply(mesh.matrixWorld),a=mesh.geometry.attributes.position;
  for(let i=0;i<a.count;i++)box.expandByPoint(point.fromBufferAttribute(a,i).applyMatrix4(m));});
 const size=box.getSize(new T.Vector3()),axis=size.x<=size.y&&size.x<=size.z?'x':size.y<=size.z?'y':'z';
 return new T.Vector3(axis==='x'?1:0,axis==='y'?1:0,axis==='z'?1:0);
})();
const jointNames=['mixamorigHips','mixamorigSpine','mixamorigSpine1','mixamorigSpine2','mixamorigNeck','mixamorigHead',
 'mixamorigLeftArm','mixamorigLeftForeArm','mixamorigRightArm','mixamorigRightForeArm','mixamorigRightHand',
 'mixamorigLeftUpLeg','mixamorigLeftLeg','mixamorigLeftFoot','mixamorigRightUpLeg','mixamorigRightLeg','mixamorigRightFoot'];
const joints=jointNames.map(name=>actor.body.getObjectByName(name)).filter(Boolean);
const hullDirections=(()=>{const list=[];for(let i=0;i<64;i++){const y=1-2*(i+.5)/64,r=Math.sqrt(Math.max(0,1-y*y)),a=Math.PI*(3-Math.sqrt(5))*i;list.push(new T.Vector3(Math.cos(a)*r,y,Math.sin(a)*r));}return list;})();
const shieldHullLocal=(()=>{const best=hullDirections.map(()=>({value:-Infinity,point:null}));
 for(let i=0;i<shieldPoints.length;i+=3){const p=new T.Vector3(shieldPoints[i],shieldPoints[i+1],shieldPoints[i+2]);
  for(let d=0;d<hullDirections.length;d++){const value=p.dot(hullDirections[d]);if(value>best[d].value){best[d].value=value;best[d].point=p;}}}
 const unique=[];for(const entry of best)if(entry.point&&!unique.some(p=>p.distanceToSquared(entry.point)<1e-6))unique.push(entry.point);return unique;})();
// The actor here always faces +Z and travels +Z, whatever direction the roll is: what changes
// with the roll direction is where the *camera* sits, because the camera stays behind the
// pre-roll facing while the body turns into the heading. Camera yaw in this local frame:
// forward roll pi (behind), left roll pi/2 (the camera is off the body's right), right roll
// 3pi/2, back roll 0 (the body has turned to face the camera).
const CAMERA_YAW={forward:Math.PI,left:Math.PI/2,right:Math.PI*1.5,back:0};
const roll=arg('--roll','forward');
if(!(roll in CAMERA_YAW))throw new Error('--roll must be one of '+Object.keys(CAMERA_YAW).join(', '));
/** The gameplay camera (src/game/main.js cameraStep) for a camera behind the player at `yaw`. */
function gameplayCamera(yaw,player){
 // main.js: behind=(sin,cos)*distance at 2.25+pitch*3, anchor y 1.35, plus a small side offset.
 const distance=5.2,pitch=.15;
 const position=new T.Vector3(player.x+Math.sin(yaw)*distance+Math.cos(yaw)*.28,pitch*1.4+2.25+pitch*3,player.z+Math.cos(yaw)*distance-Math.sin(yaw)*.28);
 const target=new T.Vector3(player.x,1.35,player.z);
 return {position,target,direction:target.clone().sub(position).normalize()};
}
/** Screen-space silhouette test from a camera behind the player at `yaw` (0 = directly behind). */
function coverage(yaw,shieldWorld,jointWorld,player){
 const {position:camera,target}=gameplayCamera(yaw,player);
 const f=target.clone().sub(camera).normalize(),r=f.clone().cross(new T.Vector3(0,1,0)).normalize(),u=r.clone().cross(f).normalize();
 const project=p=>{const v=p.clone().sub(camera),d=v.dot(f);return d<=.01?null:{x:v.dot(r)/d,y:v.dot(u)/d,d};};
 const points=shieldWorld.map(project).filter(Boolean);
 if(points.length<3)return 0;
 const depth=points.reduce((sum,p)=>sum+p.d,0)/points.length;
 // Convex hull (gift wrapping on a small point set) of the shield silhouette.
 const hull=[];let start=points.reduce((best,p)=>p.x<best.x?p:best,points[0]),current=start;
 do{hull.push(current);let next=points[0];
  for(const p of points){if(p===current)continue;
   const cross=(next.x-current.x)*(p.y-current.y)-(next.y-current.y)*(p.x-current.x);
   if(next===current||cross<0||(Math.abs(cross)<1e-12&&(p.x-current.x)**2+(p.y-current.y)**2>(next.x-current.x)**2+(next.y-current.y)**2))next=p;}
  current=next;}while(current!==start&&hull.length<points.length);
 const inside=point=>{for(let i=0;i<hull.length;i++){const a=hull[i],b=hull[(i+1)%hull.length];
  if((b.x-a.x)*(point.y-a.y)-(b.y-a.y)*(point.x-a.x)<-1e-9)return false;}return true;};
 let hidden=0;
 for(const joint of jointWorld){const p=project(joint);if(p&&p.d>depth&&inside(p))hidden++;}
 return hidden/Math.max(1,jointWorld.length);
}

const clip=gltf.animations.find(c=>c.name==='dodge');
const spec=metadata.clips.dodge||{},duration=clip.duration,fps=60;
const origin={x:0,z:0,yaw:0};
// Settle into idle first, exactly as the game does before a roll is requested.
actor.reset(origin);let clock=0;for(let frame=0;frame<30;frame++)actor.update(1/60,clock+=1/60,{health:100,action:null},origin);
const action={name:'dodge',elapsed:0},rows=[];let previousCentre=null;
const world=new T.Vector3(),centre=new T.Vector3();
for(let frame=0;frame<=Math.ceil((duration+.4)*fps);frame++){
 const t=frame/fps,playing=t<duration;action.elapsed=t;
 origin.z=(spec.direction==='backward'?-1:1)*actionTravelAt(spec,Math.min(t,duration));
 // Nothing renders here, so hand the strap the direction the gameplay camera would be
 // looking along for this roll direction, exactly as onBeforeRender does in the game.
 const shot=gameplayCamera(CAMERA_YAW[roll],origin);
 actor.shieldStrap?.setView(shot.direction);
 actor.update(1/fps,clock+=1/fps,{health:100,action:playing?action:null},origin);
 actor.shieldStrap?.setView(shot.direction);
 const e=actor.shield.matrixWorld.elements;
 let minimum=Infinity;centre.set(0,0,0);
 for(let i=0;i<shieldPoints.length;i+=3){
  const x=shieldPoints[i],y=shieldPoints[i+1],z=shieldPoints[i+2];
  const wy=x*e[1]+y*e[5]+z*e[9]+e[13];
  if(wy<minimum)minimum=wy;
  centre.x+=x*e[0]+y*e[4]+z*e[8]+e[12];centre.y+=wy;centre.z+=x*e[2]+y*e[6]+z*e[10]+e[14];
 }
 centre.divideScalar(shieldPoints.length/3);
 const local=centre.clone().sub(new T.Vector3(origin.x,0,origin.z)).applyAxisAngle(new T.Vector3(0,1,0),-origin.yaw);
 const armDistance=centre.distanceTo(forearm.getWorldPosition(world));
 const handDistance=centre.distanceTo(hand.getWorldPosition(world));
 const strap=actor.shieldStrap;
 const normal=shieldFaceAxis.clone().transformDirection(actor.shield.matrixWorld);
 const hullWorld=shieldHullLocal.map(p=>p.clone().applyMatrix4(actor.shield.matrixWorld));
 const jointWorld=joints.map(bone=>bone.getWorldPosition(new T.Vector3()));
 // The actor faces +Z here, so the camera sits behind it at yaw pi; the other three are
 // the quarter and side views the reviewer used.
 const covers=[Math.PI,Math.PI*1.25,Math.PI*.75,Math.PI*1.5].map(yaw=>coverage(yaw,hullWorld,jointWorld,origin));
 // |face normal . view direction| is the shield's projected silhouette area from the camera
 // that is actually looking at it: 1 = the full 1.545 m face across the screen, 0 = a sliver.
 const faceView=Math.abs(normal.dot(shot.direction));
 rows.push({t:+t.toFixed(4),playing,floor:+minimum.toFixed(4),
  faceView:+faceView.toFixed(3),
  faceUp:+Math.abs(normal.y).toFixed(3),cover:+covers[0].toFixed(3),coverMax:+Math.max(...covers).toFixed(3),localX:+local.x.toFixed(4),localY:+local.y.toFixed(4),localZ:+local.z.toFixed(4),
  lateral:+Math.hypot(local.x,local.z).toFixed(4),forearm:+armDistance.toFixed(4),hand:+handDistance.toFixed(4),
  jump:previousCentre?+centre.distanceTo(previousCentre).toFixed(4):0,
  weight:strap?+strap.weight.toFixed(3):0,spin:strap?+((strap.spinHint||0)*180/Math.PI).toFixed(1):0,tip:strap?+((strap.presentation||0)*180/Math.PI).toFixed(1):0,fix:strap?+(strap.correction*180/Math.PI).toFixed(1):0,solved:strap?+strap.floor.toFixed(4):0,
  elbow:+forearm.getWorldPosition(new T.Vector3()).y.toFixed(3)});
 previousCentre=centre.clone();
}
const during=rows.filter(row=>row.playing);
const worst=(rows,key,pick)=>rows.reduce((best,row)=>pick(row[key],best[key])?row:best);
// The reviewer's bar: from the camera the game actually uses, the shield must not lie
// broadside across the screen while it is low enough to sit in front of the character.
const low=during.filter(row=>row.floor<.5);
const summary={
 asset:rigPath,roll,cameraYaw:+CAMERA_YAW[roll].toFixed(4),frames:rows.length,
 meanFaceView:+(during.reduce((sum,row)=>sum+row.faceView,0)/during.length).toFixed(3),
 worstFaceView:worst(during,'faceView',(a,b)=>a>b),
 worstFaceViewWhileLow:low.length?worst(low,'faceView',(a,b)=>a>b):null,
 framesBroadsideWhileLow:low.filter(row=>row.faceView>.4).length,
 framesLow:low.length,
 lowestFloor:worst(rows,'floor',(a,b)=>a<b),
 farthestLateral:worst(during,'lateral',(a,b)=>a>b),
 farthestFromForearm:worst(rows,'forearm',(a,b)=>a>b),
 biggestJump:worst(rows.slice(1),'jump',(a,b)=>a>b),
 meanForearm:+(rows.reduce((sum,row)=>sum+row.forearm,0)/rows.length).toFixed(4),
 framesBelowFloor:rows.filter(row=>row.floor<-.005).length,
 worstCover:worst(during,'cover',(a,b)=>a>b),
 worstCoverAnyAngle:worst(during,'coverMax',(a,b)=>a>b),
 framesHidingHalfTheBody:during.filter(row=>row.cover>=.5).length,
 framesHidingHalfTheBodyAnyAngle:during.filter(row=>row.coverMax>=.5).length,
 meanFaceUp:+(during.reduce((sum,row)=>sum+row.faceUp,0)/during.length).toFixed(3),
};
await fs.writeFile(out,JSON.stringify({createdAt:new Date().toISOString(),summary,rows},null,1)+'\n');
console.log(JSON.stringify(summary,null,1));
console.log('t      floor  lateral forearm hand  jump  weight fix   solved elbow faceView faceUp cover coverMax spin');
for(const row of rows)if(Math.round(row.t*60)%2===0&&row.t<1.6)console.log([row.t.toFixed(3),row.floor.toFixed(3),row.lateral.toFixed(3),row.forearm.toFixed(3),row.hand.toFixed(3),row.jump.toFixed(3),row.weight.toFixed(2),String(row.fix).padStart(5),row.solved.toFixed(3),row.elbow.toFixed(3),row.faceView.toFixed(3).padStart(8),row.faceUp.toFixed(3),row.cover.toFixed(3),row.coverMax.toFixed(3),String(row.spin).padStart(6)].join(' '));
