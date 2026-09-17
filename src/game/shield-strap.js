import {Box3,Matrix4,Quaternion,Vector3} from 'three';

/** Keeps the shield strapped to the left forearm through the roll.
 *
 * The shield is parented to the ShieldSocket under the left hand bone, which is the
 * right place for the guard: the fist holds the grip. During the shoulder roll the
 * captured wrist whips through a full tumble, and a 1.5 m shield on that lever arm
 * swung 0.7-0.9 m out to the side, jumped up to 16 cm in a single frame and drove
 * 23 cm through the floor. A real shield is strapped to the forearm, so for the
 * tumbling part of the clip the pose is derived from mixamorigLeftForeArm with a
 * fixed offset - captured once from the authored guard mount, so the strap matches
 * the shield the player sees in the stance - and blended in and out in about 0.1 s.
 *
 * The forearm still passes under the body mid-tumble, so the strap keeps the freedom
 * a shield has on its enarmes: it may swing about the forearm's own axis, tip on the straps
 * by up to `maxTilt`, and ride up to `lift` along the arm. Each frame the smallest such correction that lifts
 * every corner off the flagstones is solved, damped at `fixRate` so nothing pops, and
 * decays back to nothing as the character stands up.
 *
 * Clearing the floor is not enough to be watchable. A 1.545 m shield that clears the
 * flagstones but lies broadside across the view covers the whole (very dark) character
 * from the gameplay camera for half the roll, so the dodge reads as a shield dropped on the
 * ground with nobody behind it. Among the swings that clear the floor the solver therefore
 * takes the one that presents the shield closest to edge-on *to the camera that is actually
 * looking at it*: it minimises |faceNormal . viewDirection|, which is the shield's projected
 * silhouette area, so the slab becomes a thin sliver however the player has orbited.
 *
 * "Horizontal face normal" was tried first and is not the same objective. For a side roll the
 * tumble axis lies along the view, so a horizontal normal frequently points straight at the
 * camera: a left roll then laid the full 1.5 m face across the screen at ~0.25 s. The view
 * direction is captured from the render itself (`onBeforeRender` on the shield's own mesh,
 * ignoring the puddle mirror's camera below the floor), so nothing has to be threaded through
 * actors.js or main.js; offline audits set it with `setView()`, and with neither the solver
 * falls back to the old horizontal-normal target.
 *
 * The chosen swing is also rate limited (`swingRate`), so a frame where the argmax flips
 * travels to the new swing instead of teleporting: round 2 dumped 109 degrees of swing in the
 * single frame the gate closed at the stand-up, and the damping smeared that into six frames
 * of the shield being whipped back into guard. The limit yields only to the floor, which is
 * the one hard constraint; for the same reason the damping itself yields when the pose it is
 * lagging behind would put a corner further under the flagstones than `lift` can rescue.
 */
const DEFAULTS={probeDirections:320,clearance:.02,fixRate:18,fixDamping:26,candidates:17,maxSwing:1.9,maxTilt:.6,pull:1,lift:.1,iterations:3,
 readability:1,continuity:.35,rest:.9,swingRate:5,readableBelow:.55,readableAbove:.85,watchCamera:true,minCameraHeight:.2};
const UP=new Vector3(0,1,0);
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const wrap=angle=>Math.atan2(Math.sin(angle),Math.cos(angle));

/** Returns null when the rig has no forearm bone or the shield hangs off the root. */
export function createShieldStrap(actor,options){
 const forearm=actor.body?.getObjectByName?.('mixamorigLeftForeArm');
 const hand=actor.body?.getObjectByName?.('mixamorigLeftHand');
 const shield=actor.shield;
 if(!forearm||!hand||!shield||!shield.parent||shield.parent===actor.root)return null;
 return new ShieldStrap(shield,forearm,hand,options);
}

