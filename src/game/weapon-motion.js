// Shared by animation and collision: positions are metres, local +Z is forward.
export const PLAYER_TIMING={light:{windup:.28,active:.22,recovery:.42,damage:55,cost:22},heavy:{windup:.68,active:.28,recovery:.68,damage:118,cost:36}};
export const BOSS_TIMING={sweep:{windup:1.1,active:.38,recovery:1.25,damage:29},slam:{windup:1.5,active:.28,recovery:1.6,damage:44},combo:{windup:1.25,active:.95,recovery:1.45,damage:25}};
/** Distances authored in a derived action (see `actions` below) are in the same authored metres
 * as the clip bands; `withActorScale` only scales `clips`, so they are scaled here once. */
const ACTION_DISTANCE_KEYS=['engagementRange','preferredDistance','reach','closeDistance','width'];
/** Round 3 (16 Sep evening): the player's heavy was a 2.1 s clip and read as slow (user: "our heavy attack is very slow").
 * Played at these rates the cocked windup keeps its weight at 0.70 s wall and the recovery ends 0.64 s after the cut
 * (1.53 s in all); hit windows and effects stay in clip time. A manifest `speed`/`recoverySpeed` on the clip wins. */
export const PLAYER_PACE={heavy:{speed:1.28,recoverySpeed:1.5}};
export function createActionTimings(metadata={},boss=false){
 const base=boss?{...BOSS_TIMING,awaken:{duration:2.6},death:{duration:2}}:{...PLAYER_TIMING,dodge:{cost:26,duration:.64,invulnerable:[.045,.43],travelDuration:.48,distance:3.4},heal:{cost:0,duration:1.4,healAt:.92},hit:{duration:.4},death:{duration:2}};
 const timings=Object.fromEntries(Object.entries(base).map(([name,spec])=>{
  const override=metadata.clips?.[name]||{},merged={...spec,...override};
  // A supplied total length without individual phase marks scales the known windows.
  if(override.duration&&spec.windup!=null&&!['windup','active','recovery'].some(key=>key in override)){
   const scale=override.duration/(spec.windup+spec.active+spec.recovery);
   for(const key of ['windup','active','recovery'])merged[key]=spec[key]*scale;
  }
  if(override.duration&&name==='heal'&&override.healAt==null)merged.healAt=spec.healAt*override.duration/spec.duration;
  if(override.duration&&name==='dodge'){
   if(override.travelDuration==null)merged.travelDuration=spec.travelDuration*override.duration/spec.duration;
   if(override.invulnerable==null)merged.invulnerable=spec.invulnerable.map(time=>time*override.duration/spec.duration);
  }
  if(!boss&&PLAYER_PACE[name])for(const [key,value] of Object.entries(PLAYER_PACE[name]))merged[key]??=value;
  return [name,merged];
 }));
 // Derived actions reuse an existing clip under a new name: `actions.<name> = {clip, ...}`.
 // They inherit the base clip's timing and band, then override; `segments` replays parts of the
 // clip (`[from, to]` clip seconds, forward or reversed, or `[from, to, seconds]` for a hold) and
 // `radial` actions hit by distance (`reach`) instead of blade geometry. Distances are authored
 // metres scaled by the actor's world scale (withActorScale does not visit this block).
 const scale=metadata.worldScale??1;
 for(const [name,spec] of Object.entries(metadata.actions||{})){
  if(!spec||typeof spec.clip!=='string')throw new RangeError(`actions.${name} must name the clip it plays`);
  const source=timings[spec.clip]||metadata.clips?.[spec.clip];
  if(!source)throw new RangeError(`actions.${name} plays unknown clip ${spec.clip}`);
  const merged={...source,...spec,source:spec.source??`derived from ${spec.clip}`};
  for(const key of ACTION_DISTANCE_KEYS)if(key in spec){
   merged[key]=Array.isArray(spec[key])?spec[key].map(value=>value*scale):spec[key]*scale;
  }
  if(merged.segments){
   merged.segments=merged.segments.map(segment=>{
    if(!Array.isArray(segment)||segment.length<2||!segment.slice(0,3).every(Number.isFinite))throw new RangeError(`actions.${name}: segments are [fromClipSeconds, toClipSeconds(, seconds)]`);
    const [from,to,seconds=Math.abs(to-from)]=segment;
    if(seconds<=0)throw new RangeError(`actions.${name}: every segment must take time`);
    return [from,to,seconds];
   });
   const total=merged.segments.reduce((sum,[,,seconds])=>sum+seconds,0);
   if(!('duration' in spec))merged.duration=total;
   else if(Math.abs(spec.duration-total)>1e-6)throw new RangeError(`actions.${name}: duration ${spec.duration} does not match its segments (${total})`);
  }
  if(merged.radial&&!(merged.reach>0))throw new RangeError(`actions.${name}: a radial action needs a positive reach`);
  if(merged.linear&&!(merged.reach>0&&merged.width>0))throw new RangeError(`actions.${name}: a linear action needs a positive reach and width`);
  timings[name]=merged;
 }
 return timings;
}
export function actionDuration(spec){return spec?spec.duration??spec.windup+spec.active+spec.recovery:undefined;}
/** A linear action (the fissure) hits along a line from the boss along its facing: the front leaves the boss when the
 * hit window opens and crosses `reach` in `travel` clip seconds (the whole window by default); the player is hit while
 * inside the line's `width` (plus their own radius) and behind the front. `geometry.along`/`lateral` come from
 * motion.geometry(); an old geometry object without them falls back to the distance on the line's axis. */
