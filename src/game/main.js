// Genex hosting (17 Sep 2026): player identity for the hosted game, the very first thing in the boot sequence
// (the genex-threejs-embed-auth card). Guests play at once; nothing below awaits it, so the renderer and the
// loading screen come up exactly as before.
import {initEmbed} from '@genex-ai/embed-sdk';
import {GENEX} from '../genex.config.ts';
initEmbed({slug:GENEX.slug,apiUrl:GENEX.apiUrl,dashboardOrigins:GENEX.dashboardOrigins});
import './style.css';
import {initializePreferences} from './preferences.js';
import {updateVitals,liftVeil} from './hud.js';
import {unobstructedCameraPosition,cameraOrbitPosition} from './camera-collision.js';
import {bladeImpactPoint,weaponGroundContact} from './contact-feedback.js';
import {actorCapsule,actorDimensions} from './actor-scale.js';
import {AttackInput} from './player-combo.js';
// Touch (17 Sep 2026, the mobile pass): device.js decides, touch-controls.js is the input layer, texture-budget.js the
// phone's texture cap. Every touch branch below sits behind touchMode; the desktop path is what shipped.
import {detectTouchDevice,fovForAspect} from './device.js';
import {createTouchControls} from './touch-controls.js';
import {TOUCH_TEXTURE_CAP} from './texture-budget.js';
import pkg from '../../package.json' with {type:'json'};
import * as T from 'three';import{createRendering}from'./rendering.js';import{buildArena}from'./arena.js';import{loadActors}from'./actors.js';import{ASSETS,MOBILE_ASSETS,MUSIC_TRACKS}from'./asset-paths.js';import{Fight,HEALTH}from'./encounter.js';import{MotionState}from'./motion.js';import{sweptWeaponContact,strikeIndex}from'./weapon-motion.js';import{GameAudio}from'./audio.js';import{Effects}from'./effects.js';import{createCombatEffects}from'./impact-effects.js';import{startCaptureWorker}from'./capture-worker.js';
const $=id=>document.getElementById(id),canvas=$('game');const touchMode=detectTouchDevice({search:location.search,matchMedia:globalThis.matchMedia?.bind(globalThis),navigator});document.body.classList.toggle('touch',touchMode);const graphics=createRendering(canvas,{touch:touchMode}),{scene,camera,renderer}=graphics;const fight=new Fight(ASSETS.motion),motion=new MotionState({animationMetadata:ASSETS.motion,bounds:{minX:-9.5,maxX:9.5,minZ:-15.5,maxZ:16},approachDistance:ASSETS.motion?.boss?.approachDistance??2.35});const audio=new GameAudio(ASSETS,{routeMusic:touchMode}),effects=new Effects(scene);let floorStyle='basalt',actors,arena,combat,paused=false,ready=false,lock=false,yaw=0,pitch=.15,distance=5.2,shake=0,fovKick=0,accum=0,last=performance.now(),elapsed=0,resultAt=0,noticeUntil=0,bufferedAction=null,hitStop=0;const keys=new Set(),frames=[],attackInput=new AttackInput();let lastStat=0,frameCount=0,lastRenderAt=0,touch=null;
// The phone path loads the 1024-texture copies of the six heavy models and the seal (asset-paths.js MOBILE_ASSETS); the desktop table is untouched.
const paths=touchMode?{...ASSETS,...MOBILE_ASSETS}:ASSETS,dimensions={player:actorDimensions(false,ASSETS.motion.player),boss:actorDimensions(true,ASSETS.motion.boss)};
try{$('load-detail').textContent='Carving the cathedral.';arena=await buildArena(scene,{stone:{map:ASSETS.stone},floor:{map:ASSETS.floor},shadowScale:touchMode?.5:1,textureCap:touchMode?TOUCH_TEXTURE_CAP:0,lightPool:touchMode?4:9,lightBudget:touchMode,monument:paths.monument,monumentLod:paths.monumentLod,floorSeal:paths.floorSeal,floorSealNR:paths.floorSealNR});motion.groundColliders=arena.groundColliders;arena.setFloorStyle(floorStyle);$('load-detail').textContent='The exile and the keeper.';actors=await loadActors(scene,paths,{textureCap:touchMode?TOUCH_TEXTURE_CAP:0,serial:touchMode});for(const a of Object.values(actors))a.gizmo.visible=!$('telemetry').hidden;actors.player.reset(motion.player);actors.boss.reset(motion.boss);actors.player.update(.2,0,fight.player,motion.player);actors.boss.update(.2,0,fight.boss,motion.boss);combat=createCombatEffects({scene,camera,effects,actors,fight,audio,post:graphics.post});
 // Touch: the effect flashes (hood aura, fissure glow, impact flash) stay dark; the weapons' fire lights stay. Decided once,
 // before the first frame, so three never rebuilds a shader mid-fight.
 if(touchMode)scene.traverse(o=>{if(o.isLight&&o.userData.cosmetic&&!o.userData.weaponLight)o.visible=false;});
 graphics.warm();ready=true;$('loading').hidden=true;}catch(e){console.error(e);$('load-detail').textContent='An asset failed to load. Reload to try again.';}
