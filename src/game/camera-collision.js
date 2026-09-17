import {Box3,Ray,Vector3} from 'three';

const expanded=new Box3(),ray=new Ray(),direction=new Vector3(),hit=new Vector3();

/** Keep the camera sphere on the visible side of solid arena structures. */
export function unobstructedCameraPosition(anchor,desired,colliders=[],radius=.3){
 direction.subVectors(desired,anchor);const distance=direction.length();
 if(distance<1e-6)return {position:desired.clone(),blocked:false};
 direction.multiplyScalar(1/distance);ray.set(anchor,direction);
 let allowed=distance;
 for(const box of colliders){
  expanded.copy(box).expandByScalar(radius);
  if(expanded.containsPoint(anchor))continue;
  if(ray.intersectBox(expanded,hit))allowed=Math.min(allowed,Math.max(.15,anchor.distanceTo(hit)-.025));
 }
 return {position:anchor.clone().addScaledVector(direction,allowed),blocked:allowed<distance-.001};
}

/** Near a pillar, move to a clear shoulder instead of looking straight down at the helmet. */
export function cameraOrbitPosition(anchor,desired,colliders=[]){
 const direct=unobstructedCameraPosition(anchor,desired,colliders);
 if(!direct.blocked||anchor.distanceTo(direct.position)>=2.8)return direct;
 const boom=desired.clone().sub(anchor),up=new Vector3(0,1,0);
 let best=direct,bestScore=anchor.distanceTo(direct.position);
 for(const angle of [15,-15,30,-30,45,-45,60,-60,75,-75,90,-90]){
  const alternative=anchor.clone().add(boom.clone().applyAxisAngle(up,angle*Math.PI/180));
  const safe=unobstructedCameraPosition(anchor,alternative,colliders);
  const score=anchor.distanceTo(safe.position)-Math.abs(angle)*.026;
  if(score>bestScore+.2){best=safe;bestScore=score;}
 }
 return best;
}
