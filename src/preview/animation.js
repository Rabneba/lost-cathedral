import './animation.css';
import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {TransformControls} from 'three/addons/controls/TransformControls.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {loadActors,shieldMountTransform} from '../game/actors.js';
import {VIDEO_URL} from './idle-video-source.js';
import {ASSETS} from '../game/asset-paths.js';
import {withActorScale,actorDimensions} from '../game/actor-scale.js';
import {actionTravelAt} from '../game/action-travel.js';
import {BOSS_TIMING, PLAYER_TIMING} from '../game/weapon-motion.js';
import {TRANSITION_DURATION,transitionTravel,transitionPhase} from './transition-sequence.js';
import {gamePlaybackRate} from './game-pace.js';
import playerCandidateMotion from '../../docs/player-combat-revision/player-video-candidate-v6-manifest.json' with {type:'json'};
import bossCandidateTiming from '../../assets/combat-revision/boss/v62-paced-aimed-slam/timing-map.json' with {type:'json'};
import bossSupportedMotion from '../../docs/combat-revision/boss-supported-candidate-manifest.json' with {type:'json'};

const $ = id => document.getElementById(id);
const viewStateKey='vesper-studio:'+location.pathname+location.search;
const idleStudy = new URLSearchParams(location.search).get('review') === 'idle';
const combatBossReview = new URLSearchParams(location.search).get('review') === 'combat-boss';
const capturedArmsReview = combatBossReview && new URLSearchParams(location.search).get('arms') === 'captured';
const combatPlayerReview = new URLSearchParams(location.search).get('review') === 'combat-player';
const leanReview = new URLSearchParams(location.search).get('review') === 'lean';
const rawComparison = new URLSearchParams(location.search).get('review') === 'raw-takes';
const videoReview = leanReview || rawComparison || new URLSearchParams(location.search).get('review') === 'video-motion';
const singleBossReview = idleStudy || videoReview;
if(combatBossReview||combatPlayerReview){
 document.querySelector('.sidebar-footer').firstChild.textContent=(combatPlayerReview?'Player motion':'Boss attack')+' correction under review. Not yet used in the game.';
}
if(combatBossReview){
 const comparison=document.createElement('a');
 comparison.href=capturedArmsReview?'?review=combat-boss':'?review=combat-boss&arms=captured';
 comparison.textContent=capturedArmsReview?'Compare rejected IK draft ↗':'Compare captured arm motion ↗';
 comparison.style.display='block';comparison.style.marginTop='12px';
 document.querySelector('.sidebar-footer').append(comparison);
}
const reviewClip = leanReview ? 'idle-forward-lean' : rawComparison ? (new URLSearchParams(location.search).get('take') === 'video' ? 'idle-video-retry' : 'idle-text-retry') : videoReview ? 'idle-video' : 'idle-study';
const textPrompt = 'Two-handed polearm idle. Staggered flat feet, soft knees, hips centered, slight forward lean. Hands apart ahead of chest. Slow inhale, shoulders rise; slow exhale, settle. No steps or shaking.';
let referenceVideo = null;
function syncReference(force = false) {
 if (!referenceVideo || !Number.isFinite(referenceVideo.duration)) return;
 if (!['idle-video','idle-video-raw','idle-video-retry','idle-forward-lean'].includes(clipName)) { referenceVideo.pause(); return; }
 const ratio = referenceVideo.duration / duration;
 const target = Math.min(referenceVideo.duration-.001, time*ratio);
 referenceVideo.playbackRate = speed*ratio;
 if (force || Math.abs(referenceVideo.currentTime-target)>.13) referenceVideo.currentTime = target;
 if (playing && !document.hidden) { if(referenceVideo.paused) referenceVideo.play().catch(()=>{}); }
 else referenceVideo.pause();
}
const descriptions = {
 'idle-forward-lean': ['Forward lean · 5°', 'Pelvis, torso and scythe lean forward together. Both boots stay planted. Switch to Before lean to compare at the same moment.'],
 'idle-video': ['Current cleanup', 'The version under review, including Blender posture and grip corrections. Compare its knees and hand movement with Raw Uthana.'],
 'idle-video-raw': ['Raw Uthana', 'The supplied video motion on this mesh, shifted to floor height only. Equipment is hidden because Uthana supplied body motion without a weapon attachment.'],
 'idle-video-retry': ['Video retry · raw', 'The new video request returned exactly the same motion as the first extraction. No pose corrections. Equipment hidden; body motion only.'],
 'idle-text-retry': ['Text take · raw', 'A new text-to-motion take on the same skeleton. No pose, grip, foot or loop corrections. Equipment hidden; body motion only.'],
 'idle-study': ['New idle', 'A breathing and stance study. Compare the weight, shoulders and scythe clearance with Previous idle.'],
 idle: ['Idle', 'The kept combat guard. The boss’s approved quarter-speed breathing is baked into this clip.'],
 'walk-forward': ['Walk', 'A deliberate forward advance. The moving grid helps you check each planted foot.'],
 'run-forward': ['Run', 'Forward movement. The moving grid helps you check foot contact and stride speed.'],
 sweep: ['Scythe sweep', 'A broad two-handed attack. Check both hands through the entire swing.'],
 slam: ['Overhead slam', capturedArmsReview?'Captured strike with a preparatory release and regrip, corrected arm rotation and planted boots. Final encounter checks are still in progress.':'A raised windup followed by a heavy downward strike.'],
 combo: ['Double sweep', 'Two committed swings, with a short delay between them.'],
 awaken: ['Phase change', 'The transition into the boss’s second phase.'],
 death: ['Death', 'The character collapses. Turn Loop off to hold the ending.'],
 light: ['Light attack', 'A quick sword cut followed by its recovery.'],
 heavy: ['Heavy attack', 'A slower, heavier sword strike.'],
 block: ['Shield guard', 'The shield is held in front of the character.'],
 dodge: ['Forward roll', 'A forward shoulder roll with a crouched landing. Enable ground travel to check its movement.'],
 heal: ['Heal', 'The recovery gesture used when drinking an ember draught.'],
 hit: ['Hit reaction', 'The brief recoil when the character takes a hit.'],
};
const orders = {
 boss: ['idle','walk-forward','run-forward','sweep','slam','combo','hit','awaken','death'],
 player: ['idle','light','heavy','block','dodge','heal','hit','death'],
};
function label(name) {
 if(combatPlayerReview&&name==='dodge')return 'Forward roll';
 if (leanReview && name === 'idle-video') return 'Before lean';
 if (rawComparison && name === 'idle-video') return 'Kept IK version';
 if (singleBossReview && name === 'idle') return 'Previous idle';
 if (descriptions[name]) return descriptions[name][0];
 return name.replace(/^run-/, 'Run · ').replace(/^walk-/, 'Walk · ').replaceAll('-', ' ');
}
function timing(name) {
 const base=(actor?.isBoss ? BOSS_TIMING : PLAYER_TIMING)[name];
 const meta=actor?.metadata?.clips?.[name];
 return base ? {...base,...meta} : null;
}