function input(){const stick=touch?.vector;return{forward:T.MathUtils.clamp((keys.has('KeyW')?1:0)-(keys.has('KeyS')?1:0)+(stick?.forward||0),-1,1),right:T.MathUtils.clamp((keys.has('KeyD')?1:0)-(keys.has('KeyA')?1:0)+(stick?.right||0),-1,1),cameraYaw:yaw,lockOn:lock};}
// The camera's base field of view: 52 as shipped; on a phone held upright it opens with the aspect (device.js).
const baseFov=()=>touchMode?fovForAspect(camera.aspect):52;
// Camera trauma (round 3): hits add to one 0..1 value that decays linearly; cameraStep shakes on its square.
function addTrauma(value){shake=Math.min(1,shake+Math.max(0,value));}
function notice(text){$('notice').textContent=text;$('notice').style.opacity=1;noticeUntil=elapsed+2.7;}
function request(name){
 if(paused||fight.status!=='fighting')return;
 if(fight.request(name)){bufferedAction=null;if(name==='dodge')motion.beginDodge(input());}
 else if(fight.player.action)bufferedAction={name,expires:elapsed+.16};
 else if(name==='heal'&&!fight.player.flasks)notice('No ember draughts left');
 else if(name==='heal'&&fight.player.health>=100)notice('Health is already full');
 else if(fight.player.stamina<(fight.timings.player[name]?.cost||0))notice(fight.player.blocking?'Not enough stamina · Lower your shield to recover':'Not enough stamina');
}
function start(){if(!ready)return;clearPointerGesture();fight.reset();motion.reset();fight.start();keys.clear();paused=false;lock=true;yaw=0;pitch=.15;resultAt=0;effects.reset();combat?.reset();graphics.puddles.reset();bufferedAction=null;hitStop=0;shake=0;fovKick=0;camera.fov=baseFov();camera.updateProjectionMatrix();if(touchMode)distance=camera.aspect<1?6.2:5.4;attackInput.cancel();audio.clear();audio.start();liftVeil();$('result').hidden=true;$('hud').hidden=false;actors.player.reset(motion.player);actors.boss.reset(motion.boss);actors.player.update(.2,elapsed,fight.player,motion.player);actors.boss.update(.2,elapsed,fight.boss,motion.boss);accum=0;last=performance.now();$('phase-caption').textContent='THE VIGIL';arena?.sealHeat?.(.03);canvas.focus();}
$('begin').onclick=start;$('retry').onclick=start;$('restart').onclick=()=>{closeSettings();start();};
$('version').textContent='v'+pkg.version;console.info(`Lost Cathedral v${pkg.version}${touchMode?' · touch controls':''}`);
function openSettings(){paused=true;keys.clear();clearPointerGesture();touch?.releaseAll();audio.pause();$('settings-title').textContent=fight.status==='ready'?'Settings':'Pause';$('settings').showModal();if(document.pointerLockElement)document.exitPointerLock();}
function closeSettings(){if($('settings').open)$('settings').close();paused=false;last=performance.now();accum=0;audio.resume();canvas.focus();}
// No start menu: the fight begins the moment the assets are in, out of a black veil that lifts over 1.5 s (#veil in
// style.css; start() re-covers and lifts again on a restart). Browsers refuse audio before a user gesture and there is
// no button to press any more, so the first key or click that is not Escape resumes the music and the AudioContext;
// the fight itself never waits for it. #begin stays in index.html, hidden, as the capture scripts' restart hook.
function unlockAudio(e){if(e.code==='Escape'||!audio.enabled)return;for(const type of ['keydown','pointerdown','pointerup','touchend'])removeEventListener(type,unlockAudio);if(!audio.suspended)audio.resume();}
addEventListener('keydown',unlockAudio);addEventListener('pointerdown',unlockAudio);
// Touch (17 Sep 2026): on iOS a touch's pointerdown is not a user activation for audio; its pointerup/touchend is.
if(touchMode){addEventListener('pointerup',unlockAudio);addEventListener('touchend',unlockAudio);}
$('close-settings').onclick=closeSettings;$('resume').onclick=closeSettings;$('settings').addEventListener('cancel',e=>{e.preventDefault();closeSettings();});
initializePreferences({'music-track':value=>audio.setTrack(MUSIC_TRACKS[value]||ASSETS.music,{preview:$('settings').open}),floor:value=>{floorStyle=value;arena?.setFloorStyle(value);},quality:value=>graphics.quality(value),brightness:value=>renderer.toneMappingExposure=value,'music-volume':value=>audio.setMusic(value),'effects-volume':value=>audio.setSfx(value),'show-stats':value=>{$('telemetry').hidden=!value;for(const a of Object.values(actors||{}))a.gizmo.visible=value;}},touchMode?{defaults:{quality:'low'}}:{});addEventListener('keydown',e=>{if(fight.status==='fighting'&&!paused&&['Space','Tab','KeyW','KeyA','KeyS','KeyD'].includes(e.code))e.preventDefault();if(e.repeat)return;if(e.code==='Escape'){e.preventDefault();if($('settings').open)closeSettings();else openSettings();return;}if(paused||fight.status!=='fighting')return;const toggle=($('toggle-movement').checked&&['KeyW','KeyA','KeyS','KeyD'].includes(e.code))||($('toggle-shield').checked&&e.code==='KeyL');if(toggle&&keys.has(e.code))keys.delete(e.code);else keys.add(e.code);if(e.code==='KeyQ'&&fight.status==='fighting'){lock=!lock;notice(lock?'Locked on':'Free camera');}if(e.code==='Space')request('dodge');if(e.code==='KeyJ')attackInput.press(elapsed);if(e.code==='KeyK')request('heavy');if(e.code==='KeyR')request('heal');});
// J and the left button are tap-or-hold (src/game/player-combo.js): a release before the threshold is a light
// (a second one chains), holding past it starts the heavy at the threshold; K stays an instant heavy.
addEventListener('keyup',e=>{if(e.code==='KeyJ'){const tap=attackInput.release(elapsed);if(tap)request(tap);}if(($('toggle-movement').checked&&['KeyW','KeyA','KeyS','KeyD'].includes(e.code))||($('toggle-shield').checked&&e.code==='KeyL'))return;keys.delete(e.code);});
let dragging=false,pendingCameraClick=false,pointerStart=null;
function clearPointerGesture(){dragging=false;pendingCameraClick=false;pointerStart=null;}
canvas.addEventListener('contextmenu',e=>e.preventDefault());
canvas.addEventListener('pointerdown',e=>{
 if(touchMode&&e.pointerType==='touch')return;// the touch layer owns every finger (touch-controls.js)
 if(paused||fight.status!=='fighting')return;
 canvas.focus();
 if(e.button===0){
  dragging=true;pointerStart={x:e.clientX,y:e.clientY};
  // An unlocked viewport click is resolved on release so orbiting does not
  // spend stamina on an unintended attack. Locked combat goes through the tap/hold attack input.
  pendingCameraClick=!lock&&document.pointerLockElement!==canvas;
  if(!pendingCameraClick)attackInput.press(elapsed);
 }
 if(e.button===2)keys.add('Block');
 if(e.button===1){e.preventDefault();pendingCameraClick=false;lock=!lock;}
});
addEventListener('pointerup',e=>{
 if(touchMode&&e.pointerType==='touch')return;
 if(e.button===0){if(pendingCameraClick){if(!paused&&!lock&&fight.status==='fighting')request('light');}else{const tap=attackInput.release(elapsed);if(tap)request(tap);}clearPointerGesture();}
 if(e.button===2)keys.delete('Block');
});
addEventListener('pointercancel',e=>{if(touchMode&&e.pointerType==='touch')return;clearPointerGesture();attackInput.cancel();keys.delete('Block');});
addEventListener('pointermove',e=>{
 if(touchMode&&e.pointerType==='touch')return;
 if(paused||lock||fight.status!=='fighting')return;
 if(pendingCameraClick&&pointerStart&&Math.hypot(e.clientX-pointerStart.x,e.clientY-pointerStart.y)>4)pendingCameraClick=false;
 if((dragging&&!pendingCameraClick)||document.pointerLockElement===canvas){yaw-=e.movementX*.004;pitch=T.MathUtils.clamp(pitch+e.movementY*.003,-.08,.6);}
});
canvas.addEventListener('dblclick',()=>{if(!lock&&!paused&&fight.status==='fighting')canvas.requestPointerLock?.();});
canvas.addEventListener('wheel',e=>{distance=T.MathUtils.clamp(distance+e.deltaY*.004,4.3,8);},{passive:true});
// The touch layer (17 Sep 2026): the stick feeds input() above, a drag orbits like the mouse, the buttons go through the
// same request()/attackInput/keys the keyboard uses, so the fight rules never know which one was pressed.
touch=touchMode?createTouchControls({root:$('touch'),
 onLook(dx,dy){if(paused||lock||fight.status!=='fighting')return;yaw-=dx*.0075;pitch=T.MathUtils.clamp(pitch+dy*.005,-.08,.6);},
 onZoom(delta){distance=T.MathUtils.clamp(distance+delta*.02,4.3,8);},
 onAction(name,phase){
  if(name==='pause'){if(phase==='down'){if($('settings').open)closeSettings();else openSettings();}return;}
  if(paused||fight.status!=='fighting'){if(name==='attack'&&phase==='up')attackInput.cancel();if(name==='guard'&&phase==='up')keys.delete('Block');return;}
  if(name==='attack'){if(phase==='down')attackInput.press(elapsed);else{const tap=attackInput.release(elapsed);if(tap)request(tap);}}
  else if(name==='guard'){if(phase==='down')keys.add('Block');else keys.delete('Block');}
  else if(phase==='down'){if(name==='roll')request('dodge');else if(name==='flask')request('heal');else if(name==='lock'){lock=!lock;notice(lock?'Locked on':'Free camera');}}
 }}):null;
