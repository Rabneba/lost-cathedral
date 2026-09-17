import {createActionTimings} from './weapon-motion.js';
// Engagement ranges choose an attack and its approach. They never decide a hit.
const EPSILON=1e-7;
/** Weighted selection pool for a phase, or null when the metadata still uses fixed sequences.
 * `attackWeights.phase1/phase2` map action names to relative weights; the optional modifiers
 * `closeDistance` (authored metres, scaled once like the bands), `closeBurstMultiplier`,
 * `punishedBurstMultiplier` and `burstAction` shape when the eruption is chosen. */
export function attackWeights(metadata={},phase=1){
 const weights=metadata.attackWeights?.['phase'+phase];
 if(!weights)return null;
 for(const [name,weight] of Object.entries(weights))if(!Number.isFinite(weight)||weight<0)throw new RangeError(`attackWeights.phase${phase}.${name} must be a non-negative number`);
 return weights;
}
export function bossAttackSequence(metadata={},phase=1){
 const weights=attackWeights(metadata,phase);
 if(weights)return Object.keys(weights);
 return (phase===1?metadata.attackSequence:metadata.phaseTwoAttackSequence)
  ||(phase===1?['sweep','sweep','slam']:['combo','slam','sweep','combo']);
}
export function engagementRange(spec={}){
 const range=spec.engagementRange;
 if(range===undefined)return null;
 if(!Array.isArray(range)||range.length!==2||!range.every(Number.isFinite)||range[0]<0||range[1]<=range[0])throw new RangeError('engagementRange must be [minimum, maximum] metres');
 if(spec.preferredDistance!==undefined&&(!Number.isFinite(spec.preferredDistance)||spec.preferredDistance<range[0]||spec.preferredDistance>range[1]))throw new RangeError('preferredDistance must lie inside engagementRange');
 return range;
}
// Derived actions (manifest `actions`) only exist as timings; cache them per metadata object.
const timingCache=new WeakMap();
function bossSpecs(metadata){
 if(!metadata.actions)return metadata.clips||{};
 let specs=timingCache.get(metadata);
 if(!specs){specs=createActionTimings(metadata,true);timingCache.set(metadata,specs);}
 return specs;
}
/** Weighted choice among the attacks whose band contains the player. `context`:
 *   random   — a number in [0,1) or a function returning one (drawn only when a choice is made)
 *   history  — recent action names, newest last; the same action never starts three times running
 *   punished — the boss has been hit repeatedly: the eruption becomes near certain
 *   forced   — an action name that wins as soon as it is eligible (the phase-two opener)
 * An all-zero pool selects nothing and asks for the next band in, so the boss walks on. */
function weightedSelection(entries,eligible,weights,metadata,distance,startIndex,context){
 const {history=[],punished=false,forced=null}=context,rules=metadata.attackWeights,burst=rules.burstAction??'burst';
 const scale=metadata.worldScale??1,close=Number.isFinite(rules.closeDistance)?rules.closeDistance*scale:0;
 const blocked=name=>history.length>=2&&history.at(-1)===name&&history.at(-2)===name;
 if(forced){const entry=eligible.find(entry=>entry.name===forced);if(entry)return {name:entry.name,nextIndex:startIndex+1,weight:Infinity};}
 const pool=eligible.map(entry=>{
  let weight=weights[entry.name]??0;
  if(blocked(entry.name))weight=0;
  if(entry.name===burst){
   if(punished)weight*=rules.punishedBurstMultiplier??6;
   if(distance<=close+EPSILON)weight*=rules.closeBurstMultiplier??3;
  }
  return {entry,weight};
 }).filter(({weight})=>weight>0);
 const total=pool.reduce((sum,{weight})=>sum+weight,0);
 if(!(total>0))return null;
 const draw=typeof context.random==='function'?context.random():context.random??0;
 if(!Number.isFinite(draw)||draw<0||draw>=1)throw new RangeError('random must be a number in [0, 1)');
 let cursor=draw*total;
 for(const {entry,weight} of pool){cursor-=weight;if(cursor<0)return {name:entry.name,nextIndex:startIndex+1,weight};}
 const last=pool.at(-1);return {name:last.entry.name,nextIndex:startIndex+1,weight:last.weight};
}
export function bossEngagement(metadata={},phase=1,distance=Infinity,startIndex=0,context={}){
 const specs=bossSpecs(metadata),weights=attackWeights(metadata,phase);
 const sequence=bossAttackSequence(metadata,phase),entries=sequence.map((name,index)=>({name,index,range:engagementRange(specs[name]),spec:specs[name]}));
 const ranged=entries.some(entry=>entry.range);
 if(!ranged)return {ranged:false,eligible:[],selected:distance<(metadata.attackRange??3.1)&&sequence.length?{name:sequence[startIndex%sequence.length],nextIndex:startIndex+1}:null,targetDistance:null};
 const eligible=entries.filter(({range})=>range&&Number.isFinite(distance)&&distance>=range[0]-EPSILON&&distance<=range[1]+EPSILON);
 let selected=null;
 if(weights){
  selected=weightedSelection(entries,eligible,weights,metadata,distance,startIndex,context);
 }else for(let offset=0;offset<sequence.length;offset++){
  const entry=entries[(startIndex+offset)%sequence.length];
  if(eligible.includes(entry)){selected={name:entry.name,nextIndex:startIndex+offset+1};break;}
 }
 // Only close distance using the authored forward walk. Never walk backwards
 // to a farther band, or approach through a range that is already usable.
 // A weighted pool that is eligible but exhausted (every usable move just ran
 // twice) also walks in to the next band, so the boss varies instead of stalling.
 const usable=eligible.length&&(!weights||selected);
 const below=entries.filter(({range})=>range&&range[1]<distance-EPSILON).sort((a,b)=>b.range[1]-a.range[1]);
 const nearest=below[0];
 return {ranged:true,eligible,selected,weighted:!!weights,targetDistance:usable||!nearest?null:nearest.spec.preferredDistance??(nearest.range[0]+nearest.range[1])/2};
}