let renderer, scene, camera, orbit, actors, actor, actionState, activeAction, groundGrid, lightRig;
let loopCount = 0;
let previewDirty = true;
let transitionMode=false,transitionClock=0;
let character = 'boss', clipName = 'idle', time = 0, duration = 2, playing = false;
let speed = videoReview ? .25 : 1, viewName = leanReview ? 'side' : idleStudy ? 'body' : 'quarter', animationBounds = new T.Box3(), lastNow = 0, ready = false;
let speedSelection=singleBossReview?(videoReview?'.25':'1'):'game';
const origin = {x: 0, z: 0, yaw: 0};
const viewport = $('viewport');
const opponentState={health:100,blocking:false,action:{name:'idle',elapsed:0,directClipTime:true}};
function canShowOpponent(){return !singleBossReview&&!transitionMode&&['light','heavy','sweep','slam','combo'].includes(clipName);}
function updateOpponent(){
 if(!actors||!actor)return;
 const opponent=actors[character==='boss'?'player':'boss'];
 const visible=canShowOpponent()&&$('opponent').checked;
 opponent.root.visible=visible;
 $('opponent-option').hidden=!canShowOpponent();
 $('opponent-spacing').hidden=!visible;
 if(!visible)return;
 const distance=Number($('opponent-distance').value);
 $('opponent-distance-value').textContent=distance.toFixed(2)+' m';
 // Use the actual opposing character and its idle pose. It stays stationary
 // so a backwards blade or a short strike remains visible while scrubbing.
 const pose={x:origin.x,z:origin.z+distance,yaw:Math.PI};
 opponent.update(0,0,opponentState,pose);
 opponent.root.updateMatrixWorld(true);
 opponent.weapon.visible=false;
 if(opponent.shield)opponent.shield.visible=false;
 opponent.cloth.visible=false;
}

function updatePlaybackSpeed(){
 speed=speedSelection==='game'?(transitionMode?1:gamePlaybackRate(character,clipName,actor?.metadata||ASSETS.motion[character])):Number(speedSelection);
 $('speed').value=speedSelection;
}

function playingUI() {
 $('play').textContent = playing ? 'Ⅱ Pause' : '▶ Play';
 $('play').setAttribute('aria-label', playing ? 'Pause animation' : 'Play animation');
 $('playback-status').textContent = playing ? 'Playing' : time >= duration ? 'Finished' : 'Paused';
}
function setPlaying(value) {
 if (!ready) return;
 if (value && time >= duration) time = 0;
 playing = value; lastNow = performance.now(); playingUI(); syncReference(true);
}
function seek(value, dt = 0) {
 previewDirty = true;
 time = T.MathUtils.clamp(value, 0, duration);
 if(transitionMode){seekTransition(time,dt);updateGroundTravel();return;}
 actionState.action.elapsed = time;
 // Keep one action object for the whole selected clip. Replacing this object
 // each frame used to restart the game mixer and its crossfade continuously.
 actor.update(dt, time, actionState, origin);
 actor.root.updateMatrixWorld(true);
 updateGroundTravel();
 updateOpponent();
 facingReadout();
}
function seekTransition(target,dt){
 const previousZ=origin.z,state={health:100,blocking:false,action:null};
 if(target<transitionClock||dt===0){
  origin.z=0;actor.reset(origin);actor.update(1/60,0,state,origin);transitionClock=0;
 }
 const speed=actor.metadata.locomotionSpeed||(actor.isBoss?.45:2.96);
 while(transitionClock<target-1e-7){
  const step=Math.min(1/60,target-transitionClock);transitionClock+=step;
  origin.z=transitionTravel(transitionClock,speed);
  actor.update(step,transitionClock,state,origin);
 }
 const travel=origin.z-previousZ;camera.position.z+=travel;orbit.target.z+=travel;
 actor.root.updateMatrixWorld(true);
}
function updateGroundTravel() {
 if(!groundGrid)return;
 if(transitionMode){groundGrid.position.x=0;groundGrid.position.z=0;return;}
 let x=0,z=0;
 if($('travel').checked&&!singleBossReview){
  const meta=actor.metadata.clips?.[clipName]||{};
  if(/^(walk|run)-/.test(clipName)){
   const direction=clipName.replace(/^(walk|run)-/,'');
   const vectors={forward:[0,1],'forward-left':[Math.SQRT1_2,Math.SQRT1_2],left:[1,0],'back-left':[Math.SQRT1_2,-Math.SQRT1_2],backward:[0,-1],'back-right':[-Math.SQRT1_2,-Math.SQRT1_2],right:[-1,0],'forward-right':[-Math.SQRT1_2,Math.SQRT1_2]};
   const v=vectors[direction]||vectors.forward,distance=(time+loopCount*duration)*(meta.sourceSpeed||1);
   x=-v[0]*distance;z=-v[1]*distance;
  }else if(meta.travelCurve||clipName==='dodge'){
   const spec=actor.timings[clipName]||meta;
   const actionTime=spec.duration?time/duration*spec.duration:time;
   const direction=spec.direction||(clipName==='dodge'?'backward':'forward');
   z=(direction==='forward'?-1:1)*actionTravelAt(spec,actionTime);
  }
 }
 // Camera-relative travel: keep the character framed while the metre grid
 // passes beneath it. This exposes skating that an in-place preview conceals.
 groundGrid.position.x=x%1;groundGrid.position.z=z%1;
}
function timelineUI() {
 $('timeline').value = String(time);
 $('timeline').setAttribute('aria-valuetext', `${time.toFixed(2)} of ${duration.toFixed(2)} seconds`);
 $('time-readout').textContent = `${time.toFixed(2)} / ${duration.toFixed(2)} s`;
 const spec = timing(clipName);
 $('phase').textContent = transitionMode ? transitionPhase(time,actor.isBoss).toUpperCase() : spec ? time < spec.windup ? 'WINDUP' : time < spec.windup + spec.active ? 'STRIKE' : 'RECOVERY' : '';
}
function hold(value) { setPlaying(false); loopCount=0; seek(value); timelineUI(); playingUI(); syncReference(true); }