const workerMode=new URLSearchParams(location.search).get('capture-worker')==='1';
addEventListener('blur',()=>{keys.clear();clearPointerGesture();attackInput.cancel();touch?.releaseAll();if(fight.status==='fighting'&&!paused&&!workerMode)openSettings();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){clearPointerGesture();if(fight.status==='fighting'&&!paused&&!workerMode)openSettings();}});

function handleEvents(){for(const e of fight.drain()){
 combat?.event(e.type,{playerAt:bladeImpactPoint(actors.boss.segment,new T.Vector3(motion.player.x,1.15,motion.player.z)),bossAt:bladeImpactPoint(actors.player.segment,new T.Vector3(motion.boss.x,dimensions.boss.impactHeight,motion.boss.z)),action:e.action??e.name});
 if(e.type==='boss-hit'){effects.impact(bladeImpactPoint(actors.player.segment,new T.Vector3(motion.boss.x,dimensions.boss.impactHeight,motion.boss.z)),new T.Vector3(motion.boss.x-motion.player.x,0,motion.boss.z-motion.player.z).normalize());audio.play('playerHitArmor',1,motion.boss);addTrauma(e.action==='heavy'?.2:.14);hitStop=Math.max(hitStop,e.action==='heavy'?.10:.045);}
 if(['player-hit','guard-break','block'].includes(e.type)){effects.impact(bladeImpactPoint(actors.boss.segment,new T.Vector3(motion.player.x,1.15,motion.player.z)),new T.Vector3(motion.player.x-motion.boss.x,0,motion.player.z-motion.boss.z).normalize(),e.type==='block');audio.play(e.type==='block'?'block':'bossHitPlayer',1,motion.player);addTrauma(e.type==='block'?.24:.5);fovKick=e.type==='block'?1.2:3;hitStop=Math.max(hitStop,e.type==='block'?.04:.065);$('damage-flash').style.opacity=e.type==='block'?.12:.65;}
 if(e.type==='guard-break')notice('Guard broken · Lower your shield to recover');if(e.type==='heal'){effects.burst(new T.Vector3(motion.player.x,1.1,motion.player.z),0xeeb96b,32);notice('Ember restored');}if(e.type==='phase-change'){arena?.sealHeat?.(1);notice('The last vow is broken');$('phase-caption').textContent='THE REAPING';effects.burst(new T.Vector3(motion.boss.x,1.3*dimensions.boss.scale,motion.boss.z),0x8dafc0,50);}
 if(e.type==='victory'||e.type==='defeat'){resultAt=elapsed+2;keys.clear();$('result-title').textContent=e.type==='victory'?'OATH FULFILLED':'YOU DIED';$('result').classList.toggle('victory',e.type==='victory');$('result-overline').textContent=e.type==='victory'?'THE KEEPER FALLS':'THE VIGIL CONTINUES';$('result-detail').textContent=e.type==='victory'?`The last rite is yours. ${Math.floor(fight.time/60)}:${String(Math.floor(fight.time%60)).padStart(2,'0')} · ${fight.stats.evades} attacks evaded`:'Rise from the ash. Learn the rhythm. Return.';$('retry').textContent=e.type==='victory'?'Begin another vigil':'Rise again';}
 }}
