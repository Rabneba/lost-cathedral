const compiledCurves=new WeakMap();

/** Cumulative ground travel, in final action seconds and authored metres.
 * Sparse sample arrays are allowed; interpolation preserves every measured
 * contact sample exactly. The actor scale wrapper converts metres once.
 */
export function compileTravelCurve(curve){
 if(compiledCurves.has(curve))return compiledCurves.get(curve);
 if(!Array.isArray(curve)||curve.length<2)throw new RangeError('travelCurve needs at least two [seconds, metres] samples');
 const samples=curve.map(sample=>{
  if(!Array.isArray(sample)||sample.length!==2||!sample.every(Number.isFinite))throw new RangeError('travelCurve samples must contain finite seconds and metres');
  return [...sample];
 });
 if(samples[0][0]!==0||samples[0][1]!==0)throw new RangeError('travelCurve must begin at [0, 0]');
 for(let i=1;i<samples.length;i++)if(samples[i][0]<=samples[i-1][0]||samples[i][1]<samples[i-1][1])throw new RangeError('travelCurve times must increase and distance cannot decrease');
 const sampleAt=time=>{
  if(time<=0)return 0;
  const last=samples.at(-1);if(time>=last[0])return last[1];
  let low=0,high=samples.length-1;
  while(high-low>1){const mid=(low+high)>>1;if(samples[mid][0]<=time)low=mid;else high=mid;}
  const [start,distance]=samples[low],[end,next]=samples[high];
  return distance+(next-distance)*(time-start)/(end-start);
 };
 compiledCurves.set(curve,sampleAt);return sampleAt;
}

/** Includes the previous hop's analytic ease-out when no measured curve exists. */
export function actionTravelAt(spec,time){
 if(spec.travelCurve)return compileTravelCurve(spec.travelCurve)(time);
 if(!(spec.travelDuration>0)||!Number.isFinite(spec.distance))return 0;
 const progress=Math.min(1,Math.max(0,(time-(spec.travelStart||0))/spec.travelDuration));
 return spec.distance*(1-(1-progress)**2);
}

export function facingTravelDirection(yaw,direction='forward'){
 if(!['forward','backward'].includes(direction))throw new RangeError('Measured action travel direction must be forward or backward');
 const sign=direction==='backward'?-1:1;
 return{x:Math.sin(yaw)*sign,z:Math.cos(yaw)*sign};
}