export function linearContact(spec,action,geometry={}){
 if(!spec?.linear||!action)return false;
 const start=spec.hitWindows?.[0]?.[0]??spec.windup??0,travel=Math.max(1e-3,spec.travel??spec.active??.5);
 const progress=Math.max(0,Math.min(1,(action.elapsed-start)/travel)),front=spec.reach*progress;
 const along=Number.isFinite(geometry.along)?geometry.along:geometry.distance,lateral=Math.abs(geometry.lateral??0);
 const radius=Number.isFinite(geometry.playerRadius)?geometry.playerRadius:.45;
 return Number.isFinite(along)&&along>=.5&&along<=front&&lateral<=spec.width*.5+radius;
}
/** Where the fissure's front is right now, 0..1 of the reach (0 before the window). */
export function linearProgress(spec,action){
 if(!spec?.linear||!action)return 0;
 const start=spec.hitWindows?.[0]?.[0]??spec.windup??0,travel=Math.max(1e-3,spec.travel??spec.active??.5);
 return Math.max(0,Math.min(1,(action.elapsed-start)/travel));
}
/** Clip playback for an action: the clip to show and the clip time for `action.elapsed`, following
 * the action's `segments` program when it has one. Returns null for a plain clip action. */
export function clipPlayback(action,timings){
 const spec=action?timings?.[action.name]:null;
 if(!spec?.clip)return null;
 const base=timings[spec.clip],elapsed=Math.max(0,action.elapsed||0);
 let time=elapsed;
 if(spec.segments){
  let remaining=elapsed;time=spec.segments.at(-1)[1];
  for(const [from,to,seconds] of spec.segments){
   if(remaining<=seconds){time=from+(to-from)*(remaining/seconds);break;}
   remaining-=seconds;
  }
 }
 return {name:spec.clip,time,duration:actionDuration(base),action:{...action,elapsed:time}};
}
/** Playback rate of a boss action right now: its own `speed` until the last hit window has passed,
 * then `recoverySpeed` (a heavy windup can keep its weight while the recovery is shortened),
 * times the phase multiplier. `action.elapsed` advances in clip seconds, so hit windows and
 * effects keyed on clip time never need rescaling; wall-clock durations come from actionWallTimes. */
