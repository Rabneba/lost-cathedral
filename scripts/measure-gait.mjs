// Gait character of a locomotion clip: knee bend, torso lean, pelvis and shoulder rotation,
// arm swing and lateral sway, sampled at 60 Hz. Compares candidate runs against the rejected
// march. VESPER_RIG (comma list), VESPER_CLIP (default run-forward).
import {AnimationMixer, Vector3, Matrix4, MathUtils} from 'three';
import {loadGLB} from './load-glb-node.mjs';
const RIGS=(process.env.VESPER_RIG||'assets/player-attack-revision/player-video-candidate-v9.glb').split(','),CLIP=process.env.VESPER_CLIP||'run-forward';
const angle=(a,b,c)=>{const u=a.clone().sub(b).normalize(),v=c.clone().sub(b).normalize();return MathUtils.radToDeg(Math.acos(MathUtils.clamp(u.dot(v),-1,1)));};
const yawDeg=v=>MathUtils.radToDeg(Math.atan2(v.x,v.z));
const range=arr=>+(Math.max(...arr)-Math.min(...arr)).toFixed(1),mean=arr=>+(arr.reduce((a,b)=>a+b,0)/arr.length).toFixed(1),min=arr=>+Math.min(...arr).toFixed(1);
for(const rig of RIGS){
 const gltf=await loadGLB(rig),scene=gltf.scene;scene.updateMatrixWorld(true);const clip=gltf.animations.find(c=>c.name===CLIP);if(!clip){console.log(rig,'no',CLIP);continue;}
 const b=n=>scene.getObjectByName('mixamorig'+n),P=n=>b(n).getWorldPosition(new Vector3());
 const restForward=bone=>{const inv=new Matrix4().extractRotation(bone.matrixWorld).invert();return new Vector3(0,0,1).applyMatrix4(inv).normalize();};const hipsF=restForward(b('Hips')),spineF=restForward(b('Spine2'));
 const mixer=new AnimationMixer(scene),action=mixer.clipAction(clip);action.play();
 const s={lKnee:[],rKnee:[],lElbow:[],rElbow:[],lean:[],pelvisYaw:[],shoulderYaw:[],hipX:[],hipY:[],headY:[],lHandZ:[],rHandZ:[],stride:[]};
 for(let t=0;t<clip.duration;t+=1/60){action.time=t;mixer.update(0);scene.updateMatrixWorld(true);
  s.lKnee.push(180-angle(P('LeftUpLeg'),P('LeftLeg'),P('LeftFoot')));s.rKnee.push(180-angle(P('RightUpLeg'),P('RightLeg'),P('RightFoot')));
  s.lElbow.push(180-angle(P('LeftArm'),P('LeftForeArm'),P('LeftHand')));s.rElbow.push(180-angle(P('RightArm'),P('RightForeArm'),P('RightHand')));
  const up=P('Neck').sub(P('Hips')).normalize();s.lean.push(MathUtils.radToDeg(Math.atan2(up.z,up.y)));
  s.pelvisYaw.push(yawDeg(hipsF.clone().transformDirection(b('Hips').matrixWorld).setY(0)));
  s.shoulderYaw.push(yawDeg(P('LeftArm').sub(P('RightArm')).setY(0).normalize().cross(new Vector3(0,1,0))));
  const h=P('Hips');s.hipX.push(h.x*100);s.hipY.push(h.y*100);s.headY.push(P('Head').y*100);
  s.lHandZ.push((P('LeftHand').z-h.z)*100);s.rHandZ.push((P('RightHand').z-h.z)*100);s.stride.push(Math.abs(P('LeftFoot').z-P('RightFoot').z)*100);}
 console.log(`\n${rig} · ${CLIP} ${clip.duration.toFixed(2)} s`);
 console.log(` knee bend      L ${min(s.lKnee)}–${(+min(s.lKnee)+range(s.lKnee)).toFixed(1)}°  R ${min(s.rKnee)}–${(+min(s.rKnee)+range(s.rKnee)).toFixed(1)}°  (min = how straight the leg gets; range = swing)`);
 console.log(` elbow bend     L mean ${mean(s.lElbow)}° range ${range(s.lElbow)}   R mean ${mean(s.rElbow)}° range ${range(s.rElbow)}`);
 console.log(` torso lean     mean ${mean(s.lean)}° (forward +) range ${range(s.lean)}`);
 console.log(` pelvis yaw     range ${range(s.pelvisYaw)}°   shoulder yaw range ${range(s.shoulderYaw)}°   counter-rotation ${range(s.pelvisYaw.map((v,i)=>v-s.shoulderYaw[i]))}°`);
 console.log(` hip sway x     ${range(s.hipX)} cm   hip bob ${range(s.hipY)} cm   head bob ${range(s.headY)} cm`);
 console.log(` hand swing z   L ${range(s.lHandZ)} cm  R ${range(s.rHandZ)} cm   stride (foot z spread) max ${Math.max(...s.stride).toFixed(0)} cm`);
}
