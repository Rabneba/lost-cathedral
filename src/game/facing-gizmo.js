import * as T from 'three';
/** World-space arrows for reviewing orientation: where the head looks (cyan), where the
 * pelvis faces (amber) and where the gameplay root faces (white). Hidden by default. */
const UP=new T.Vector3(0,1,0);
function restForward(bone){
 // Which local axis of this bone points along the model's +Z in the bind pose.
 const inverse=new T.Matrix4().extractRotation(bone.matrixWorld).invert();
 return new T.Vector3(0,0,1).applyMatrix4(inverse).normalize();
}
function arrow(color,length){const a=new T.ArrowHelper(new T.Vector3(0,0,1),new T.Vector3(),length,color,.18,.09);a.line.material.depthTest=false;a.cone.material.depthTest=false;a.renderOrder=999;return a;}
export class FacingGizmo{
 constructor(actor){
  this.actor=actor;this.group=new T.Group();this.group.name='Facing lines';this.group.visible=false;
  this.head=actor.body.getObjectByName('mixamorigHead');this.hips=actor.body.getObjectByName('mixamorigHips');
  actor.root.updateMatrixWorld(true);
  this.headForward=this.head?restForward(this.head):null;this.hipsForward=this.hips?restForward(this.hips):null;
  this.arrows={head:arrow(0x6fe3ff,1.1),body:arrow(0xffb347,1.1),root:arrow(0xffffff,1.6)};
  for(const a of Object.values(this.arrows))this.group.add(a);
 }
 get visible(){return this.group.visible;}
 set visible(value){this.group.visible=value;}
 /** Yaw in degrees of each arrow, relative to the root's facing; positive is the model's left. */
 measure(){
  const rootYaw=this.actor.root.rotation.y,yaw=v=>{const a=(Math.atan2(v.x,v.z)-rootYaw)*180/Math.PI;return ((a+540)%360)-180;};
  const out={root:0};
  if(this.head)out.head=yaw(this.headForward.clone().transformDirection(this.head.matrixWorld).setY(0).normalize());
  if(this.hips)out.body=yaw(this.hipsForward.clone().transformDirection(this.hips.matrixWorld).setY(0).normalize());
  return out;
 }
 update(){
  if(!this.group.visible)return;
  const root=this.actor.root;
  if(this.head){const d=this.headForward.clone().transformDirection(this.head.matrixWorld).setY(0).normalize();this.arrows.head.position.copy(this.head.getWorldPosition(new T.Vector3()));this.arrows.head.setDirection(d);}
  if(this.hips){const d=this.hipsForward.clone().transformDirection(this.hips.matrixWorld).setY(0).normalize();this.arrows.body.position.copy(this.hips.getWorldPosition(new T.Vector3()));this.arrows.body.setDirection(d);}
  const forward=new T.Vector3(0,0,1).applyAxisAngle(UP,root.rotation.y);
  this.arrows.root.position.copy(root.getWorldPosition(new T.Vector3())).add(new T.Vector3(0,.03,0));this.arrows.root.setDirection(forward);
 }
}
