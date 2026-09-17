// Measure the selected player rig: body/head facing per clip, left-arm motion in idle,
// and the shield socket frame. Prints JSON for docs/player-combat-revision/pose-inspection.json.
import {AnimationMixer, Box3, Quaternion, Vector3, Matrix4} from 'three';
import {writeFileSync} from 'node:fs';
import {loadGLB} from './load-glb-node.mjs';
import {readFileSync} from 'node:fs';
import {applyClipAdjustments} from '../src/game/clip-adjustments.js';
// VESPER_ADJUST=1 measures the clips after the manifest's load-time adjustments.
const ADJUST=process.env.VESPER_ADJUST==='1',MANIFEST='docs/player-combat-revision/player-video-candidate-v6-manifest.json';

const PLAYER='assets/player-combat-revision/player-video-candidate-v6.glb',SHIELD='assets/create-the-exact-isolated-player-shield-cmu12nf3.glb';
const gltf=await loadGLB(PLAYER),scene=gltf.scene;scene.updateMatrixWorld(true);
if(ADJUST)applyClipAdjustments(gltf.animations,JSON.parse(readFileSync(MANIFEST,'utf8')));
const bones=[];scene.traverse(n=>{if(n.isBone)bones.push(n.name);});
const find=re=>{let hit=null;scene.traverse(n=>{if(!hit&&re.test(n.name))hit=n;});return hit;};
const B={head:find(/Head$/),hips:find(/Hips$/),spine:find(/Spine2$|Spine1$|Spine$/),lShoulder:find(/LeftArm$/),rShoulder:find(/RightArm$/),lUpLeg:find(/LeftUpLeg$/),rUpLeg:find(/RightUpLeg$/),lFoot:find(/LeftFoot$/),lToe:find(/LeftToe(Base)?$/),rFoot:find(/RightFoot$/),rToe:find(/RightToe(Base)?$/),lArm:find(/LeftArm$/),lForeArm:find(/LeftForeArm$/),lHand:find(/LeftHand$/),shieldSocket:find(/ShieldSocket$/),weaponSocket:find(/WeaponSocket$/)};
const missing=Object.entries(B).filter(([,n])=>!n).map(([k])=>k);
const up=new Vector3(0,1,0);
const worldPos=n=>n.getWorldPosition(new Vector3());
const yawDeg=v=>Math.atan2(v.x,v.z)*180/Math.PI;
// Rest-pose local axis of a bone that points to world +Z, reused in animated frames.
function restForward(bone){const inv=new Matrix4().copy(bone.matrixWorld).invert();const local=new Vector3(0,0,1).transformDirection(inv);return local.normalize();}
const restAxes={};for(const k of ['head','hips','spine'])if(B[k])restAxes[k]=restForward(B[k]);
function facing(){const shoulder=worldPos(B.lShoulder).sub(worldPos(B.rShoulder)).setY(0).normalize(),pelvis=worldPos(B.lUpLeg).sub(worldPos(B.rUpLeg)).setY(0).normalize();
 const out={shoulderYaw:yawDeg(shoulder.clone().cross(up)),pelvisYaw:yawDeg(pelvis.clone().cross(up))};
 for(const k of ['head','hips','spine'])if(B[k])out[k+'Yaw']=yawDeg(restAxes[k].clone().transformDirection(B[k].matrixWorld).setY(0).normalize());
 if(B.lFoot&&B.lToe)out.leftFootYaw=yawDeg(worldPos(B.lToe).sub(worldPos(B.lFoot)).setY(0).normalize());
 if(B.rFoot&&B.rToe)out.rightFootYaw=yawDeg(worldPos(B.rToe).sub(worldPos(B.rFoot)).setY(0).normalize());
 return out;}