function step(dt){audio.setListener(motion.player,yaw);if(bufferedAction){if(bufferedAction.expires<elapsed)bufferedAction=null;else if(!fight.player.action&&fight.hitstun===0){const name=bufferedAction.name;bufferedAction=null;request(name);}}fight.player.blocking=(keys.has('Block')||keys.has('KeyL'))&&!fight.player.action&&fight.hitstun===0;motion.step(dt,input(),fight);if(actors.player.gazeLock)actors.player.gazeLock.target=motion.boss;actors.player.update(dt,elapsed,fight.player,motion.player);actors.boss.update(dt,elapsed,fight.boss,motion.boss);
 for(const [a,state] of [[actors.player,fight.player],[actors.boss,fight.boss]]){
  for(const contact of a.footsteps){
   const wet=graphics.puddles.footstep(contact,{boss:a.isBoss});
   audio.play(a.isBoss?'footstep':'playerFootstep',(a.isBoss?Math.max(.04,.35-motion.geometry().distance*.018):.23)*(contact.kind==='landing'?1.5:1),contact.position);
   if(!wet)effects.ground(contact.position,(a.isBoss?.32:.17)*(contact.kind==='landing'?1.6:1));
  }
  const action=state.action,strike=action?strikeIndex(action.name,action.elapsed,a.isBoss,fight.timings[a.isBoss?'boss':'player']):-1;
  if(strike>=0&&action.groundStrike!==strike){const contact=weaponGroundContact(a.previousSegment,a.segment);if(contact){action.groundStrike=strike;effects.ground(contact,a.isBoss?1:.6);audio.play('impact',a.isBoss?.2:.12,contact);}}
 }
 const p=motion.player,b=motion.boss;const ph=actorCapsule(p,dimensions.player),bh=actorCapsule(b,dimensions.boss);const geo=motion.geometry();geo.playerHit=sweptWeaponContact(actors.player.previousSegment,actors.player.segment,bh,dimensions.boss.hurtRadius);geo.bossHit=sweptWeaponContact(actors.boss.previousSegment,actors.boss.segment,ph,dimensions.player.hurtRadius);fight.step(dt,geo);handleEvents();const kick=combat?.sample(dt);if(kick){if(kick.shake)addTrauma(kick.shake);hitStop=Math.max(hitStop,kick.hitStop);if(kick.fov)fovKick=kick.fov;}
 const ba=fight.boss.action;if(ba){const si=strikeIndex(ba.name,ba.elapsed,true,fight.timings.boss);if(si>=0&&ba.audioStrike!==si){ba.audioStrike=si;audio.play('bossSwing',1,motion.boss);}}const pa=fight.player.action;if(pa){const si=strikeIndex(pa.name,pa.elapsed,false,fight.timings.player);if(si>=0&&!pa.audio){pa.audio=true;audio.play('playerSwing',1,motion.player);}}
 }
