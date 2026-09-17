import {Box3,Matrix4,Quaternion,Vector3} from 'three';

/** The shield slips out of the dead player's hand and falls (user request, 16 Sep 2026).
 *
 * `releaseAt` seconds into the death the shield leaves the ShieldSocket for the scene, keeping
 * its world pose, and becomes a small rigid body: gravity, a push off the left forearm, spin,
 * and contact against the flat fighting floor (y = `floorY`) tested at the eight corners of its
 * own bounding box. Each contact bounces and scrubs speed; after the first one a settling torque
 * turns the thin axis toward vertical, so the slab ends lying flat instead of balanced on an
 * edge. reset() puts it back in the hand with its authored mount for the next attempt.
 */
const DEFAULTS={releaseAt:.38,gravity:9.81,floorY:.012,bounce:.28,friction:.55,spin:.55,settleRate:4.2,push:[1.05,.35,.45]};
const UP=new Vector3(0,1,0);

export class ShieldDrop{
 constructor(actor,options={}){
  this.actor=actor;this.shield=actor.shield;this.options={...DEFAULTS,...options};
  this.home=this.shield.parent;this.homePosition=this.shield.position.clone();this.homeQuaternion=this.shield.quaternion.clone();this.homeScale=this.shield.scale.clone();
  this.velocity=new Vector3();this.spin=new Vector3();this.corners=null;this.thinAxis=new Vector3();
  this.dropped=false;this.touched=false;this.resting=false;
 }
 /** Corners and the thin axis in the shield's own frame, measured once from its vertices. */
 measure(){
  const inverse=new Matrix4().copy(this.shield.matrixWorld).invert(),box=new Box3(),p=new Vector3();
  this.shield.traverse(n=>{if(!n.isMesh)return;const a=n.geometry.attributes.position;const m=new Matrix4().multiplyMatrices(inverse,n.matrixWorld);
   for(let i=0;i<a.count;i+=3){p.fromBufferAttribute(a,i).applyMatrix4(m);box.expandByPoint(p);}});
  const {min,max}=box;this.corners=[];
  for(const x of [min.x,max.x])for(const y of [min.y,max.y])for(const z of [min.z,max.z])this.corners.push(new Vector3(x,y,z));
  const size=box.getSize(new Vector3());
  this.thinAxis.set(0,0,0).setComponent(size.x<=size.y&&size.x<=size.z?0:size.y<=size.z?1:2,1);
 }
 release(){
  const shield=this.shield,scene=this.actor.root.parent;if(!scene)return;
  shield.updateMatrixWorld(true);if(!this.corners)this.measure();
  scene.attach(shield);// keeps the world pose, scale included
  const yaw=this.actor.root.rotation.y,[side,up,forward]=this.options.push;
  // rigs face +Z and their left is +X
  this.velocity.set(side,up,forward).applyAxisAngle(UP,yaw);
  this.spin.set(-2.2,.9,3.1).applyAxisAngle(UP,yaw).multiplyScalar(this.options.spin);
  this.dropped=true;this.touched=false;this.resting=false;
 }
 update(dt,dead,deathTime){
  if(!this.dropped){if(dead&&deathTime>=this.options.releaseAt)this.release();else return;}
  if(this.resting||!this.dropped)return;
  const o=this.options,shield=this.shield;dt=Math.min(dt,1/30);
  this.velocity.y-=o.gravity*dt;
  shield.position.addScaledVector(this.velocity,dt);
  const angle=this.spin.length()*dt;
  if(angle>1e-6){const q=new Quaternion().setFromAxisAngle(this.spin.clone().normalize(),angle);shield.quaternion.premultiply(q).normalize();}
  if(this.touched){
   // tip the thin axis toward vertical (face down or face up, whichever is nearer)
   const normal=this.thinAxis.clone().applyQuaternion(shield.quaternion);
   const target=normal.y>=0?UP:UP.clone().negate();
   const q=new Quaternion().setFromUnitVectors(normal,target);
   const settle=new Quaternion().slerp(q,Math.min(1,o.settleRate*dt));
   shield.quaternion.premultiply(settle).normalize();
  }
  shield.updateMatrixWorld(true);
  let lowest=Infinity;const p=new Vector3();
  for(const c of this.corners){p.copy(c).applyMatrix4(shield.matrixWorld);lowest=Math.min(lowest,p.y);}
  const depth=o.floorY-lowest;
  if(depth>0){
   shield.position.y+=depth;
   if(this.velocity.y<0)this.velocity.y*=-o.bounce;
   this.velocity.x*=o.friction;this.velocity.z*=o.friction;this.spin.multiplyScalar(o.friction);
   this.touched=true;
   if(Math.abs(this.velocity.y)<.25){this.velocity.y=0;
    const flat=Math.abs(this.thinAxis.clone().applyQuaternion(shield.quaternion).y);
    if(flat>.995&&this.velocity.lengthSq()<.0004)this.resting=true;}
  }
 }
 reset(){
  if(!this.dropped)return;
  this.home.add(this.shield);
  this.shield.position.copy(this.homePosition);this.shield.quaternion.copy(this.homeQuaternion);this.shield.scale.copy(this.homeScale);
  this.velocity.set(0,0,0);this.spin.set(0,0,0);this.dropped=this.touched=this.resting=false;
 }
}

/** Null when the shield is not held by a socket (the unrigged fallback keeps it on the root). */
export function createShieldDrop(actor,options){
 if(!actor.shield||!actor.shield.parent||actor.shield.parent===actor.root)return null;
 return new ShieldDrop(actor,options);
}