export class ShieldStrap{
 /** Call with the shield already sitting at its authored guard mount. */
 constructor(shield,forearm,hand,options={}){
  Object.assign(this,DEFAULTS,options);
  this.shield=shield;this.socket=shield.parent;this.forearm=forearm;this.hand=hand;
  this.mount={position:shield.position.clone(),quaternion:shield.quaternion.clone()};
  this.fix=new Quaternion();this.spinHint=0;this.weight=0;this.correction=0;this.floor=Infinity;
  // The direction the shield is being looked along. UP until a camera is seen, which
  // reproduces the old horizontal-normal target for headless callers that never render.
  this.view=UP.clone();this.hasView=false;this.step=0;
  shield.updateMatrixWorld(true);
  // Real surface extremes in 26 directions, rather than a bounding box whose corners
  // are empty air: the solver then fights the shield's actual silhouette.
  const box=new Box3(),inverse=shield.matrixWorld.clone().invert(),point=new Vector3();
  const directions=[],golden=Math.PI*(3-Math.sqrt(5));
  for(let index=0;index<this.probeDirections;index++){
   const y=1-2*(index+.5)/this.probeDirections,radius=Math.sqrt(Math.max(0,1-y*y)),angle=golden*index;
   directions.push(new Vector3(Math.cos(angle)*radius,y,Math.sin(angle)*radius));
  }
  const best=directions.map(()=>({value:-Infinity,point:new Vector3()}));
  shield.traverse(mesh=>{
   if(!mesh.isMesh||!mesh.geometry?.attributes?.position)return;
   const matrix=inverse.clone().multiply(mesh.matrixWorld),attribute=mesh.geometry.attributes.position;
   for(let index=0;index<attribute.count;index++){
    point.fromBufferAttribute(attribute,index).applyMatrix4(matrix);box.expandByPoint(point);
    for(let d=0;d<directions.length;d++){const value=point.dot(directions[d]);if(value>best[d].value){best[d].value=value;best[d].point.copy(point);}}
   }
  });
  // Deduplicate: a flat slab returns the same vertex for many nearby directions.
  this.corners=[];
  for(const entry of best)if(entry.value>-Infinity&&!this.corners.some(point=>point.distanceToSquared(entry.point)<1e-6))this.corners.push(entry.point);
  this.centre=box.getCenter(new Vector3());
  // The slab's thinnest axis is its face normal: the direction that must stay near
  // perpendicular to the view for the shield to read as a sliver rather than a wall.
  const extent=box.getSize(new Vector3());
  this.faceAxis=new Vector3(extent.x<=extent.y&&extent.x<=extent.z?1:0,extent.y<extent.x&&extent.y<=extent.z?1:0,0);
  if(this.faceAxis.lengthSq()===0)this.faceAxis.set(0,0,1);
  this.offset=new Matrix4().copy(forearm.matrixWorld).invert().multiply(shield.matrixWorld);
  if(this.pull!==1)this.pullToArm(this.pull);
  this.probes=this.corners.map(()=>new Vector3());
  this.scratch={target:new Matrix4(),world:new Matrix4(),local:new Matrix4(),rotation:new Matrix4(),shift:new Matrix4(),
   pivot:new Vector3(),axis:new Vector3(),radius:new Vector3(),tiltAxis:new Vector3(),point:new Vector3(),
   normal:new Vector3(),turned:new Vector3(),applied:new Quaternion(),
   position:new Vector3(),quaternion:new Quaternion(),scale:new Vector3(),step:new Quaternion(),wanted:new Quaternion()};
  this.angles=[];
  if(this.watchCamera)this.watchRender();
 }

 /** Sets the world-space direction the shield is looked along (audits, tests, the studio). */
 setView(direction){
  if(!direction||!(direction.lengthSq?.()>0)){this.hasView=false;this.view.copy(UP);return;}
  this.view.copy(direction).normalize();this.hasView=true;this.watchCamera=false;
 }

 /** Reads the view direction out of the render instead of threading a camera through
  * actors.js and main.js. One frame stale at 60 Hz, which is invisible; the puddle mirror
  * renders the same mesh from a virtual camera below the floor, so cameras under
  * `minCameraHeight` are ignored. */
 watchRender(){
  let mesh=null;this.shield.traverse(node=>{if(!mesh&&node.isMesh)mesh=node;});
  if(!mesh)return;
  const strap=this,previous=mesh.onBeforeRender;
  mesh.onBeforeRender=function(renderer,scene,camera,...rest){
   if(strap.watchCamera&&camera?.isCamera&&camera.getWorldDirection&&camera.position.y>strap.minCameraHeight){
    camera.getWorldDirection(strap.view);
    if(strap.view.lengthSq()>1e-8){strap.view.normalize();strap.hasView=true;}
   }
   if(previous)previous.call(this,renderer,scene,camera,...rest);
  };
 }

