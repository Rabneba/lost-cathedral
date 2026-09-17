import {createActionTimings,actionDuration,strikeIndex,linearContact} from './weapon-motion.js';
import {bossEngagement} from './engagement-range.js';
import {actionRate} from './weapon-motion.js';
import {withComboTimings,followUp,chainPoint,chainWindow} from './player-combo.js';
export const HEALTH={player:100,boss:1800};
// Damage the player takes is scaled by this: 1.25 = the player's health effectively 20 % lower (user, 16 Sep evening:
// "he survives for way too long"). The bar and the draughts keep their 0-100 scale.
export const PLAYER_DAMAGE_TAKEN=1.25;
export class Fight{
 constructor(metadata={}){this.metadata=metadata;this.playerDamageTaken=PLAYER_DAMAGE_TAKEN;this.timings={player:withComboTimings(createActionTimings(metadata.player),metadata.player),boss:createActionTimings(metadata.boss,true)};this.reset();}
 reset(){this.time=0;this.status='ready';this.player={health:100,stamina:100,flasks:3,action:null,blocking:false};this.boss={health:1800,phase:1,action:null};this.cooldown=1.4;this.delay=0;this.hitstun=0;this.attackIndex=0;this.events=[];this.stats={hits:0,blocks:0,evades:0,heals:0,damage:0};
  // Boss selection state: a seeded generator (drawn only when a weighted choice is made, so fixed-step
  // runs agree at any frame rate), the last two attacks, consecutive hits taken, and a forced opener.
  this.seed=0x2f6e2b1;this.history=[];this.punish=0;this.punishMark=0;this.forced=null;}
 start(){if(this.status!=='ready')return false;this.status='fighting';return true;}
 request(name){const p=this.player,s=this.timings.player[name];if(this.status!=='fighting'||this.hitstun>0)return false;
 // A second attack input during a light chains (src/game/player-combo.js): a tap queues light2 for the
 // light's chain point (or starts it now, past that point), a heavy waits for the light to end. Whiffs
 // chain too; nothing chains out of light2; a hit replaces the action and drops the queue.
 if(p.action){const a=p.action,follow=this.timings.player.light2?followUp(a.name,name):null,f=follow&&this.timings.player[follow];if(!f||a.queued||p.stamina<f.cost)return false;const [open,close]=chainWindow(this.timings.player[a.name]);if(a.elapsed<open||a.elapsed>=close)return false;a.queued=follow;this.events.push({type:'player-chain',name:follow});if(a.elapsed>=chainPoint(this.timings.player[a.name],follow))this.beginChained(0);return true;}
 if(!s||!['light','heavy','dodge','heal'].includes(name)||p.stamina<s.cost)return false;if(name==='heal'&&(!p.flasks||p.health>=100))return false;p.stamina-=s.cost||0;this.delay=.65;p.blocking=false;if(name==='heal')p.flasks--;p.action={name,elapsed:0,hits:[]};this.events.push({type:'player-action',name});return true;}
 /** Start the queued follow-up now; `carry` is the fixed-step overshoot past the chain point so its timing stays exact. */
 beginChained(carry){const p=this.player,name=p.action.queued,s=this.timings.player[name];if(!s||p.stamina<s.cost){p.action.queued=null;return false;}p.stamina-=s.cost||0;this.delay=.65;p.action={name,elapsed:carry,hits:[],chained:true};this.events.push({type:'player-action',name,chained:true});return true;}
 step(dt,geometry){if(this.status!=='fighting')return;this.time+=dt;this.delay=Math.max(0,this.delay-dt);this.hitstun=Math.max(0,this.hitstun-dt);const p=this.player,b=this.boss;
 if(this.delay===0&&!p.action)p.stamina=Math.min(100,p.stamina+dt*(p.blocking?10:29));
 if(b.phase===1&&b.health<=900){b.phase=2;b.action={name:'awaken',elapsed:0,hits:[]};this.forced=this.phaseTwoOpener();this.events.push({type:'phase-change'});}
 // Player actions advance in clip seconds at the action's own rate too (round 3: the heavy plays at PLAYER_PACE).
 if(p.action){const a=p.action;const s=this.timings.player[a.name];a.elapsed+=dt*actionRate(s,a.elapsed);if(s?.damage){const strike=strikeIndex(a.name,a.elapsed,false,this.timings.player);if(strike>=0&&!a.hits.includes(strike)&&geometry.playerHit){a.hits.push(strike);b.health=Math.max(0,b.health-s.damage);this.stats.damage+=s.damage;this.events.push({type:'boss-hit',damage:s.damage,action:a.name});}const at=a.queued?chainPoint(s,a.queued):Infinity;if(a.elapsed>=at)this.beginChained(a.elapsed-at);else if(a.elapsed>=actionDuration(s))p.action=null;}else if(a.name==='heal'){if(a.elapsed>=s.healAt&&!a.healed){a.healed=true;p.health=Math.min(100,p.health+48);this.stats.heals++;this.events.push({type:'heal'});}if(a.elapsed>=actionDuration(s))p.action=null;}else if(a.elapsed>=actionDuration(s))p.action=null;}
 if(b.health<=0){this.finish('victory');return;}
 // Boss. `elapsed` advances in clip seconds at the action's own rate (weapon-motion actionRate), so hit
 // windows, effects and audio keyed on clip time stay in step with a faster or slower playback.
 if(this.stats.damage!==this.punishMark){this.punish++;this.punishMark=this.stats.damage;}
 if(b.action){const a=b.action;const s=this.timings.boss[a.name];a.elapsed+=dt*this.bossRate(a);if(s?.damage){const strike=strikeIndex(a.name,a.elapsed,true,this.timings.boss);const contact=s.radial?geometry.distance<=s.reach:s.linear?linearContact(s,a,geometry):geometry.bossHit;if(strike>=0&&!a.hits.includes(strike)&&contact){a.hits.push(strike);if(p.action?.name==='dodge'&&p.action.elapsed>=this.timings.player.dodge.invulnerable[0]&&p.action.elapsed<this.timings.player.dodge.invulnerable[1]){this.stats.evades++;this.events.push({type:'evade',action:a.name});}else if(p.blocking&&geometry.playerFacing&&p.stamina>=32){p.stamina-=32;this.delay=.8;p.health=Math.max(0,p.health-Math.ceil(s.damage*.12*this.playerDamageTaken));this.stats.blocks++;this.events.push({type:'block',action:a.name});}else{const broken=p.blocking;p.stamina=Math.max(0,p.stamina-(broken?40:0));p.health=Math.max(0,p.health-Math.round(s.damage*this.playerDamageTaken));p.action={name:'hit',elapsed:0,hits:[]};this.hitstun=.35;this.delay=.9;this.stats.hits++;this.punish=0;this.events.push({type:broken?'guard-break':'player-hit',damage:s.damage,action:a.name});}}
 if(a.elapsed>=actionDuration(s)){b.action=null;this.cooldown=this.bossCooldown(s);}}
 else if(a.name==='awaken'&&a.elapsed>actionDuration(s)){b.action=null;this.cooldown=s?.cooldown??.65;}}
 else{this.cooldown-=dt;if(this.cooldown<=0){const engagement=bossEngagement(this.metadata.boss,b.phase,geometry.distance,this.attackIndex,{random:()=>this.random(),history:this.history,punished:this.punish>=3,forced:this.forced});const settled=!engagement.ranged||(geometry.bossFacing===true&&(geometry.bossSpeed??0)<=.08);if(engagement.selected&&settled){const {name,nextIndex}=engagement.selected;this.attackIndex=nextIndex;b.action={name,elapsed:0,hits:[]};this.history.push(name);if(this.history.length>2)this.history.shift();this.forced=null;if(this.timings.boss[name]?.radial||this.timings.boss[name]?.linear)this.punish=0;this.events.push({type:'boss-tell',name,action:name});}}}
 if(p.health<=0)this.finish('defeat');
 }
 finish(status){this.status=status;this.player.action=null;this.boss.action=null;this.player.blocking=false;this.events.push({type:status});}
 drain(){return this.events.splice(0);}
 /** Clip-seconds per wall second for a boss action right now (phase two runs everything but the awakening faster). */
 bossRate(action){const phase=this.boss.phase===2&&action.name!=='awaken'?(this.metadata.boss?.phaseTwoSpeedMultiplier??1.08):1;return actionRate(this.timings.boss[action.name],action.elapsed,phase);}
 /** Pause after a boss action, from the action's own `cooldown` (legacy metadata keeps 1.15 s / 0.8 s). */
 bossCooldown(spec){const meta=this.metadata.boss||{},phaseTwo=this.boss.phase===2;return (spec?.cooldown??(phaseTwo?.8:1.15))*(phaseTwo?(meta.phaseTwoCooldownMultiplier??1):1);}
 /** What the approach logic (motion.js) must know to agree with the next selection: the same history,
  * punishment and opener, with a constant draw so asking never advances the generator. */
 selectionContext(){return {random:0,history:this.history,punished:this.punish>=3,forced:this.forced};}
 /** The eruption opens phase two when the metadata selects attacks by weight; consumed by the first selection after the awakening. */
 phaseTwoOpener(){const rules=this.metadata.boss?.attackWeights;return rules?rules.burstAction??'burst':null;}
 /** Deterministic generator (mulberry32) so a fight replays identically at any presentation rate. */
 random(){let t=this.seed=(this.seed+0x6D2B79F5)|0;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;}
}
