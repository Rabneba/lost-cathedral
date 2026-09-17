// Solve a centre-grip shield mount in the ShieldSocket frame: face normal along the fist
// (wrist to middle knuckle), height axis as vertical as the idle pose allows.
import {AnimationMixer, Matrix4, Quaternion, Vector3, Euler} from 'three';
import {loadGLB} from './load-glb-node.mjs';
const gltf=await loadGLB('assets/player-combat-revision/player-video-candidate-v6.glb'),scene=gltf.scene;
const find=re=>{let hit=null;scene.traverse(n=>{if(!hit&&re.test(n.name))hit=n;});return hit;};
const hand=find(/LeftHand$/),knuckle=find(/LeftHandMiddle1$/),fore=find(/LeftForeArm$/),socket=find(/ShieldSocket$/);
console.log('socket local pos',socket.position.toArray().map(v=>+v.toFixed(3)),'rot',new Euler().setFromQuaternion(socket.quaternion).toArray().slice(0,3).map(v=>+(v*180/Math.PI).toFixed(1)),'scale',socket.scale.toArray().map(v=>+v.toFixed(3)));
const mixer=new AnimationMixer(scene);
for(const [name,t] of [['idle',1],['block',1],['idle',2.5],['light',.5]]){
 mixer.stopAllAction();const a=mixer.clipAction(gltf.animations.find(c=>c.name===name));a.play();a.time=t;mixer.update(0);scene.updateMatrixWorld(true);
 const P=o=>o.getWorldPosition(new Vector3());
 const n=P(knuckle).sub(P(hand)).normalize(),f=P(hand).sub(P(fore)).normalize();
 // The fist in this guard points 43 degrees upward. A shield strapped to it would face the
 // ceiling, so the face keeps the fist's heading but is pitched only PITCH degrees up,
 // and the boss hangs DROP metres below the fist along the shield's own height axis.
 const PITCH=Number(process.env.SHIELD_PITCH??18)*Math.PI/180,DROP=Number(process.env.SHIELD_DROP??.12),FORWARD=Number(process.env.SHIELD_FORWARD??.09);
 const heading=n.clone().setY(0).normalize();n.copy(heading.multiplyScalar(Math.cos(PITCH)).add(new Vector3(0,Math.sin(PITCH),0))).normalize();
 const up=new Vector3(0,1,0),u=up.clone().sub(n.clone().multiplyScalar(up.dot(n))).normalize(),s=new Vector3().crossVectors(u,n).normalize();
 const desired=new Matrix4().makeBasis(s,u,n);// prop frame: X width, Y height, Z face normal
 const socketRot=new Matrix4().extractRotation(socket.matrixWorld),local=socketRot.clone().invert().multiply(desired);
 const q=new Quaternion().setFromRotationMatrix(local),e=new Euler().setFromQuaternion(q);
 const socketInv=socket.matrixWorld.clone().invert();
 const center=P(hand).add(n.clone().multiplyScalar(FORWARD)).sub(u.clone().multiplyScalar(DROP));const localPos=center.clone().applyMatrix4(socketInv);
 console.log(name,'t='+t,'knuckleDir',n.toArray().map(v=>+v.toFixed(2)),'forearmDir',f.toArray().map(v=>+v.toFixed(2)),'angle knuckle/forearm',(Math.acos(n.dot(f))*180/Math.PI).toFixed(1),'\n  local quat',q.toArray().map(v=>+v.toFixed(4)),'euler deg',e.toArray().slice(0,3).map(v=>+(v*180/Math.PI).toFixed(1)),'\n  local pos',localPos.toArray().map(v=>+v.toFixed(3)),'socket world scale',new Vector3().setFromMatrixScale(socket.matrixWorld).toArray().map(v=>+v.toFixed(3)));
}