 /** Draws the shield's centre toward the forearm's own axis without sliding it along the arm. */
 pullToArm(pull){
  const axis=this.forearm.worldToLocal(this.hand.getWorldPosition(new Vector3())).normalize();
  const centre=this.centre.clone().applyMatrix4(this.offset);
  const radial=centre.clone().addScaledVector(axis,-centre.dot(axis)).multiplyScalar(pull-1);
  this.offset.premultiply(new Matrix4().makeTranslation(radial.x,radial.y,radial.z));
 }

 /** Lowest probe height, with the probes already in world space. */
 lowest(){
  let floor=Infinity,index=0;
  for(let i=0;i<this.probes.length;i++)if(this.probes[i].y<floor){floor=this.probes[i].y;index=i;}
  return{floor,index};
 }

 /** Places every surface probe at `target` rotated by `rotation` about the pivot. */
 place(rotation){
  const {target,pivot}=this.scratch;
  for(let i=0;i<this.corners.length;i++)this.probes[i].copy(this.corners[i]).applyMatrix4(target).sub(pivot).applyQuaternion(rotation).add(pivot);
 }

 /** How hard the presentation term pulls: only while the strap is engaged, and faded out
  * by the elbow's own height, so the guard stance and the stand-up keep the authored pose. */
 readabilityWeight(elbow){
  if(!(this.readability>0)||!(this.weight>0))return 0;
  const t=clamp((elbow-this.readableBelow)/(this.readableAbove-this.readableBelow),0,1);
  return this.readability*this.weight*(1-t*t*(3-2*t));
 }

 /** The swings about the forearm that put the shield's face normal perpendicular to `target`,
  * i.e. present the slab edge-on to it. Rodrigues about `axis` gives
  * n(t).target = A cos t + B sin t + C, so the roots are phase +- acos(-C/radius).
  * Empty when the arm's own tilt puts them out of reach. */
 edgeOnAngles(axis,normal,target){
  const alongAxis=axis.dot(normal),alongTarget=axis.dot(target);
  const A=normal.dot(target)-alongAxis*alongTarget;
  const B=(axis.y*normal.z-axis.z*normal.y)*target.x+(axis.z*normal.x-axis.x*normal.z)*target.y+(axis.x*normal.y-axis.y*normal.x)*target.z;
  const C=alongAxis*alongTarget;
  const radius=Math.hypot(A,B);
  if(radius<1e-6||Math.abs(C)>radius)return [];
  const phase=Math.atan2(B,A),spread=Math.acos(clamp(-C/radius,-1,1));
  return [wrap(phase+spread),wrap(phase-spread)].filter(angle=>Math.abs(angle)<=this.maxSwing);
 }

 /** Lowest probe height with the strap swung by `angle` about the forearm. */
 floorAt(angle){
  this.place(this.scratch.quaternion.setFromAxisAngle(this.scratch.axis,angle));
  return this.lowest().floor;
 }

