import {Quaternion} from 'three';
/** Manifest-driven clip edits applied once at load. The GLB stays untouched; every
 * change is declared per clip in the motion manifest so it can be measured and reviewed.
 *
 *   clips.<name>.smoothBones = {pattern:'LeftArm$|LeftForeArm$|LeftHand', windowSeconds:.6}
 *     Gaussian-smooths the rotation tracks of the matching bones (loop-aware), which
 *     removes a captured twitch without touching the slow breathing underneath.
 */
export function applyClipAdjustments(clips,metadata={}){
 for(const clip of clips){
  const spec=metadata.clips?.[clip.name]?.smoothBones;if(!spec)continue;
  const pattern=new RegExp(spec.pattern),loop=spec.loop??metadata.clips[clip.name].loop??false;
  for(const track of clip.tracks){
   const dot=track.name.lastIndexOf('.'),node=track.name.slice(0,dot),property=track.name.slice(dot+1);
   if(property==='quaternion'&&pattern.test(node))smoothQuaternionTrack(track,spec.windowSeconds??.5,loop);
  }
 }
 return clips;
}
/** In-place Gaussian blur over a quaternion keyframe track; sigma is half the window. */
export function smoothQuaternionTrack(track,windowSeconds,loop=false){
 const times=track.times,values=track.values,count=times.length;if(count<3||!(windowSeconds>0))return;
 const duration=times[count-1]-times[0],sigma=windowSeconds/2,out=new Float32Array(values.length),q=new Quaternion(),reference=new Quaternion();
 for(let i=0;i<count;i++){
  let x=0,y=0,z=0,w=0;reference.fromArray(values,i*4);
  for(let j=0;j<count;j++){
   let dt=times[j]-times[i];
   if(loop&&duration>0){if(dt>duration/2)dt-=duration;else if(dt<-duration/2)dt+=duration;}
   if(Math.abs(dt)>windowSeconds)continue;
   const weight=Math.exp(-dt*dt/(2*sigma*sigma));q.fromArray(values,j*4);
   // Average on the same hemisphere so q and -q do not cancel.
   if(q.dot(reference)<0)q.set(-q.x,-q.y,-q.z,-q.w);
   x+=q.x*weight;y+=q.y*weight;z+=q.z*weight;w+=q.w*weight;
  }
  q.set(x,y,z,w).normalize().toArray(out,i*4);
 }
 values.set(out);
}
