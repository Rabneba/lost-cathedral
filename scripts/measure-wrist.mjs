// Wrist plausibility: angle between the forearm (elbow->wrist) and the hand's bind-relative
// orientation, split into swing (flex/deviation) and twist about the forearm axis, plus the
// blade-to-forearm angle. Large swing or twist reads as a hand turned inside out.
// VESPER_RIG (comma list), VESPER_CLIPS, VESPER_STEP.
import {AnimationMixer, Vector3, Quaternion, Matrix4, MathUtils} from 'three';
import {loadGLB} from './load-glb-node.mjs';
const RIGS=(process.env.VESPER_RIG||'').split(',').filter(Boolean),CLIPS=(process.env.VESPER_CLIPS||'light,heavy').split(','),STEP=+(process.env.VESPER_STEP||.1);
for(const rig of RIGS){const gltf=await loadGLB(rig),scene=gltf.scene;scene.updateMatrixWorld(true);
 const fore=scene.getObjectByName('mixamorigRightForeArm'),hand=scene.getObjectByName('mixamorigRightHand'),socket=scene.getObjectByName('WeaponSocket');
 // Bind: hand rotation relative to the forearm, and the forearm axis in forearm-local space.
 const bindRel=fore.getWorldQuaternion(new Quaternion()).invert().multiply(hand.getWorldQuaternion(new Quaternion()));
 const foreAxisLocal=hand.getWorldPosition(new Vector3()).sub(fore.getWorldPosition(new Vector3())).normalize().applyQuaternion(fore.getWorldQuaternion(new Quaternion()).invert());
 const mixer=new AnimationMixer(scene);
 for(const name of CLIPS){const clip=gltf.animations.find(c=>c.name===name);if(!clip)continue;mixer.stopAllAction();const a=mixer.clipAction(clip);a.play();
  console.log(`\n${rig} ${name}: t  swing  twist  blade-vs-forearm (deg)`);let maxSwing=0,maxTwist=0;
  for(let t=0;t<clip.duration;t+=STEP){a.time=t;mixer.update(0);scene.updateMatrixWorld(true);
   const rel=fore.getWorldQuaternion(new Quaternion()).invert().multiply(hand.getWorldQuaternion(new Quaternion()));
   const delta=bindRel.clone().invert().multiply(rel);// wrist rotation away from bind, in forearm space
   // swing/twist decomposition about the forearm axis
   const axis=foreAxisLocal,v=new Vector3(delta.x,delta.y,delta.z),proj=axis.clone().multiplyScalar(v.dot(axis));const twistQ=new Quaternion(proj.x,proj.y,proj.z,delta.w).normalize();const swingQ=delta.clone().multiply(twistQ.clone().invert());
   const twist=MathUtils.radToDeg(2*Math.acos(Math.min(1,Math.abs(twistQ.w)))),swing=MathUtils.radToDeg(2*Math.acos(Math.min(1,Math.abs(swingQ.w))));
   const foreDir=hand.getWorldPosition(new Vector3()).sub(fore.getWorldPosition(new Vector3())).normalize();const blade=socket?new Vector3(0,0,1).transformDirection(socket.matrixWorld).normalize():null;
   const bva=blade?MathUtils.radToDeg(Math.acos(MathUtils.clamp(blade.dot(foreDir),-1,1))):NaN;
   maxSwing=Math.max(maxSwing,swing);maxTwist=Math.max(maxTwist,twist);
   console.log(t.toFixed(2).padStart(5),swing.toFixed(0).padStart(6),twist.toFixed(0).padStart(6),bva.toFixed(0).padStart(8));}
  console.log(`  max swing ${maxSwing.toFixed(0)}  max twist ${maxTwist.toFixed(0)}`);}}
