// Isolated research prototype. Not imported by production game code.
import * as T from 'three';
import {FootPlant} from '../../src/game/foot-plant.js';
const gait=name=>/^(run|walk)-/.test(name);
function poseHierarchy(node){
  const copy=node.isBone?new T.Bone():new T.Object3D();
  copy.name=node.name;copy.position.copy(node.position);copy.quaternion.copy(node.quaternion);copy.scale.copy(node.scale);
  for(const child of node.children)copy.add(poseHierarchy(child));return copy;
}
export function cacheFeet(root,clips,hz=120){
  const start=performance.now(),reference=poseHierarchy(root),mixer=new T.AnimationMixer(reference),cache=new Map();
  const feet=['Left','Right'].map(side=>reference.getObjectByName('mixamorig'+side+'Foot'));
  const point=new T.Vector3(),inverse=new T.Matrix4();let bytes=0,samples=0,nodes=0;reference.traverse(()=>nodes++);
  for(const clip of clips.filter(c=>gait(c.name))){
    const count=Math.max(1,Math.round(clip.duration*hz)),data=new Float32Array((count+1)*6),action=mixer.clipAction(clip);
    action.play();action.paused=true;
    for(let i=0;i<=count;i++){
      action.time=clip.duration*i/count;mixer.update(0);reference.updateMatrixWorld(true);inverse.copy(reference.matrixWorld).invert();
      for(let side=0;side<2;side++)feet[side].getWorldPosition(point).applyMatrix4(inverse).toArray(data,i*6+side*3);
    }
    action.stop();cache.set(clip.name,{duration:clip.duration,count,data});bytes+=data.byteLength;samples+=count+1;
  }
  return {cache,buildMilliseconds:performance.now()-start,bytes,samples,proxyNodes:nodes,hz};
}
export function cachedPosition(entry,time,side,out){
  const u=((time%entry.duration)+entry.duration)%entry.duration/entry.duration*entry.count,i=Math.floor(u),f=u-i;
  const a=i*6+side*3,b=(i+1)*6+side*3,d=entry.data;
  return out.set(T.MathUtils.lerp(d[a],d[b],f),T.MathUtils.lerp(d[a+1],d[b+1],f),T.MathUtils.lerp(d[a+2],d[b+2],f));
}
export class CachedFootBlend extends FootPlant {
  constructor(root,soles,cache){super(root,soles);this.root=root;this.cache=cache;this.applied=false;}
  apply(animation,{rawPose=false,directClipTime=false}={}){
    this.applied=false;const transition=animation.transition,layers=[...animation.layers].filter(([,l])=>l.weight>1e-6);
    if(rawPose||directClipTime||!transition||layers.length<2||layers.some(([name,l])=>!gait(name)||l.oneShot||!this.cache.has(name)))return;
    const u=Math.max(0,Math.min(1,transition.elapsed/(2/60),(transition.duration-transition.elapsed)/(2/60))),strength=u*u*(3-2*u);
    for(let side=0;side<2;side++){
      const leg=this.legs[side],target=new T.Vector3(),filtered=new T.Vector3(),point=new T.Vector3();let weight=0;
      for(const [name,layer]of layers){
        const entry=this.cache.get(name);cachedPosition(entry,layer.time,side,point);target.addScaledVector(point,layer.weight);weight+=layer.weight;
        for(const [offset,w]of[[-2/60,1/9],[-1/60,2/9],[0,3/9],[1/60,2/9],[2/60,1/9]])filtered.addScaledVector(cachedPosition(entry,layer.time+offset*layer.rate,side,point),layer.weight*w);
      }
      target.divideScalar(weight);filtered.divideScalar(weight);filtered.y=Math.max(filtered.y,target.y);target.lerp(filtered,strength).applyMatrix4(this.root.matrixWorld);
      this.solve(leg,target);this.applied=true;
    }
  }
  solve({upper,knee,foot},target){
    const a=upper.getWorldPosition(new T.Vector3()),b=knee.getWorldPosition(new T.Vector3()),c=foot.getWorldPosition(new T.Vector3()),rotation=foot.getWorldQuaternion(new T.Quaternion());
    const l1=a.distanceTo(b),l2=b.distanceTo(c),distance=T.MathUtils.clamp(a.distanceTo(target),1e-5,l1+l2-1e-5),axis=target.clone().sub(a).normalize();
    const along=(l1*l1+distance*distance-l2*l2)/(2*distance),plane=b.clone().sub(a);plane.addScaledVector(axis,-plane.dot(axis));if(plane.lengthSq()<1e-8)return;
    const bend=a.clone().addScaledVector(axis,along).addScaledVector(plane.normalize(),Math.sqrt(Math.max(0,l1*l1-along*along)));
    this.rotateInWorld(upper,new T.Quaternion().setFromUnitVectors(b.clone().sub(a).normalize(),bend.sub(a).normalize()));
    knee.getWorldPosition(b);foot.getWorldPosition(c);this.rotateInWorld(knee,new T.Quaternion().setFromUnitVectors(c.sub(b).normalize(),target.clone().sub(b).normalize()));
    foot.quaternion.copy(foot.parent.getWorldQuaternion(new T.Quaternion()).invert().multiply(rotation));foot.updateMatrixWorld(true);
  }
}