export function recoveryStart(spec){
 if(!spec)return Infinity;
 if(spec.hitWindows?.length)return spec.hitWindows.at(-1)[1];
 return Number.isFinite(spec.windup)&&Number.isFinite(spec.active)?spec.windup+spec.active:Infinity;
}
export function actionRate(spec,elapsed=0,phaseMultiplier=1){
 const speed=spec?.speed??1;
 return (elapsed>=recoveryStart(spec)?spec?.recoverySpeed??speed:speed)*phaseMultiplier;
}
/** Wall-clock phases of an action at a given phase multiplier. */
export function actionWallTimes(spec,phaseMultiplier=1){
 if(!spec)return null;
 const speed=actionRate(spec,0,phaseMultiplier),recovery=actionRate(spec,Infinity,phaseMultiplier);
 const split=Math.min(recoveryStart(spec),actionDuration(spec)),total=actionDuration(spec);
 const windup=spec.hitWindows?.[0]?.[0]??spec.windup??split;
 return {speed,recoverySpeed:recovery,windup:windup/speed,active:Math.max(0,split-windup)/speed,recovery:Math.max(0,total-split)/recovery,total:split/speed+Math.max(0,total-split)/recovery,hitWindows:(spec.hitWindows||[]).map(([start,end])=>[start/speed,end/speed])};
}
const clamp=x=>Math.max(0,Math.min(1,x));const smooth=x=>{x=clamp(x);return x*x*(3-2*x)};
const lerp=(a,b,t)=>a+(b-a)*t;
function rotate(v,r){let [x,y,z]=v;const [a,b,c]=r;[x,y]=[x*Math.cos(c)-y*Math.sin(c),x*Math.sin(c)+y*Math.cos(c)];[x,z]=[x*Math.cos(b)+z*Math.sin(b),-x*Math.sin(b)+z*Math.cos(b)];[y,z]=[y*Math.cos(a)-z*Math.sin(a),y*Math.sin(a)+z*Math.cos(a)];return[x,y,z];}
function anchored(rotation,grip,center){const offset=rotate(grip,rotation);return{position:center.map((v,i)=>v-offset[i]),rotation};}
export function bossWeaponPose(name='idle',elapsed=0){
 const spec=BOSS_TIMING[name];let yaw=.25,roll=-.92,pitch=.15,center=[0,1.7,.14];
 if(spec){
  const w=smooth(elapsed/spec.windup),a=clamp((elapsed-spec.windup)/spec.active),r=smooth((elapsed-spec.windup-spec.active)/spec.recovery);
  if(name==='slam'){
   pitch=lerp(.15,-1.05,w);roll=lerp(-.92,.28,w);yaw=lerp(.25,0,w);
   center=[lerp(0,-.22,w),lerp(1.7,1.62,w),.14];
   if(a>0)pitch=lerp(-1.05,2.15,smooth(a));
   if(r>0){pitch=lerp(2.15,.15,r);roll=lerp(.28,-.92,r);yaw=lerp(0,.25,r);center=[lerp(-.22,0,r),lerp(1.62,1.7,r),.14];}
  }else{
   yaw=lerp(.25,-2.72,w);roll=lerp(-.92,-1.48,w);pitch=lerp(.15,0,w);center=[0,lerp(1.7,1.47,w),.14];
   if(a>0)yaw=name==='combo'?(a<.43?lerp(-2.72,-.4,smooth(a/.43)):a<.64?-.4:lerp(-.4,-2.72,smooth((a-.64)/.36))):lerp(-2.72,-.4,smooth(a));
   if(r>0){yaw=lerp(name==='combo'?-2.72:-.4,.25,r);roll=lerp(-1.48,-.92,r);pitch=lerp(0,.15,r);center=[0,lerp(1.47,1.7,r),.14];}
  }
 }
 if(name==='death'){const t=smooth(elapsed/2);pitch=lerp(.15,Math.PI/2,t);roll=lerp(-.92,-Math.PI/2,t);center=[0,lerp(1.7,.25,t),lerp(.14,.8,t)];}
 return anchored([pitch,yaw,roll],[0,.88,0],center);
}
export function playerWeaponPose(name='idle',elapsed=0){let x=-.38,y=1.02,z=.2,pitch=.28,yaw=-.4,roll=-.16;const spec=PLAYER_TIMING[name];
 if(spec){const w=smooth(elapsed/spec.windup),a=smooth((elapsed-spec.windup)/spec.active),r=smooth((elapsed-spec.windup-spec.active)/spec.recovery);
 if(name==='heavy'){y=lerp(1.02,1.65,w);pitch=lerp(.28,-.65,w);if(a>0){pitch=lerp(-.65,2.35,a);y=lerp(1.65,.85,a);z=lerp(.2,.7,a);}if(r>0){pitch=lerp(2.35,.28,r);y=lerp(.85,1.02,r);z=lerp(.7,.2,r);}}
 else {yaw=lerp(-.4,-1.5,w);roll=lerp(-.16,-1.25,w);z=lerp(.2,.35,w);y=lerp(1.02,1.18,w);if(a>0)yaw=lerp(-1.5,1.7,a);if(r>0){yaw=lerp(1.7,-.4,r);roll=lerp(-1.25,-.16,r);z=lerp(.35,.2,r);y=lerp(1.18,1.02,r);}}
 }
 if(name==='heal'){x=-.16;y=1.42;z=.4;pitch=-.6;}
 if(name==='death'){const t=smooth(elapsed/2);return anchored([lerp(.28,Math.PI/2,t),-.4,-.16],[0,.16,0],[-.28,lerp(1.15,.24,t),lerp(.22,.65,t)]);}
 return anchored([pitch,yaw,roll],[0,.16,0],[-.28,name==='heavy'?Math.min(1.52,Math.max(1.18,y)):name==='heal'?1.43:1.15,name==='heal'?.3:.22]);
}
export function strikeIndex(name,elapsed,boss=false,timings){const s=(timings||(boss?BOSS_TIMING:PLAYER_TIMING))[name];if(!s||!Number.isFinite(elapsed))return -1;if(s.hitWindows)return s.hitWindows.findIndex(([start,end])=>Number.isFinite(start)&&Number.isFinite(end)&&start>=0&&end>start&&elapsed>=start&&elapsed<end);if(!Number.isFinite(s.windup)||s.windup<0||!Number.isFinite(s.active)||s.active<=0)return-1;const a=(elapsed-s.windup)/s.active;if(a<0||a>=1)return-1;if(name==='combo'){return a<.43?0:a>=.64?1:-1;}return 0;}
// Segment-segment closest distance, robust for stationary and degenerate segments.
export function segmentDistance(a,b,c,d){
 const sub=(p,q)=>p.map((x,i)=>x-q[i]),dot=(p,q)=>p.reduce((s,x,i)=>s+x*q[i],0),u=sub(b,a),v=sub(d,c),w=sub(a,c);
 const A=dot(u,u),B=dot(u,v),C=dot(v,v),D=dot(u,w),E=dot(v,w),den=A*C-B*B;
 let s=den>1e-10?clamp((B*E-C*D)/den):0,t=C>1e-10?clamp((B*s+E)/C):0;s=A>1e-10?clamp((B*t-D)/A):0;t=C>1e-10?clamp((B*s+E)/C):0;
 return Math.hypot(...w.map((x,i)=>x+s*u[i]-t*v[i]));
}
export function sweptWeaponContact(previous,current,capsule,radius){
 if(!current)return false;const pairs=[[current[0],current[1]]];if(previous){pairs.push([previous[0],previous[1]],[previous[0],current[0]],[previous[1],current[1]]);for(let i=1;i<5;i++){const t=i/5;pairs.push([previous[0].map((x,j)=>lerp(x,current[0][j],t)),previous[1].map((x,j)=>lerp(x,current[1][j],t))]);}}
 return pairs.some(([a,b])=>segmentDistance(a,b,capsule[0],capsule[1])<=radius);
}