function clipButton(name) {
 const button = document.createElement('button');
 button.type = 'button'; button.className = 'clip-button'; button.dataset.clip = name;
 button.setAttribute('aria-pressed', name === clipName ? 'true' : 'false');
 button.setAttribute('aria-label', label(name));
 const text = document.createElement('span'); text.className = 'clip-name'; text.textContent = label(name);
 const length = document.createElement('span'); length.className = 'duration';
 length.textContent = `${actor.clips.get(name).getClip().duration.toFixed(2)} s`;
 button.append(text, length); button.addEventListener('click', () => selectClip(name));
 return button;
}
function buildClipList() {
 const primary = (leanReview ? ['idle-forward-lean','idle-video'] : rawComparison ? ['idle-text-retry','idle-video-retry','idle-video'] : videoReview ? [reviewClip,'idle-video-raw'] : singleBossReview ? [reviewClip,'idle'] : combatBossReview&&character==='boss'?(capturedArmsReview?['idle','walk-forward','sweep','slam']:['idle','walk-forward','slam']):orders[character]).filter(name => actor.clips.has(name));
 const remaining = singleBossReview||(combatBossReview&&character==='boss') ? [] : [...actor.clips.keys()].filter(name => !primary.includes(name)).sort((a,b) => a.localeCompare(b));
 $('clip-list').replaceChildren(...primary.map(clipButton));
 $('movement-list').replaceChildren(...remaining.map(clipButton));
 $('movement-section').hidden = remaining.length === 0;
 $('movement-section').open = false;
 $('movement-count').textContent = `· ${remaining.length} clips`;
}
function buildPoseControls() {
 const spec = timing(clipName);
 $('phase-track').replaceChildren(); $('pose-buttons').replaceChildren();
 $('pose-help').textContent = spec ? 'Jump to a pose, then step through it.' : 'Drag the timeline to pause on any pose.';
 if (!spec) return;
 for (const amount of [spec.windup, spec.active, spec.recovery]) {
  const segment = document.createElement('span'); segment.style.width = `${amount / duration * 100}%`;
  $('phase-track').append(segment);
 }
 const poses = [['Windup', spec.windup * .7]];
 if (clipName === 'combo') poses.push(['First strike', spec.windup + spec.active * .2], ['Second strike', spec.windup + spec.active * .82]);
 else poses.push(['Strike', spec.hitWindows?.length ? (spec.hitWindows[0][0]+spec.hitWindows[0][1])*.5 : spec.windup + spec.active * .5]);
 poses.push(['Recovery', spec.windup + spec.active + spec.recovery * .5]);
 for (const [name, at] of poses) {
  const button = document.createElement('button'); button.type = 'button'; button.textContent = name;
  button.addEventListener('click', () => hold(at)); $('pose-buttons').append(button);
 }
}
function measureAnimation() {
 // Fit the entire movement, including the separate weapon, rather than only
 // the character's standing pose. Sampling is done once when choosing a clip.
 const saved = time; animationBounds.makeEmpty();
 for (let i = 0; i <= 8; i++) {
  seek(duration * i / 8);
  actor.body.traverse(node => { if (node.isSkinnedMesh) node.computeBoundingBox(); });
  animationBounds.union(new T.Box3().setFromObject(actor.root));
 }
 seek(saved);
 const opponent=actors[character==='boss'?'player':'boss'];
 if(opponent.root.visible){
  opponent.body.traverse(node=>{
   if(node.isSkinnedMesh){
    node.computeBoundingBox();
    animationBounds.union(node.boundingBox.clone().applyMatrix4(node.matrixWorld));
   }
  });
 }
}
function fitView(name = viewName) {
 if (!ready) return;
 previewDirty = true;
 viewName = name;
 for (const button of document.querySelectorAll('[data-view]')) button.setAttribute('aria-pressed', String(button.dataset.view === name));
 if (name === 'head') {
  const head=actor.body.getObjectByName('mixamorigHead');
  const target=head.localToWorld(new T.Vector3(0,8,10));
  const direction=new T.Vector3(0,.06,1).applyQuaternion(head.getWorldQuaternion(new T.Quaternion())).normalize();
  orbit.target.copy(target);camera.position.copy(target).addScaledVector(direction,1.05*actor.worldScale);
 } else if (name === 'feet') {
  const left=actor.body.getObjectByName('mixamorigLeftFoot').getWorldPosition(new T.Vector3());
  const right=actor.body.getObjectByName('mixamorigRightFoot').getWorldPosition(new T.Vector3());
  const separation=left.distanceTo(right),target=left.lerp(right,.5);
  target.y=.3*actor.worldScale;orbit.target.copy(target);
  camera.position.copy(target).addScaledVector(new T.Vector3(1,.08,.25).normalize(),Math.max(2.2*actor.worldScale,separation*2.2));
 } else if (name === 'hands') {
  const left = actor.body.getObjectByName('mixamorigLeftHand').getWorldPosition(new T.Vector3());
  const right = actor.body.getObjectByName('mixamorigRightHand').getWorldPosition(new T.Vector3());
  // Look across the grip, not down the shaft where the blade hides the hands.
  const grip = right.clone().sub(left);
  const direction = new T.Vector3(grip.z, 0, -grip.x);
  if (direction.lengthSq() < .001) direction.set(0,0,1);
  const target = left.lerp(right, .5); orbit.target.copy(target);
  if (direction.dot(target.clone().sub(actor.root.position)) < 0) direction.negate();
  direction.normalize().y = .16; direction.normalize();
  camera.position.copy(target).addScaledVector(direction, Math.max(1.8, grip.length()*2.8));
 } else {
  const directions = {quarter:videoReview ? [0,.06,1] : singleBossReview ? [-.4,.1,.916] : [.55,.1,.83],front:[0,.08,1],side:[1,.08,0],back:[0,.08,-1]};
  const direction = new T.Vector3(...directions[name === 'body' ? 'quarter' : name]).normalize();
  if(transitionMode)actor.body.traverse(node=>{if(node.isSkinnedMesh)node.computeBoundingBox();});
  const bounds = name === 'body' ? new T.Box3() : transitionMode ? new T.Box3().setFromObject(actor.root) : animationBounds;
  if (name === 'body') actor.body.traverse(node => {
   if (node.isSkinnedMesh) { node.computeBoundingBox(); bounds.union(node.boundingBox.clone().applyMatrix4(node.matrixWorld)); }
  });
  const target = bounds.getCenter(new T.Vector3());
  const right = new T.Vector3(0,1,0).cross(direction).normalize(), up = direction.clone().cross(right);
  const tanV = Math.tan(T.MathUtils.degToRad(camera.fov / 2)), tanH = tanV * camera.aspect;
  let distance = 0;
  for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
   const relative = new T.Vector3(x,y,z).sub(target);
   distance = Math.max(distance, relative.dot(direction) + Math.max(Math.abs(relative.dot(right))/tanH, Math.abs(relative.dot(up))/tanV));
  }
  orbit.target.copy(target); camera.position.copy(target).addScaledVector(direction, Math.max(2.7,distance*1.14));
 }
 orbit.update();
}
function selectClip(name) {
 if (!actor.clips.has(name)) return;
 transitionMode=false;transitionClock=0;origin.x=origin.z=0;
 $('transition-preview').setAttribute('aria-pressed','false');
 const compareState = leanReview && activeAction ? {time,playing} : null;
 clipName = name; duration = actor.clips.get(name).getClip().duration; time = 0; loopCount=0;
 updatePlaybackSpeed();
 $('travel-option').hidden=singleBossReview||!(/^(walk|run)-/.test(name)||name==='dodge'||actor.metadata.clips?.[name]?.travelCurve);
 actor.reset(origin);
 actionState = {health:100, blocking:name === 'block', action:{name,elapsed:0,directClipTime:true,rawPose:['idle-video-raw','idle-video-retry','idle-text-retry'].includes(name)}};
 activeAction = actor.clips.get(name);
 activeAction.reset().setLoop(T.LoopOnce,1).setEffectiveWeight(1).setEffectiveTimeScale(1).stopFading().play();
 activeAction.clampWhenFinished = true;
 actor.current = activeAction; actor.lastAction = actionState.action;
 if (videoReview) {
  const raw = !['idle-video','idle-forward-lean'].includes(name);
  actor.weapon.visible = !raw && $('weapons').checked;
  actor.cloth.visible = !raw && $('cloth').checked;
  $('weapons').disabled = raw; $('cloth').disabled = raw;
  if (rawComparison) {
   const text = name === 'idle-text-retry';
   referenceVideo.hidden = text;
   document.querySelector('.source-heading').textContent = text ? 'Text input' : 'Approved video';
   document.querySelector('.text-motion-prompt').hidden = !text;
   document.querySelector('.source-note').textContent = text ? 'The text take has no source video. Compare its body motion with the other takes.' : 'Play, pause and scrub both views together.';
  }
 }
 for (const button of document.querySelectorAll('[data-clip]')) button.setAttribute('aria-pressed', String(button.dataset.clip === name));
 $('stage-animation').textContent = label(name);
 $('clip-description').textContent = descriptions[name]?.[1] || 'Directional movement, shown in place so you can inspect the footwork.';
 if(combatPlayerReview&&name==='dodge')$('clip-description').textContent='A captured forward shoulder roll, with reconstructed travel and a crouched recovery.';
 if(name==='idle'&&!actor.isBoss)$('clip-description').textContent='A grounded sword-and-shield guard with restrained breathing. Watch the knees, shoulders and cloth settle.';
 if (rawComparison && name === 'idle-video') $('clip-description').textContent = 'Your existing IK-corrected idle, preserved without changes. The new text and video takes are separate.';
 if (leanReview && name === 'idle-video') $('clip-description').textContent = 'The kept IK idle before the forward lean. This version is unchanged.';
 $('timeline').max = String(duration);
 buildPoseControls(); measureAnimation(); if (!compareState) fitView(); seek(compareState?.time ?? 0); timelineUI(); setPlaying(compareState?.playing ?? true);
}
function startTransitionPreview(){
 if(!ready||singleBossReview)return;
 transitionMode=true;transitionClock=0;clipName='transition-preview';duration=TRANSITION_DURATION;time=0;loopCount=0;
 updatePlaybackSpeed();
 updateOpponent();
 origin.x=origin.z=0;actor.reset(origin);actor.update(1/60,0,{health:100,blocking:false,action:null},origin);
 activeAction=null;actionState=null;
 for(const button of document.querySelectorAll('[data-clip]'))button.setAttribute('aria-pressed','false');
 $('transition-preview').setAttribute('aria-pressed','true');
 $('stage-animation').textContent=actor.isBoss?'Walk → stop':'Run → stop';
 $('clip-description').textContent='The character starts moving, then settles back into idle. Watch the boots, knees and cloth through the transition.';
 $('travel-option').hidden=true;$('timeline').max=String(duration);
 buildPoseControls();fitView(['hands','body','head'].includes(viewName)?'quarter':viewName);timelineUI();setPlaying(true);
}
function selectCharacter(name) {
 if (!ready) return;
 actor?.root && (actor.root.visible = false);
 character = name; actor = actors[name]; actor.root.visible = true;
 if(combatBossReview||combatPlayerReview){
  const candidateName=combatPlayerReview?'player':'boss';
  document.querySelector('.sidebar-footer').firstChild.textContent=name===candidateName
   ? name==='player'?'Player forearm correction is now in the development game.':capturedArmsReview?'Corrected attacks are now in the development game. Final encounter checks are in progress.':'Rejected draft: shoulder and elbow deformation is being repaired. Not used in the game.'
   : `Current game animation. Select ${candidateName==='player'?'Player':'Boss'} to review the new corrections.`;
 }
 const playerDimensions=actorDimensions(false,actors.player.metadata),bossDimensions=actorDimensions(true,actors.boss.metadata);
 const minDistance=(playerDimensions.bodyRadius??playerDimensions.groundRadius)+(bossDimensions.bodyRadius??bossDimensions.groundRadius)+.05;
 $('opponent-distance').min=minDistance.toFixed(2);
 $('opponent-distance').value=name==='boss'?String(Math.max(minDistance,actor.metadata.approachDistance||3.5)):minDistance.toFixed(2);
 const opponent=actors[name==='boss'?'player':'boss'];
 opponent.reset({x:0,z:Number($('opponent-distance').value),yaw:Math.PI});
 opponent.update(1/60,0,opponentState,{x:0,z:Number($('opponent-distance').value),yaw:Math.PI});
 actor.weapon.visible = $('weapons').checked;
 if (actor.shield) actor.shield.visible = $('weapons').checked;
 actor.cloth.visible = $('cloth').checked;
 $('character-name').textContent = actor.root.name;
 $('stage-character').textContent = actor.root.name.toUpperCase();
 $('transition-preview').textContent=name==='boss'?'Walk → stop':'Run → stop';
 for (const button of document.querySelectorAll('[data-actor]')) button.setAttribute('aria-pressed', String(button.dataset.actor === name));
 clipName = singleBossReview ? reviewClip : capturedArmsReview&&name==='boss'?'slam':'idle'; buildClipList(); selectClip(clipName);
 document.querySelector('.animation-library').scrollTop = 0;
}
function resize() {
 const {width,height} = viewport.getBoundingClientRect();
 if (!renderer || !width || !height) return;
 renderer.setSize(width,height,false); camera.aspect = width/height; camera.updateProjectionMatrix();
 if (ready) fitView();
}