const mixer=new AnimationMixer(scene);
const report={bones,missing,restFacing:facing(),clips:{}};
for(const clip of gltf.animations){
 mixer.stopAllAction();const action=mixer.clipAction(clip);action.play();
 const samples=[];const steps=Math.max(4,Math.round(clip.duration*4));
 for(let i=0;i<=steps;i++){const t=Math.min(clip.duration-1e-4,clip.duration*i/steps);action.time=t;mixer.update(0);scene.updateMatrixWorld(true);samples.push({t:+t.toFixed(2),...facing()});}
 const mean=key=>+(samples.reduce((a,s)=>a+s[key],0)/samples.length).toFixed(1);
 report.clips[clip.name]={duration:+clip.duration.toFixed(3),meanShoulderYaw:mean('shoulderYaw'),meanPelvisYaw:mean('pelvisYaw'),meanHeadYaw:mean('headYaw'),meanHipsYaw:mean('hipsYaw'),meanLeftFootYaw:mean('leftFootYaw'),meanRightFootYaw:mean('rightFootYaw'),samples:samples.length<=8?samples:samples.filter((_,i)=>i%Math.ceil(samples.length/8)===0)};
}
// Left-arm angular speed through idle and block at 60 Hz: find twitches.
for(const name of ['idle','block']){const clip=gltf.animations.find(c=>c.name===name);if(!clip)continue;mixer.stopAllAction();const action=mixer.clipAction(clip);action.play();
 const chain={lArm:B.lArm,lForeArm:B.lForeArm,lHand:B.lHand};const prev={};const speeds=[];
 for(let t=0;t<=clip.duration;t+=1/60){action.time=Math.min(t,clip.duration-1e-4);mixer.update(0);scene.updateMatrixWorld(true);const row={t:+t.toFixed(3)};
  for(const [k,bone] of Object.entries(chain)){if(!bone)continue;const q=bone.getWorldQuaternion(new Quaternion());if(prev[k]){row[k]=+(2*Math.acos(Math.min(1,Math.abs(q.dot(prev[k]))))*180/Math.PI*60).toFixed(1);}prev[k]=q;}
  speeds.push(row);}
 const peaks={};for(const k of Object.keys(chain)){const sorted=speeds.filter(r=>r[k]!==undefined).sort((a,b)=>b[k]-a[k]);peaks[k]={maxDegPerSec:sorted[0]?.[k],at:sorted.slice(0,5).map(r=>r.t),median:sorted[Math.floor(sorted.length/2)]?.[k]};}
 report.clips[name].leftArmAngularSpeed=peaks;
}
// Shield socket and forearm frame in idle and block.
for(const name of ['idle','block']){const clip=gltf.animations.find(c=>c.name===name);if(!clip||!B.shieldSocket)continue;mixer.stopAllAction();const action=mixer.clipAction(clip);action.play();action.time=Math.min(1,clip.duration/2);mixer.update(0);scene.updateMatrixWorld(true);
 const m=B.shieldSocket.matrixWorld,axis=i=>new Vector3().setFromMatrixColumn(m,i).normalize().toArray().map(v=>+v.toFixed(3));
 const forearm=worldPos(B.lHand).sub(worldPos(B.lForeArm)).normalize().toArray().map(v=>+v.toFixed(3));
 report.clips[name].shieldSocket={parent:B.shieldSocket.parent?.name,position:worldPos(B.shieldSocket).toArray().map(v=>+v.toFixed(3)),x:axis(0),y:axis(1),z:axis(2),forearmDirection:forearm,handPosition:worldPos(B.lHand).toArray().map(v=>+v.toFixed(3)),headPosition:worldPos(B.head).toArray().map(v=>+v.toFixed(3)),hipsPosition:worldPos(B.hips).toArray().map(v=>+v.toFixed(3))};}
const shield=await loadGLB(SHIELD);shield.scene.updateMatrixWorld(true);const box=new Box3().setFromObject(shield.scene);report.shieldAsset={size:box.getSize(new Vector3()).toArray().map(v=>+v.toFixed(3)),min:box.min.toArray().map(v=>+v.toFixed(3))};
const bodyBox=new Box3().setFromObject(scene);report.bodyAsset={size:bodyBox.getSize(new Vector3()).toArray().map(v=>+v.toFixed(3))};
writeFileSync(ADJUST?'docs/player-combat-revision/pose-inspection-adjusted.json':'docs/player-combat-revision/pose-inspection.json',JSON.stringify(report,null,1));
const {samples:_,...rest}=report.clips.idle;
console.log(JSON.stringify({missing,restFacing:report.restFacing,shieldAsset:report.shieldAsset,bodyAsset:report.bodyAsset,idle:rest,block:{...report.clips.block,samples:undefined},facingByClip:Object.fromEntries(Object.entries(report.clips).map(([k,v])=>[k,{shoulder:v.meanShoulderYaw,pelvis:v.meanPelvisYaw,head:v.meanHeadYaw,hips:v.meanHipsYaw,lFoot:v.meanLeftFootYaw,rFoot:v.meanRightFootYaw}]))},null,1));