function cameraStep(dt){const p=motion.player,b=motion.boss;let target=new T.Vector3(p.x,1.35,p.z);if(fight.status==='ready'){const t=elapsed*.045;camera.position.set(3.4+Math.sin(t)*.5,2.65,13.6);target.set(-.5,2,-7);camera.lookAt(target);return;}
 if(lock){const desired=Math.atan2(p.x-b.x,p.z-b.z);yaw+=Math.atan2(Math.sin(desired-yaw),Math.cos(desired-yaw))*Math.min(1,dt*5);target.lerp(new T.Vector3(b.x,dimensions.boss.focusHeight,b.z),.18);}
 const behind=new T.Vector3(Math.sin(yaw)*distance,2.25+pitch*3,Math.cos(yaw)*distance);const pos=new T.Vector3(p.x,pitch*1.4,p.z).add(behind).add(new T.Vector3(Math.cos(yaw)*.28,0,-Math.sin(yaw)*.28));const anchor=new T.Vector3(p.x,1.35,p.z),safe=cameraOrbitPosition(anchor,pos,arena.cameraColliders);if(cameraSnap){camera.position.copy(safe.position);cameraSnap=false;}else if(safe.blocked&&anchor.distanceTo(camera.position)>anchor.distanceTo(safe.position))camera.position.copy(safe.position);else camera.position.lerp(safe.position,1-Math.exp(-dt*7));camera.position.copy(unobstructedCameraPosition(anchor,camera.position,arena.cameraColliders).position);camera.position.y=Math.max(.35,camera.position.y);
 // Camera kick (round 3): trauma-driven and smooth - summed sines at incommensurate frequencies, not white noise -
 // squared so a tap of sparks is a snap and a slam a heave, with a little roll riding it. Linear decay, so a stack
 // of hits reads as one heave that settles instead of a buzz. (Pattern from the LinearAbilityCasting sandbox.)
 const trauma=shake*shake,st=elapsed*23;
 if(trauma>1e-4){camera.position.x+=(Math.sin(st)*.6+Math.sin(st*2.31+1.7)*.4)*trauma*.13;camera.position.y+=(Math.sin(st*1.37+4.2)*.6+Math.sin(st*2.79+.3)*.4)*trauma*.09;}
 camera.lookAt(target);
 if(trauma>1e-4)camera.rotateZ((Math.sin(st*.83+2.9)*.6+Math.sin(st*3.11+5.1)*.4)*trauma*.026);
 shake=Math.max(0,shake-dt*1.9);
 // Field of view: a touch wider on the run and through a roll, a punch IN on the heavy's hit, a flinch OUT on a hit
 // taken or a slam (fovKick, set by the fight events and the combat effects). Base 52, never more than +-6.
 const runWiden=T.MathUtils.clamp(((actors?.player.speed||0)-1.2)/3,0,1)*3.2,rolling=fight.player.action?.name==='dodge'?2.2:0;
 const fovTarget=baseFov()+runWiden+rolling+T.MathUtils.clamp(fovKick,-6,6);
 camera.fov+=(fovTarget-camera.fov)*(1-Math.exp(-dt*9));camera.updateProjectionMatrix();fovKick*=Math.exp(-dt*6.5);
 }