// Every visible control has a handler before loading; fieldsets stay disabled
// until models, textures and the initial selected pose are ready.
for (const button of document.querySelectorAll('[data-actor]')) button.addEventListener('click', () => selectCharacter(button.dataset.actor));
for (const button of document.querySelectorAll('[data-view]')) button.addEventListener('click', () => fitView(button.dataset.view));
$('fit-view').addEventListener('click', () => fitView(['hands','body','head'].includes(viewName) ? 'quarter' : viewName));
$('transition-preview').addEventListener('click',startTransitionPreview);
$('play').addEventListener('click', () => setPlaying(!playing));
$('restart').addEventListener('click', () => { loopCount=0;seek(0); setPlaying(true); });
$('previous-frame').addEventListener('click', () => hold(time - 1/60));
$('next-frame').addEventListener('click', () => hold(time + 1/60));
$('timeline').addEventListener('input', event => hold(Number(event.target.value)));
$('timeline').addEventListener('pointerdown', () => setPlaying(false));
$('speed').addEventListener('change', event => { speedSelection=event.target.value;updatePlaybackSpeed();syncReference(true); });
$('cloth').addEventListener('change', event => { if (actor) actor.cloth.visible = event.target.checked; });
$('travel').addEventListener('change', updateGroundTravel);
$('opponent').addEventListener('change',()=>{updateOpponent();measureAnimation();fitView();});
$('opponent-distance').addEventListener('input',()=>{updateOpponent();measureAnimation();fitView();});
$('weapons').addEventListener('change', event => { if (actor) { actor.weapon.visible = event.target.checked; if (actor.shield) actor.shield.visible = event.target.checked; } });
$('gaze').addEventListener('change', event => { for (const a of Object.values(actors)) if (a.gazeLock) a.gazeLock.enabled = event.target.checked; if (actor) seek(time); });
$('facing').addEventListener('change', event => { if (!actor) return; for (const a of Object.values(actors)) a.gizmo.visible = event.target.checked; $('facing-readout').hidden = !event.target.checked; seek(time); });