 /** The swing-and-tip of the strap that lifts the shield off the floor and, while it is
  * low enough to hide the character, presents it edge-on to the camera. */
 solve(){
  const {axis,pivot,radius,tiltAxis,quaternion,wanted,step,target,normal,turned}=this.scratch;
  wanted.identity();
  this.place(wanted);
  const gate=this.readabilityWeight(pivot.y),clears=this.lowest().floor>=this.clearance;
  const view=this.hasView?this.view:UP;
  if(clears&&gate<=0&&Math.abs(this.spinHint)<.02){this.spinHint=0;this.presentation=0;return wanted;}
  normal.copy(this.faceAxis).transformDirection(target);
  // A shield swings on its enarmes about the forearm. Search the sampled swings plus the
  // two that are exactly edge-on; keep the highest-scoring one that still clears the floor.
  const angles=this.angles;angles.length=0;
  for(let index=0;index<this.candidates;index++)angles.push((index-(this.candidates-1)/2)*2*this.maxSwing/(this.candidates-1));
  if(gate>0)for(const angle of this.edgeOnAngles(axis,normal,view))angles.push(angle);
  let best=0,bestFloor=-Infinity,chosen=null,bestScore=-Infinity;
  for(const angle of angles){
   this.place(quaternion.setFromAxisAngle(axis,angle));
   const floor=this.lowest().floor;
   if(floor>bestFloor){bestFloor=floor;best=angle;}
   if(floor<this.clearance)continue;
   // gate 0 leaves the continuity and rest terms, i.e. the swing nearest the last one,
   // unwinding toward the authored strap.
   const facing=gate>0?Math.abs(turned.copy(normal).applyQuaternion(quaternion).dot(view)):1;
   // `rest` unwinds the presentation swing back to the authored strap as the gate fades,
   // so the shield is already home when the tuck blends out instead of snapping there.
   const score=gate*(1-facing)-this.continuity*Math.abs(wrap(angle-this.spinHint))-this.rest*(1-gate)*Math.abs(angle);
   if(score>bestScore){bestScore=score;chosen=angle;}
  }
  chosen??=best;
  // The argmax can still step a long way in one frame -- most visibly at the stand-up, where
  // round 2 dumped 109 degrees of swing in the frame the gate closed. Rate limit the applied
  // swing so it travels there instead, and give that up only if the limited swing would put a
  // corner under the flagstones: clearance is the one hard constraint.
  const move=this.step>0?this.swingRate*this.step:Infinity;
  let swing=clamp(chosen,this.spinHint-move,this.spinHint+move);
  if(swing!==chosen&&this.floorAt(swing)<this.clearance){
   // Walk out from the window toward the argmax and stop at the first swing that clears,
   // so a frame the limit cannot honour still moves as little as it can get away with.
   const span=chosen-swing;let rescue=null;
   for(const fraction of [.2,.4,.6,.8])if(this.floorAt(swing+span*fraction)>=this.clearance){rescue=swing+span*fraction;break;}
   swing=rescue??chosen;
  }
  this.spinHint=swing;
  wanted.setFromAxisAngle(axis,swing);
  // A swing alone cannot present the face edge-on while the forearm points along the view --
  // the normal then travels a cone about the view axis and every swing looks the same.
  // So also tip on the straps toward edge-on, as far as the floor and `maxTilt` allow.
  let tilt=0;
  this.presentation=0;
  if(gate>0){
   turned.copy(normal).applyQuaternion(wanted);
   tiltAxis.copy(view).cross(turned);
   if(tiltAxis.lengthSq()>1e-8){
    tiltAxis.normalize();
    const flat=clamp(Math.asin(clamp(turned.dot(view),-1,1)),-this.maxTilt,this.maxTilt);
    for(const fraction of [1,.65,.35]){
     const angle=flat*fraction;
     if(Math.abs(angle)<1e-3)break;
     this.place(quaternion.copy(step.setFromAxisAngle(tiltAxis,angle)).multiply(wanted));
     if(this.lowest().floor<this.clearance)continue;
     wanted.premultiply(step.setFromAxisAngle(tiltAxis,angle));
     tilt=Math.abs(angle);this.presentation=angle;break;
    }
   }
  }
  // Then tip the shield on the straps, lowest corner first, within the tilt limit.
  for(let iteration=0;iteration<this.iterations;iteration++){
   this.place(wanted);
   const {floor,index}=this.lowest();
   if(floor>=this.clearance)break;
   radius.copy(this.probes[index]).sub(pivot);
   const length=radius.length();if(length<1e-4)break;
   const reach=clamp(this.clearance-pivot.y,-length,length);
   if(reach<=radius.y)break;
   tiltAxis.copy(UP).cross(radius);
   if(tiltAxis.lengthSq()<1e-8)break;
   tiltAxis.normalize();
   let angle=Math.acos(clamp(reach/length,-1,1))-Math.acos(clamp(radius.y/length,-1,1));
   angle=Math.max(angle,-(this.maxTilt-tilt));if(angle>=0)break;
   tilt-=angle;
   wanted.premultiply(step.setFromAxisAngle(tiltAxis,angle));
  }
  return wanted;
 }

