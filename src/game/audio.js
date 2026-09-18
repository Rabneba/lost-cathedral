const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

/** Decoded up front so a slam never arrives late. `groundSlam`, `darkFire` and
 * `bossRoar` are the boss's own layer on top of the generic swing/impact pair.
 * Round 2 (the user's chosen sounds): `playerHitArmor` (the exile's sword on
 * the boss), `bossSwing` (the scythe cutting air), `bossHitPlayer` (the scythe
 * on the exile), `playerSwing`, `block`. Each of those is a LIST of takes in
 * asset-paths.js; a play picks one at random and never repeats the last. */
export const SOUNDS=['footstep','impact','swing','groundSlam','darkFire','bossRoar','playerHitArmor','bossSwing','bossHitPlayer','playerSwing','block','playerFootstep'];
// Per-sound trim so the boss layer sits above the fight without clipping it.
// bossRoar is trimmed: the generated file peaks at 0 dBFS, so playing it at
// full level and then summing the convolver send could crackle on a loud system.
// The round-2 takes all peak within 1 dB of 0 dBFS; the trims below put the
// chosen files at comparable loudness (RMS measured with ffmpeg astats, see
// docs/round-2-2026-09-16/FX-notes.md) with the boss's hit on top.
export const SOUND_LEVEL={swing:.6,darkFire:.5,groundSlam:1,bossRoar:.7,playerHitArmor:.8,bossSwing:.7,bossHitPlayer:1,playerSwing:.55,block:.85};
export const soundLevel=name=>SOUND_LEVEL[name]??.8;
/** The round-2 slots are lists of generated takes whose loudness differs by up
 * to 8 dB (RMS -13.7 to -27.4 dBFS, ffmpeg astats). Each take is brought to a
 * common RMS at decode time, within +-5 dB, so SOUND_LEVEL sets the mix and a
 * new take dropped into the JSON arrives at the same loudness as the others.
 * Last night's six sounds keep their hand-tuned levels. */
export const NORMALIZED=new Set(['playerHitArmor','bossSwing','bossHitPlayer','playerSwing','block']);
export const TARGET_RMS=.1; // -20 dBFS
export const takeGain=rms=>Number.isFinite(rms)&&rms>0?clamp(TARGET_RMS/rms,.56,1.78):1;
export function bufferRms(buffer){
 let sum=0,count=0;
 for(let channel=0;channel<buffer.numberOfChannels;channel++){const samples=buffer.getChannelData(channel);for(let i=0;i<samples.length;i++)sum+=samples[i]*samples[i];count+=samples.length;}
 return count?Math.sqrt(sum/count):0;
}
/** A sound is one URL or a list of takes. */
export const soundTakes=value=>Array.isArray(value)?value.filter(Boolean):value?[value]:[];
/** Pick a take at random, never the same index twice in a row (when there are
 * at least two). Returns {index,value}; `last` is the previous pick's index. */
export function pickTake(list,last=-1,random=Math.random){
 const takes=soundTakes(list),count=takes.length;
 if(count===0)return{index:-1,value:undefined};
 if(count===1)return{index:0,value:takes[0]};
 const avoid=Number.isInteger(last)&&last>=0&&last<count;
 let index=Math.floor(clamp(random(),0,.999999)*(avoid?count-1:count));
 if(avoid&&index>=last)index+=1;
 return{index,value:takes[index]};
}

// Listener stays at the player; camera yaw determines audible left and right.
export function soundPlacement(listener,position){
 if(!position)return{pan:0,gain:1};
 const dx=position.x-listener.x,dz=position.z-listener.z,distance=Math.hypot(dx,dz);
 const right=dx*Math.cos(listener.yaw)-dz*Math.sin(listener.yaw);
 return{pan:clamp(right/Math.max(2,distance)*.85,-.85,.85),gain:1/(1+Math.max(0,distance-3)*.045)};
}

// A restrained, repeatable room response: dark early reflections and a short tail.
export function cathedralImpulse(context){
 const duration=1.8,rate=context.sampleRate,buffer=context.createBuffer(2,Math.ceil(duration*rate),rate);
 let seed=1979;
 for(let channel=0;channel<2;channel++){
  const samples=buffer.getChannelData(channel);let low=0;
  for(let i=0;i<samples.length;i++){
   seed=(Math.imul(seed,1664525)+1013904223)>>>0;
   low=.56*low+.44*(seed/4294967296*2-1);
   const t=i/rate-.025;
   samples[i]=t>0?low*Math.min(1,t/.012)*Math.exp(-4.5*t):0;
  }
  for(const[time,level]of[[.043,.35],[.071,.23],[.103,.14]])samples[Math.round((time+channel*.004)*rate)]+=level;
 }
 return buffer;
}