// Shield mount editor: a gizmo on the shield wrapper (child of the ShieldSocket bone), so the
// edited local transform IS the manifest's shieldMount. Params are shown as JSON to send back.
let mountControls=null;
function mountJSON(){const a=actors.player,s=a.shield,scale=s.scale.x;return JSON.stringify({height:+(a.shieldMount.height*scale).toFixed(3),quaternion:s.quaternion.toArray().map(v=>+v.toFixed(4)),position:s.position.toArray().map(v=>+v.toFixed(4)),scale:+scale.toFixed(3),clip:clipName,time:+time.toFixed(2)});}
function syncMountFromShield(){const a=actors.player;a.shieldMount.position.copy(a.shield.position);a.shieldMount.quaternion.copy(a.shield.quaternion);$('mount-json').value=mountJSON();try{localStorage.setItem('vesper-studio:shieldMount',$('mount-json').value);}catch{}}
function restoreSavedMount(){let saved=null;try{saved=JSON.parse(localStorage.getItem('vesper-studio:shieldMount')||'null');}catch{}if(!saved)return;const a=actors.player;if(Array.isArray(saved.position))a.shield.position.fromArray(saved.position);if(Array.isArray(saved.quaternion))a.shield.quaternion.fromArray(saved.quaternion);if(Number.isFinite(saved.scale))a.shield.scale.setScalar(saved.scale);syncMountFromShield();}
function setupMountEditor(){
 mountControls=new TransformControls(camera,renderer.domElement);mountControls.setSpace('local');mountControls.setSize(.75);
 mountControls.addEventListener('dragging-changed',e=>{orbit.enabled=!e.value;});
 mountControls.addEventListener('change',()=>{previewDirty=true;});
 // Scale stays proportional: whichever handle moved, all three axes follow it.
 let lastUniformScale=1;
 mountControls.addEventListener('mouseDown',()=>{lastUniformScale=actors.player.shield.scale.x;});
 mountControls.addEventListener('objectChange',()=>{
  if(mountControls.mode==='scale'){const s=actors.player.shield.scale;const moved=[s.x,s.y,s.z].reduce((best,v)=>Math.abs(v-lastUniformScale)>Math.abs(best-lastUniformScale)?v:best,lastUniformScale);s.setScalar(Math.max(.2,moved));}
  syncMountFromShield();previewDirty=true;
 });
 scene.add(mountControls.getHelper());
 $('mount-edit').addEventListener('change',e=>{const on=e.target.checked;$('mount-tools').hidden=!on;if(on){selectCharacter('player');$('weapons').checked=true;actor.weapon.visible=true;actor.shield.visible=true;mountControls.attach(actors.player.shield);syncMountFromShield();}else mountControls.detach();previewDirty=true;});
 for(const b of document.querySelectorAll('#mount-tools [data-mode]'))b.addEventListener('click',()=>{mountControls.setMode(b.dataset.mode);for(const o of document.querySelectorAll('#mount-tools [data-mode]'))o.setAttribute('aria-pressed',String(o===b));});
 addEventListener('keydown',e=>{if(!$('mount-edit').checked||['TEXTAREA','INPUT'].includes(e.target.tagName))return;const mode={KeyT:'translate',KeyR:'rotate',KeyS:'scale'}[e.code];if(mode){mountControls.setMode(mode);for(const o of document.querySelectorAll('#mount-tools [data-mode]'))o.setAttribute('aria-pressed',String(o.dataset.mode===mode));}});
 $('mount-copy').addEventListener('click',()=>{navigator.clipboard?.writeText($('mount-json').value);$('mount-copy').textContent='Copied';setTimeout(()=>$('mount-copy').textContent='Copy params',1200);});
 $('mount-reset').addEventListener('click',()=>{const a=actors.player,m=shieldMountTransform(a.metadata);a.shield.position.copy(m.position);a.shield.quaternion.copy(m.quaternion);a.shield.scale.setScalar(1);try{localStorage.removeItem('vesper-studio:shieldMount');}catch{}syncMountFromShield();previewDirty=true;});
 restoreSavedMount();$('mount-editor').disabled=false;
}
function facingReadout() {
 if (!$('facing').checked || !actor?.gizmo) return;
 const m = actor.gizmo.measure(), fmt = v => Number.isFinite(v) ? `${v > 0 ? '+' : ''}${v.toFixed(0)}°` : '—';
 $('facing-readout').textContent = `Head ${fmt(m.head)} · pelvis ${fmt(m.body)} from the facing line (+ is the model's left)`;
}
document.addEventListener('change', () => { previewDirty = true; });
$('retry-load').addEventListener('click', () => location.reload());
document.addEventListener('keydown', event => {
 if (!ready || event.repeat || event.target.matches('input,select,textarea,summary,a')) return;
 if (event.code === 'Space') { event.preventDefault(); setPlaying(!playing); }
 if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') { event.preventDefault(); hold(time + (event.code === 'ArrowLeft' ? -1 : 1)/60); }
});
// Suspend the clock in a background tab without losing the user's Play/Pause
// choice. Returning to the inspector continues at the same point.
document.addEventListener('visibilitychange', () => { previewDirty=true;lastNow = performance.now(); syncReference(true); });
// Keep an inspected pose through a development reload instead of restarting
// every preview and losing the user's camera and paused frame.
addEventListener('pagehide',()=>{
 if(!ready||transitionMode)return;
 try{sessionStorage.setItem(viewStateKey,JSON.stringify({character,clipName,time,playing,speedSelection,
  viewName,camera:camera.position.toArray(),target:orbit.target.toArray(),
  weapons:$('weapons').checked,cloth:$('cloth').checked}));}catch{}
});