 /** weight 0 restores the authored guard mount; weight 1 is fully strapped. */
 update(dt,weight){
  // A zero step is a scrubbed studio pose or an offline audit frame: there is no time
  // for the damping to run, so the solved correction is taken whole.
  const shield=this.shield,elapsed=clamp(dt,0,.1),settle=!(dt>0);
  this.weight=weight;
  if(!(weight>0)){
   if(settle)this.fix.identity();else this.fix.rotateTowards(this.scratch.quaternion.identity(),this.fixRate*elapsed);
   this.spinHint=0;this.presentation=0;this.correction=0;this.floor=Infinity;
   shield.position.copy(this.mount.position);shield.quaternion.copy(this.mount.quaternion);
   shield.updateMatrixWorld(true);return;
  }
  const {target,world,local,rotation,shift,pivot,axis,position,quaternion,scale}=this.scratch;
  // Blend the guard mount into the forearm strap first, then clear the floor: a slab
  // this long can sweep below both poses while it is halfway between them.
  local.multiplyMatrices(this.forearm.matrixWorld,this.offset).premultiply(rotation.copy(this.socket.matrixWorld).invert());
  local.decompose(position,quaternion,scale);
  position.lerpVectors(this.mount.position,position,weight);
  quaternion.slerpQuaternions(this.mount.quaternion,quaternion,weight);
  target.compose(position,quaternion,scale.set(1,1,1)).premultiply(this.socket.matrixWorld);
  this.forearm.getWorldPosition(pivot);
  axis.copy(this.hand.getWorldPosition(position)).sub(pivot);
  if(axis.lengthSq()<1e-10)axis.set(0,1,0);else axis.normalize();
  this.step=settle?0:elapsed;
  const wanted=this.solve();
  if(settle)this.fix.copy(wanted);
  else this.fix.rotateTowards(wanted,Math.min(this.fix.angleTo(wanted)*(1-Math.exp(-this.fixDamping*elapsed)),this.fixRate*elapsed));
  // The correction fades out with the strap itself. It can be a large swing now that it
  // also presents the shield edge-on, and weight 0 snaps back to the bare guard mount, so
  // applying it at full strength on the last blended frame threw the shield 27 cm in one
  // step. The raw pose clears the floor comfortably at both ends of the blend anyway.
  const presence=clamp(weight/.45,0,1),applied=this.scratch.applied;
  applied.identity();if(presence>=1)applied.copy(this.fix);else if(presence>0)applied.slerp(this.fix,presence*presence*(3-2*presence));
  // Clearance is the hard constraint and the damping is cosmetic, so when the damped or
  // faded pose lags somewhere the `lift` cannot rescue, the damping yields: catch up toward
  // the solved pose by the smallest step that gets the shield back over the flagstones.
  this.place(applied);
  this.floor=this.lowest().floor;
  if(this.floor<this.clearance-this.lift)for(const fraction of [.35,.7,1]){
   const relaxed=this.scratch.step.copy(applied).slerp(wanted,fraction);
   this.place(relaxed);
   const candidate=this.lowest().floor;
   if(candidate>this.floor){this.floor=candidate;applied.copy(relaxed);}
   if(this.floor>=this.clearance)break;
  }
  this.correction=2*Math.acos(clamp(Math.abs(applied.w),-1,1));
  rotation.makeRotationFromQuaternion(applied);
  world.makeTranslation(pivot.x,pivot.y,pivot.z).multiply(rotation).multiply(shift.makeTranslation(-pivot.x,-pivot.y,-pivot.z)).multiply(target);
  // A corner still under the flagstones after the swing is lifted by a few centimetres.
  if(this.floor<this.clearance)world.premultiply(shift.makeTranslation(0,Math.min(this.lift,this.clearance-this.floor),0));
  local.copy(this.socket.matrixWorld).invert().multiply(world);
  local.decompose(shield.position,shield.quaternion,scale);
  shield.updateMatrixWorld(true);
 }
}