export class GameAudio{
 constructor(paths,{routeMusic=false}={}){
  this.paths=paths;this.music=new Audio(paths.music);this.music.loop=true;this.music.volume=.21;this.routeMusic=routeMusic;this.musicLevel=.21;this.musicGain=null;
  this.volume=.6;this.enabled=false;this.suspended=false;this.pool=new Set();this.buffers=new Map();
  this.listener={x:0,z:0,yaw:0};this.context=null;this.initializing=null;this.lastTake=new Map();this.takeGains=new Map();
  // Fetch once, decode after the first user gesture; browsers can keep audio locked before that.
  // A sound with several takes fetches them all; `buffers` then holds one array per name.
  this.pending=new Map(SOUNDS.filter(name=>soundTakes(paths[name]).length).map(name=>[name,
   Promise.all(soundTakes(paths[name]).map(url=>fetch(url).then(response=>response.ok?response.arrayBuffer():null).catch(()=>null)))]));
 }
 initialize(){
  if(this.initializing)return this.initializing;
  const AudioContext=globalThis.AudioContext||globalThis.webkitAudioContext;
  if(!AudioContext)return Promise.resolve();
  try{
   const context=this.context=new AudioContext({latencyHint:'interactive'});
   this.master=context.createGain();this.master.gain.value=this.volume;this.master.connect(context.destination);
   if(this.routeMusic)this.attachMusic(context);
   this.room=context.createConvolver();this.room.buffer=cathedralImpulse(context);
   const low=context.createBiquadFilter(),high=context.createBiquadFilter(),wet=context.createGain();
   low.type='lowpass';low.frequency.value=4200;high.type='highpass';high.frequency.value=220;wet.gain.value=.14;
   this.room.connect(low);low.connect(high);high.connect(wet);wet.connect(this.master);
   this.initializing=Promise.all([...this.pending].map(async([name,promise])=>{
    const takes=await promise;if(!takes)return;
    const decoded=await Promise.all(takes.map(async bytes=>{if(!bytes)return null;try{return await context.decodeAudioData(bytes);}catch{return null;/* HTML audio remains available. */}}));
    if(!decoded.some(Boolean))return;
    this.buffers.set(name,decoded);
    if(NORMALIZED.has(name))this.takeGains.set(name,decoded.map(buffer=>buffer?takeGain(bufferRms(buffer)):1));
   }));
  }catch{
   this.context?.close().catch(()=>{});this.context=null;this.master=null;this.initializing=Promise.resolve();
  }
  return this.initializing;
 }
 /** Phones (17 Sep 2026): iOS ignores an <audio> element's volume (it is always 1), so on the touch path the music
  * element is routed through the context and its level lives on a gain node; the Music slider then works on an
  * iPhone too. The desktop keeps the element's own volume. */
 attachMusic(context){
  try{this.musicSource=context.createMediaElementSource(this.music);this.musicGain=context.createGain();this.musicGain.gain.value=this.musicLevel;this.musicSource.connect(this.musicGain);this.musicGain.connect(context.destination);this.music.volume=1;}
  catch{this.musicGain=null;}
 }
 start(){this.enabled=true;this.suspended=false;this.initialize();this.context?.resume().catch(()=>{});this.music.play().catch(()=>{});}
 pause(){this.suspended=true;this.music.pause();this.clear();this.context?.suspend().catch(()=>{});}
 resume(){if(this.enabled){this.suspended=false;this.context?.resume().catch(()=>{});this.music.play().catch(()=>{});}}
 setListener(position,yaw){this.listener={x:position.x,z:position.z,yaw};}
 /** Swap the looping track (pause menu, Music track). preview plays it even while the game is paused so it can be heard. */
 setTrack(url,{preview=false}={}){if(!url)return;const next=new URL(url,location.href).href;if(this.music.src===next)return;const playing=!this.music.paused;this.music.src=next;this.music.load();if(playing||(preview&&this.enabled))this.music.play().catch(()=>{});}
 setMusic(value){this.musicLevel=clamp(value,0,1)*.375;/* 25 % under round 2 (user, 16 Sep) */if(this.musicGain){this.musicGain.gain.value=this.musicLevel;this.music.volume=1;}else this.music.volume=this.musicLevel;}
 setSfx(value){this.volume=clamp(value,0,1);this.master?.gain.setTargetAtTime(this.volume,this.context.currentTime,.015);}
 status(){return`${this.context?.state==='running'?'Spatial audio':this.suspended?'Audio paused':'Audio ready'} · ${this.buffers.size}/${SOUNDS.length} sounds · ${this.pool.size} voices`;}
 play(name,gain=1,position){
  if(!this.enabled||this.suspended)return;
  const take=pickTake(this.paths[name],this.lastTake.get(name)??-1);
  if(!take.value)return;
  this.lastTake.set(name,take.index);
  const placement=soundPlacement(this.listener,position),level=clamp(gain,0,1)*placement.gain*soundLevel(name)*(this.takeGains.get(name)?.[take.index]??1);
  const decoded=this.buffers.get(name),buffer=decoded?.[take.index]??decoded?.find(Boolean),context=this.context;
  if(buffer&&context?.state==='running'){
   const source=context.createBufferSource(),volume=context.createGain(),pan=context.createStereoPanner();
   source.buffer=buffer;source.playbackRate.value=.93+Math.random()*.10;volume.gain.value=level;pan.pan.value=placement.pan;
   source.connect(volume);volume.connect(pan);pan.connect(this.master);pan.connect(this.room);
   let disposed=false;const voice={stop:()=>{try{source.stop();}catch{}},dispose:()=>{
    if(disposed)return;disposed=true;source.disconnect();volume.disconnect();pan.disconnect();this.pool.delete(voice);
   }};
   source.onended=voice.dispose;this.pool.add(voice);source.start();return;
  }
  const element=new Audio(take.value);element.volume=level*this.volume;element.playbackRate=.93+Math.random()*.10;
  const voice={stop:()=>element.pause(),dispose:()=>this.pool.delete(voice)};this.pool.add(voice);
  element.addEventListener('ended',voice.dispose,{once:true});element.play().catch(voice.dispose);
 }
 clear(){for(const voice of this.pool){voice.stop();voice.dispose();}this.pool.clear();}
}