try {
 if (singleBossReview) {
  $('speed').querySelector('[value="game"]').hidden=true;
  $('transition-preview').hidden=true;
  document.title = 'Vesper — Boss idle study';
  document.querySelector('.studio-heading h1').textContent = 'Boss idle study';
  document.querySelector('.studio-heading p').textContent = 'Compare the new stance with Previous idle.';
  document.querySelector('[data-actor="player"]').hidden = true;
  document.querySelector('.character-switch').style.gridTemplateColumns = '1fr';
  document.querySelector('.sidebar-footer').textContent = 'A separate animation study, awaiting your review.';
 }
 if (videoReview) {
  document.title = 'Vesper — Video motion review';
  document.querySelector('.studio-heading h1').textContent = 'Video motion review';
  document.querySelector('.studio-heading p').textContent = 'Compare the approved video with the boss.';
  document.querySelector('.sidebar-footer').textContent = 'Compare the supplied motion with the current cleanup. Starts at your preferred 0.25× speed.';
  if (rawComparison) {
   document.title = 'Vesper — Raw idle takes';
   document.querySelector('.studio-heading h1').textContent = 'Raw idle takes';
   document.querySelector('.studio-heading p').textContent = 'Video retry, text generation and the kept IK version.';
   document.querySelector('.sidebar-footer').textContent = 'The corrected version is preserved. New takes are raw, with floor-height alignment only. Playback starts at 0.25×.';
  }
  if (leanReview) {
   document.title = 'Vesper — Forward lean';
   document.querySelector('.studio-heading h1').textContent = 'Forward lean';
   document.querySelector('.studio-heading p').textContent = 'The kept IK idle with a small shift forward.';
   document.querySelector('.sidebar-footer').textContent = '5° forward from the ankles, with planted boots. Before and after share the same timing. Playback starts at 0.25×.';
  }
  for (const option of $('speed').options) option.selected = Number(option.value) === speed;
  document.querySelector('.studio').classList.add('video-review');
  document.querySelector('.animation-section').append($('clip-description'));
  const comparison = document.createElement('div'); comparison.className = 'comparison-stage';
  if (leanReview) comparison.classList.add('reference-hidden');
  viewport.before(comparison); comparison.append(viewport);
  const panel = document.createElement('section'); panel.className = 'source-panel'; panel.setAttribute('aria-label','Approved video reference');
  const heading = document.createElement('h2'); heading.className = 'source-heading'; heading.textContent = 'Approved video'; panel.append(heading);
  referenceVideo = document.createElement('video'); referenceVideo.src = VIDEO_URL; referenceVideo.muted = true; referenceVideo.playsInline = true; referenceVideo.preload = 'auto'; referenceVideo.setAttribute('aria-label','Approved boss idle performance');
  panel.append(referenceVideo);
  if (rawComparison) { const prompt = document.createElement('blockquote'); prompt.className = 'text-motion-prompt'; prompt.textContent = textPrompt; prompt.hidden = true; panel.append(prompt); }
  const note = document.createElement('p'); note.className = 'source-note'; note.textContent = 'Play, pause and scrub both views together.'; panel.append(note); comparison.append(panel);
  const showLabel = document.createElement('label'); const show = document.createElement('input'); show.type = 'checkbox'; show.checked = !leanReview; showLabel.append(show,rawComparison ? ' Source reference' : ' Approved video'); document.querySelector('.display-options').append(showLabel);
  show.addEventListener('change',()=>{comparison.classList.toggle('reference-hidden',!show.checked);});
  referenceVideo.addEventListener('loadedmetadata',()=>{if(ready)syncReference(true);});
 }
 renderer = new T.WebGLRenderer({canvas:$('preview'),antialias:true,powerPreference:'high-performance'});
 renderer.setPixelRatio(Math.min(devicePixelRatio,1.5)); renderer.toneMapping = T.ACESFilmicToneMapping;
 scene = new T.Scene(); scene.background = new T.Color(0x2a3136);
 const pmrem = new T.PMREMGenerator(renderer), room = new RoomEnvironment();
 scene.environment = pmrem.fromScene(room,.04).texture; scene.environmentIntensity = .7; room.dispose(); pmrem.dispose();
 camera = new T.PerspectiveCamera(38,1,.03,80);
 orbit = new OrbitControls(camera,renderer.domElement); orbit.minDistance = .7; orbit.maxDistance = 22;
 orbit.target.set(0,1.3,0); camera.position.set(3,2,6); orbit.update();
 orbit.addEventListener('start', () => { for (const button of document.querySelectorAll('[data-view]')) button.setAttribute('aria-pressed','false'); });
 orbit.addEventListener('change', () => { previewDirty = true; });
 const key = new T.DirectionalLight(0xe1edf4,2.5); key.position.set(-3,5,4);
 {
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFShadowMap;
  key.castShadow = true; key.shadow.mapSize.set(2048,2048);
  Object.assign(key.shadow.camera,{left:-4,right:4,top:5,bottom:-3,near:.1,far:16});
  key.shadow.bias = -.0002; key.shadow.normalBias = .006;
 }
 lightRig=new T.Group();lightRig.add(key,key.target);scene.add(lightRig,new T.HemisphereLight(0xadcadb,0x645a47,.7));
 const floor = new T.Mesh(new T.PlaneGeometry(40,40),new T.MeshStandardMaterial({color:0x30393e,roughness:.93}));
 floor.receiveShadow = true;
 floor.rotation.x = -Math.PI/2; floor.position.y = -.001; scene.add(floor);
 groundGrid = new T.GridHelper(40,80,0xa2afb6,0xa2afb6); groundGrid.position.y = .002;
 groundGrid.material.transparent = true; groundGrid.material.opacity = .45; scene.add(groundGrid);
 new ResizeObserver(resize).observe(viewport); resize();
 // Review any candidate player bundle without a code change (dev server only):
 // ?character=player&playerRig=assets/x/candidate.glb&playerManifest=docs/x/candidate-manifest.json
 const rigParams=new URLSearchParams(location.search),playerRigOverride=rigParams.get('playerRig'),playerManifestOverride=rigParams.get('playerManifest')?await (await fetch('/'+rigParams.get('playerManifest'))).json():null;
 if(playerRigOverride)document.querySelector('.sidebar-footer').firstChild.textContent='Reviewing candidate '+playerRigOverride+'. Not used in the game.';
 actors = await loadActors(scene,{
  ...ASSETS,
  // Archived source/comparison takes retain their original authored scale.
  motion:playerManifestOverride?{...ASSETS.motion,player:playerManifestOverride}:combatPlayerReview?{...ASSETS.motion,player:playerCandidateMotion}:combatBossReview?{...ASSETS.motion,boss:capturedArmsReview?withActorScale(bossSupportedMotion,1.3):{...ASSETS.motion.boss,approachDistance:3.1,clips:{...ASSETS.motion.boss.clips,slam:bossCandidateTiming.clips.slam}}}:singleBossReview?{...ASSETS.motion,boss:withActorScale(ASSETS.motion.boss,1)}:ASSETS.motion,
  playerRig:playerRigOverride?new URL('/'+playerRigOverride,location.origin).href:combatPlayerReview?new URL('../../assets/player-combat-revision/player-video-candidate-v6.glb',import.meta.url).href:ASSETS.playerRig,
  bossRig:capturedArmsReview ? new URL('../../assets/combat-revision/boss/boss-combat-supported-review.glb',import.meta.url).href : combatBossReview ? new URL('../../assets/combat-revision/boss/v62-paced-aimed-slam/boss-paced-candidate.glb',import.meta.url).href : leanReview ? new URL('../../assets/idle-forward-lean/boss-forward-lean.glb',import.meta.url).href : rawComparison ? new URL('../../assets/idle-raw-comparison/boss-raw-takes.glb',import.meta.url).href : videoReview ? new URL('../../assets/idle-video-motion/boss-idle-diagnostic.glb',import.meta.url).href : idleStudy ? new URL('../../assets/idle-trial/boss-idle-study.glb',import.meta.url).href : ASSETS.bossRig,
  scythe:videoReview ? new URL('../../assets/idle-video-motion/scythe-fitted.glb',import.meta.url).href : idleStudy ? new URL('../../assets/exact-isolated-scythe-from-this-image-si-cmu1fy15.glb',import.meta.url).href : ASSETS.scythe,
  scytheHeight:videoReview ? 2.85 : idleStudy ? 3.2 : ASSETS.scytheHeight,
 });
 actors.player.root.visible = false; actors.boss.root.visible = false;
 setupMountEditor();
 ready = true; selectCharacter(combatPlayerReview?'player':'boss');
 const requestedView=new URLSearchParams(location.search).get('view');
 if(['quarter','front','side','back','body','hands','head','feet'].includes(requestedView))fitView(requestedView);
 let savedView;
 try{savedView=JSON.parse(sessionStorage.getItem(viewStateKey)||'null');}catch{}
 if(savedView&&['boss','player'].includes(savedView.character)&&actors[savedView.character].clips.has(savedView.clipName)){
  if(typeof savedView.weapons==='boolean')$('weapons').checked=savedView.weapons;
  if(typeof savedView.cloth==='boolean')$('cloth').checked=savedView.cloth;
  if(['game','.25','.5','1'].includes(savedView.speedSelection))speedSelection=savedView.speedSelection;
  selectCharacter(savedView.character);selectClip(savedView.clipName);
  hold(Number.isFinite(savedView.time)?savedView.time:0);
  if(['quarter','front','side','back','body','hands','head','feet'].includes(savedView.viewName))fitView(savedView.viewName);
  if([savedView.camera,savedView.target].every(v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite))){
   camera.position.fromArray(savedView.camera);orbit.target.fromArray(savedView.target);orbit.update();
  }
  setPlaying(savedView.playing===true);
 }
 // Direct links for reviews and scripted captures: ?character=player&clip=idle&time=1&view=side&facing=1
 const params=new URLSearchParams(location.search);
 if(['boss','player'].includes(params.get('character')))selectCharacter(params.get('character'));
 if(params.get('clip')&&actor.clips.has(params.get('clip')))selectClip(params.get('clip'));
 if(params.get('time')!==null&&Number.isFinite(Number(params.get('time')))){hold(Number(params.get('time')));setPlaying(false);}
 if(params.get('facing')==='1'){$('facing').checked=true;$('facing').dispatchEvent(new Event('change'));}
 if(params.get('gaze')==='0'){$('gaze').checked=false;$('gaze').dispatchEvent(new Event('change'));}
 if(params.get('weapons')==='0'){$('weapons').checked=false;$('weapons').dispatchEvent(new Event('change'));}
 if(['quarter','front','side','back','body','hands','head','feet'].includes(requestedView))fitView(requestedView);
 for (const id of ['character-controls','display-controls','view-controls','transport','transition-preview']) $(id).disabled = false;
 $('loading').hidden = true;
 // Capture bridge worker (scripts/capture-server.mjs, scripts/studio-shot.mjs): each studio shot is one
 // navigation of this tab; after rendering it the tab asks the server for the next shot. Works in a
 // hidden tab of an already-running Chrome, which is the only browser this machine can currently render in.
 if(params.get('capture-worker')==='1'){
  const server=params.get('capture-server')||'http://127.0.0.1:5199',jobId=params.get('capture-job'),shotIndex=params.get('capture-shot');
  (async()=>{
   try{
    if(jobId!==null){
     await new Promise(r=>setTimeout(r,250));
     orbit.update();lightRig.position.set(origin.x,0,origin.z);syncReference();timelineUI();playingUI();
     renderer.render(scene,camera);renderer.render(scene,camera);
     const readoutNode=document.getElementById('facing-readout');
     const state={readout:readoutNode&&!readoutNode.hidden?readoutNode.textContent:null,stage:document.getElementById('stage-animation')?.textContent,time:document.getElementById('timeline')?.value,size:[renderer.domElement.width,renderer.domElement.height]};
     const blob=await new Promise((resolve,reject)=>renderer.domElement.toBlob(b=>b?resolve(b):reject(new Error('toBlob failed')),'image/jpeg',.88));
     await fetch(`${server}/job/${jobId}/shot/${shotIndex}`,{method:'POST',headers:{'content-type':'image/jpeg','x-shot-state':btoa(unescape(encodeURIComponent(JSON.stringify(state))))},body:blob});
    }
   }catch(error){console.error('[capture-worker] shot failed',error);}
   for(;;){
    try{
     const response=await fetch(`${server}/job/next?kind=studio&wait=25000`);
     if(response.status===200){const next=await response.json();location.href=`${location.pathname}?${next.params}&capture-worker=1&capture-job=${next.id}&capture-shot=${next.index}`;return;}
    }catch{await new Promise(r=>setTimeout(r,2000));}
   }
  })();
 }
 renderer.setAnimationLoop(now => {
  const dt = Math.min(.1,Math.max(0,(now-lastNow)/1000)); lastNow = now;
  if (document.hidden) return;
  if (playing) {
   let next = time + dt*speed;
   if (next >= duration) {
    if ($('loop').checked) {next %= duration;loopCount++;}
    else { next = duration; playing = false; }
   }
   seek(next,dt*speed);
  }
  // The real travel preview can move eleven metres; keep its contact shadows
  // and light direction consistent instead of leaving the light at the start.
  const cameraChanged=orbit.update();
  if(!playing&&!previewDirty&&!cameraChanged)return;
  lightRig.position.set(origin.x,0,origin.z);
  syncReference(); timelineUI(); playingUI(); renderer.render(scene,camera);previewDirty=false;
 });
} catch (error) {
 console.error('Animation studio could not load:',error);
 try{const failed=new URLSearchParams(location.search);if(failed.get('capture-worker')==='1'&&failed.get('capture-job')!==null)fetch(`${failed.get('capture-server')||'http://127.0.0.1:5199'}/job/${failed.get('capture-job')}/fail`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({error:String(error?.message||error)})});}catch{}
 ready = false; $('loading').classList.add('failed');
 $('load-title').textContent = 'The characters could not load';
 $('load-detail').textContent = 'Check that the local game server is running, then try again.';
 $('retry-load').hidden = false;
}
