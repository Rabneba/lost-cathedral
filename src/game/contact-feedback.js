import {Vector3} from 'three';
const footActions=new Set(['dodge','light','light2','heavy','sweep','slam']);

/** Detect planted feet from the evaluated skeleton, not a speed-based metronome. */
export class FootContacts{
 constructor(){this.reset();}
 reset(){this.feet=new Map();this.time=0;this.lastContact=-Infinity;this.lastSide=null;this.action=null;this.hopAirborne=false;this.hopLanded=false;}
 update(dt,positions,{moving=false,boss=false,settled=true,action=null,groundHeight,scale=1}={}){
  if(dt<=0)return[];
  this.time+=dt;const contacts=[],candidates=[];
  if(action!==this.action){
   for(const state of this.feet.values())state.raised=false;
   this.action=action;this.hopAirborne=false;this.hopLanded=false;
  }
  const enabled=!action?moving:footActions.has(action.name)&&!action.rawPose;
  const actualSoles=Number.isFinite(groundHeight),hop=action?.name==='dodge';
  const points=Object.values(positions);
  if(hop&&settled&&points.length>=2&&points.every(point=>point.y-(actualSoles?groundHeight:0)>.045*scale))this.hopAirborne=true;
  for(const [side,position] of Object.entries(positions)){
   const state=this.feet.get(side)||{floor:actualSoles?groundHeight:position.y,previous:position.y,raised:false,raisedAt:0};
   // A transient blended knee bend is not a new floor level.
   if(!settled){state.previous=position.y;state.raised=false;this.feet.set(side,state);continue;}
   state.floor=actualSoles?groundHeight:Math.min(state.floor,position.y);
   const lift=(boss?.024:actualSoles?.035:.045)*scale,landing=(actualSoles?.008:boss?.012:.026)*scale;
   if(enabled&&!state.raised&&position.y>state.floor+lift){state.raised=true;state.raisedAt=this.time;}
   const descending=position.y<=state.previous;
   if(enabled&&state.raised&&descending&&position.y<=state.floor+landing){
    if(this.time-state.raisedAt>=.05)candidates.push({side,kind:hop?'landing':'step',position:new Vector3(position.x,.035,position.z)});
    state.raised=false;
   }
   if(!enabled)state.raised=false;
   state.previous=position.y;this.feet.set(side,state);
  }
  if(hop){
   if(candidates.length&&this.hopAirborne&&!this.hopLanded){
    const position=new Vector3();for(const point of points)position.add(point);position.multiplyScalar(1/points.length);position.y=.035;
    contacts.push({side:'both',kind:'landing',position});
    this.hopLanded=true;this.lastContact=this.time;this.lastSide=null;
   }
  }else for(const contact of candidates){
   const interval=this.time-this.lastContact;
   // A combat move can lift and plant its lead foot twice before a slow
   // walking stride completes. Keep the gait debounce for locomotion; each
   // action event still requires a fresh lift, sustained flight and descent.
   const sameSideInterval=boss&&!action?1.15:.4;
   if(interval>(boss?.4:.13)&&(this.lastSide!==contact.side||interval>sameSideInterval)){
    contacts.push(contact);this.lastContact=this.time;this.lastSide=contact.side;
   }
  }
  return contacts;
 }
}

export function weaponGroundContact(previous,current,ground=.035){
 if(!previous||!current)return null;
 for(let end=0;end<2;end++){
  const from=previous[end],to=current[end];
  if(from[1]>ground&&to[1]<=ground){
   const t=(from[1]-ground)/(from[1]-to[1]);
   return new Vector3(from[0]+(to[0]-from[0])*t,ground,from[2]+(to[2]-from[2])*t);
  }
 }
 return null;
}

/** Closest point on the actual blade to the struck body's center. */
export function bladeImpactPoint(segment,target){
 if(!segment)return target.clone();
 const start=new Vector3(...segment[0]),line=new Vector3(...segment[1]).sub(start);
 const along=Math.max(0,Math.min(1,target.clone().sub(start).dot(line)/Math.max(line.lengthSq(),1e-8)));
 return start.addScaledVector(line,along);
}