function hud(){updateVitals(fight,HEALTH.boss);if(touch){touch.show(fight.status==='fighting'&&!paused);touch.setFlasks(fight.player.flasks);touch.setLock(lock);}$('lock-mark').hidden=!lock||fight.status!=='fighting';if(lock){const v=new T.Vector3(motion.boss.x,dimensions.boss.lockHeight,motion.boss.z).project(camera);$('lock-mark').style.left=(v.x*.5+.5)*innerWidth+'px';$('lock-mark').style.top=(-v.y*.5+.5)*innerHeight+'px';}if(elapsed>noticeUntil)$('notice').style.opacity=0;if(resultAt&&elapsed>resultAt){$('result').hidden=false;resultAt=0;}}
// One simulation tick (gameplay at 120 Hz inside, presentation once). Shared by the
// requestAnimationFrame loop and the capture worker, which steps a hidden tab by hand.
function simulate(dt){elapsed+=dt;if(!ready||paused)return;if(fight.status==='fighting'){const held=attackInput.update(elapsed);if(held)request(held);const stopped=Math.min(hitStop,dt);hitStop-=stopped;accum+=dt-stopped;while(accum>=1/120&&hitStop<=0){step(1/120);accum-=1/120;if(hitStop>0)accum=0;}}else{actors.player.update(dt,elapsed,fight.player,motion.player);actors.boss.update(dt,elapsed,fight.boss,motion.boss);}arena.update(elapsed,camera);effects.update(dt);combat?.update(dt,elapsed);cameraStep(dt);hud();$('damage-flash').style.opacity=String(Number($('damage-flash').style.opacity||0)*Math.exp(-dt*5));}
function frame(now){const raw=(now-last)/1000;last=now;const dt=Math.min(raw,.05);simulate(dt);if(ready&&!document.hidden&&(!paused||now-lastRenderAt>=100)){graphics.render();lastRenderAt=now;}
 frames.push(raw*1000);if(frames.length>240)frames.shift();frameCount++;if(now-lastStat>600){lastStat=now;const sorted=[...frames].sort((a,b)=>a-b);$('telemetry').textContent=`${Math.round(1000/(frames.reduce((a,b)=>a+b,0)/frames.length))} FPS · p95 ${sorted[Math.floor(sorted.length*.95)]?.toFixed(1)} ms\n${renderer.info.render.calls} calls · ${Math.round(renderer.info.render.triangles/1000)}k triangles\n${renderer.domElement.width} × ${renderer.domElement.height} · MSAA 4 / SMAA · v${pkg.version}${touchMode?' · touch':''}\nHP ${fight.player.health} · stamina ${fight.player.stamina.toFixed(0)} · boss ${fight.boss.health}\n${fight.status} · phase ${fight.boss.phase} · ${fight.boss.action?.name||'approach'} ${fight.boss.action?.elapsed.toFixed(2)||''}\nRange ${motion.geometry().distance.toFixed(2)} m · dealt ${fight.stats.damage}\nHits ${fight.stats.hits} · blocked ${fight.stats.blocks} · evaded ${fight.stats.evades}\n${audio.status()}`;}requestAnimationFrame(frame);}
