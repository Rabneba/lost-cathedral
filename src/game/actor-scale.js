/** Runtime scale is absolute relative to the preserved authored mesh. */
export function actorScale(metadata={}){
 const scale=metadata.worldScale??1;
 if(!Number.isFinite(scale)||scale<=0)throw new RangeError('Actor scale must be positive');
 return scale;
}

/** Convert authored movement lengths to world metres without changing clips.
 * Weapon segments remain socket-local and receive scale from matrixWorld.
 */
export function withActorScale(metadata={},scale=1){
 actorScale({worldScale:scale});
 const ratio=scale/actorScale(metadata),result={...metadata,worldScale:scale};
 for(const key of ['locomotionSpeed','strafeSpeed','retreatSpeed','guardSpeed','approachDistance','attackRange'])
  if(Number.isFinite(metadata[key]))result[key]=metadata[key]*ratio;
 result.clips=Object.fromEntries(Object.entries(metadata.clips||{}).map(([name,clip])=>{
  const next={...clip};
  for(const key of ['sourceSpeed','distance','travelDistance'])if(Number.isFinite(clip[key]))next[key]=clip[key]*ratio;
  if(clip.engagementRange)next.engagementRange=clip.engagementRange.map(distance=>distance*ratio);
  if(Number.isFinite(clip.preferredDistance))next.preferredDistance=clip.preferredDistance*ratio;
  if(clip.travelCurve)next.travelCurve=clip.travelCurve.map(([time,distance])=>[time,distance*ratio]);
  return [name,next];
 }));
 return result;
}

export function actorDimensions(isBoss,metadata={}){
 const scale=actorScale(metadata);
 return{
  scale,
  // Authored core radius, independent of the larger obstacle footprint that
  // protects boots/equipment near walls. Scale once with the preserved mesh.
  bodyRadius:(isBoss?.9/1.3:.45)*scale,
  groundRadius:(isBoss?1.1:.45)*scale,
  hurtRadius:(isBoss?.54:.42)*scale,
  capsuleY:(isBoss?[.6,2.1]:[.45,1.5]).map(y=>y*scale),
  focusHeight:(isBoss?1.75:1.35)*scale,
  lockHeight:(isBoss?1.8:1.35)*scale,
  impactHeight:(isBoss?1.4:1.15)*scale,
 };
}

export function actorCapsule(position,dimensions){
 return dimensions.capsuleY.map(y=>[position.x,y,position.z]);
}
