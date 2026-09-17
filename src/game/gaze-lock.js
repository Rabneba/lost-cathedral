import * as T from 'three';
/** Turns the neck and head on top of the captured clip so the gaze follows the lock-on
 * opponent (or the gameplay facing when no target is set). Captured performers look at
 * their own camera or off to the side; the game needs the eyes on the boss. The correction
 * fades out when the head is pitched steeply (rolls), when the target is far behind, and
 * for clips that pass a zero weight (dodge, death). Verify with the cyan facing line. */
const UP=new T.Vector3(0,1,0),TAU=Math.PI*2;
function restForward(bone){const inverse=new T.Matrix4().extractRotation(bone.matrixWorld).invert();return new T.Vector3(0,0,1).applyMatrix4(inverse).normalize();}
const wrap=a=>a-Math.round(a/TAU)*TAU;
export class GazeLock{
 constructor(body,root,{limit=70,fade=40,neckShare=.35,response=16}={}){
  this.root=root;this.enabled=true;this.target=null;this.angle=0;this.applied=null;
  this.limit=T.MathUtils.degToRad(limit);this.fade=T.MathUtils.degToRad(fade);this.neckShare=neckShare;this.response=response;
  this.head=body.getObjectByName('mixamorigHead');this.neck=body.getObjectByName('mixamorigNeck');
  root.updateMatrixWorld(true);
  this.headForward=this.head?restForward(this.head):null;
 }
 reset(){this.angle=0;this.applied=null;}
 /** Clip weights that should switch the gaze off. */
 static weight(layers,names=['dodge','death']){let w=1;if(layers)for(const [name,layer] of layers)if(names.includes(name))w-=layer.weight;return T.MathUtils.clamp(w,0,1);}
 /** Current yaw error of the head to the target in degrees before this frame's correction. */
 get error(){return T.MathUtils.radToDeg(this.lastError||0);}
 update(dt,{layers=null,weight=null,raw=false}={}){
  if(!this.head||!this.enabled||raw){this.angle=0;this.lastError=0;return;}
  const w=weight??GazeLock.weight(layers);
  const headPosition=this.head.getWorldPosition(new T.Vector3());
  const forward=this.headForward.clone().transformDirection(this.head.matrixWorld);
  const level=Math.hypot(forward.x,forward.z);
  let targetYaw;
  if(this.target){const dx=this.target.x-headPosition.x,dz=this.target.z-headPosition.z;if(dx*dx+dz*dz<1e-4){this.angle=0;return;}targetYaw=Math.atan2(dx,dz);}
  else targetYaw=this.root.rotation.y;
  const delta=wrap(targetYaw-Math.atan2(forward.x,forward.z));this.lastError=delta;
  // Faded, not clamped: a target beyond the neck's reach must not produce an owl neck.
  const reach=1-T.MathUtils.smoothstep(Math.abs(delta),this.limit,this.limit+this.fade),upright=T.MathUtils.smoothstep(level,.35,.6);
  const desired=T.MathUtils.clamp(delta,-this.limit,this.limit)*w*reach*upright;
  const k=dt>0?1-Math.exp(-dt*this.response):1;this.angle+=(desired-this.angle)*k;
  if(Math.abs(this.angle)<1e-5)return;
  const chain=this.neck?[[this.neck,this.neckShare],[this.head,1-this.neckShare]]:[[this.head,1]];
  for(const [bone,share] of chain){
   const parentInverse=bone.parent.getWorldQuaternion(new T.Quaternion()).invert(),axis=UP.clone().applyQuaternion(parentInverse).normalize();
   bone.quaternion.premultiply(new T.Quaternion().setFromAxisAngle(axis,this.angle*share));bone.updateMatrixWorld(true);
  }
 }
}