requestAnimationFrame(frame);

// Read-only inspection hook for scripted browser playtests (scripts/browser-playtest.mjs).
let cameraSnap=false;
window.__vesper={version:pkg.version,touch:touchMode,get touchControls(){return touch;},fight,motion,keys,effects,get combat(){return combat;},get arena(){return arena;},graphics,request,get ready(){return ready;},get actors(){return actors;},get lock(){return lock;},set lock(value){lock=!!value;},get paused(){return paused;},get elapsed(){return elapsed;},
 // Camera control for scripted captures (scripts/game-capture.mjs): yaw/pitch/distance are the orbit values; the next camera step snaps instead of easing.
 get view(){return{yaw,pitch,distance};},setView({yaw:y,pitch:p,distance:d,lock:l}={}){if(Number.isFinite(y))yaw=y;if(Number.isFinite(p))pitch=T.MathUtils.clamp(p,-.08,.6);if(Number.isFinite(d))distance=T.MathUtils.clamp(d,2,12);if(l!==undefined)lock=!!l;cameraSnap=true;}};
if(workerMode)startCaptureWorker({
 prepare({quality:mode,width,height,menu,hud:showHud,gizmos=false}){
  if($('settings').open)$('settings').close();paused=false;audio.setMusic(0);audio.setSfx(0);
  // Captures never inherit the profile's performance-monitor preference: facing lines only on request.
  $('telemetry').hidden=true;for(const a of Object.values(actors))a.gizmo.visible=!!gizmos;
  graphics.quality(mode);renderer.setSize(width,height,false);graphics.composer.setSize(width,height);camera.aspect=width/height;camera.updateProjectionMatrix();
  if(menu){fight.reset();motion.reset();keys.clear();effects.reset();combat?.reset();graphics.puddles.reset();actors.player.reset(motion.player);actors.boss.reset(motion.boss);$('hud').hidden=true;$('result').hidden=true;}
  else start();
  for(const id of ['hud','notice'])$(id).style.visibility=showHud?'':'hidden';
 },
 setView(view){window.__vesper.setView(view);},
 advance(seconds){const steps=Math.max(1,Math.round(seconds*60));for(let i=0;i<steps;i++)simulate(1/60);graphics.render();},
 state(){const gl=renderer.getContext();const t0=performance.now();for(let i=0;i<4;i++){graphics.render();gl.finish();}const renderMs=+((performance.now()-t0)/4).toFixed(1);return{status:fight.status,view:{yaw,pitch,distance},player:{x:motion.player.x,z:motion.player.z,yaw:motion.player.yaw},boss:{x:motion.boss.x,z:motion.boss.z},bossAction:fight.boss.action?.name||null,playerAction:fight.player.action?.name||null,calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,renderMs,size:[renderer.domElement.width,renderer.domElement.height]};},
 capture(type){graphics.render();return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('toBlob failed')),type,.88));},
 finish(){for(const id of ['hud','notice'])$(id).style.visibility='';}
});
// Straight into the fight, out of the dark: no start menu (see liftVeil). Last, after every `let` above is initialised.
if(ready)start();
