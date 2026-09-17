import test from 'node:test';
import assert from 'node:assert/strict';
import { Encounter } from '../src/game/combat.js';
import { MotionState, cameraRelativeDirection, runSpeedForDirection, horizontalDistance, facesTarget } from '../src/game/motion.js';

const approx = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
const fighting = () => { const encounter = new Encounter(); encounter.start(); return encounter.snapshot(); };

test('camera-relative movement rotates correctly and normalizes diagonal input', () => {
  const diagonal = cameraRelativeDirection({ forward: 1, right: 1 });
  approx(Math.hypot(diagonal.x, diagonal.z), 1);
  const turned = cameraRelativeDirection({ forward: 1, cameraYaw: Math.PI / 2 });
  approx(turned.x, -1);
  approx(turned.z, 0);
});

test('lock-on keeps the player facing the boss while strafing', () => {
  const motion = new MotionState();
  const state = fighting();
  for (let i = 0; i < 120; i++) motion.step(1 / 120, { right: 1, lockOn: true }, state);
  assert.ok(motion.player.x > 3.5 && motion.player.x < 4.2, 'accelerates into the strafe instead of instantly reaching full speed');
  assert.ok(facesTarget(motion.player, motion.boss, 0.02));
});

test('player and boss stay inside the arena including their body radius', () => {
  const motion = new MotionState();
  const state = fighting();
  for (let i = 0; i < 1200; i++) motion.step(1 / 120, { right: 1, forward: -1 }, state);
  assert.ok(motion.player.x <= 9.55 && motion.player.z <= 15.55);
  assert.ok(motion.boss.x <= 8.9 && motion.boss.z <= 14.9);
  assert.ok(horizontalDistance(motion.player, motion.boss) >= 1.59);
});

test('dodge travels the same distance at 30 and 120 updates per second', () => {
  const positions = [];
  for (const fps of [30, 120]) {
    const motion = new MotionState();
    const state = fighting();
    state.player.action = { name: 'dodge' };
    state.boss.action = { name: 'sweep' };
    motion.beginDodge({ right: 1 });
    for (let i = 0; i < Math.ceil(0.6 * fps); i++) motion.step(1 / fps, {}, state);
    positions.push(motion.player.x);
  }
  approx(positions[0], 3.4);
  approx(positions[1], 3.4);
});

test('dodge without directional input moves backward and stops at a wall', () => {
  const motion = new MotionState();
  const state = fighting();
  motion.player.z = 15;
  state.player.action = { name: 'dodge' };
  state.boss.action = { name: 'slam' };
  motion.beginDodge({});
  for (let i = 0; i < 72; i++) motion.step(1 / 120, {}, state);
  approx(motion.player.z, 15.55);
});

test('finished fights stop all movement and reset clears transient dodge state', () => {
  const motion = new MotionState();
  const state = fighting();
  motion.beginDodge({ right: 1 });
  state.status = 'defeat';
  motion.step(0.1, { forward: 1 }, state);
  assert.deepEqual(motion.player, { x: 0, z: 8, yaw: Math.PI });
  motion.reset();
  assert.equal(motion.dodge, null);
  assert.deepEqual(motion.geometry(), new MotionState().geometry());
});

const combatPace={locomotionSpeed:2.96,strafeSpeed:2.25,retreatSpeed:1.9,guardSpeed:1.45};
test('combat travel follows facing at any world angle and varies smoothly through diagonals',()=>{
 for(const yaw of [0,.6,Math.PI,Math.PI*1.7]){
  const direction=angle=>({x:Math.sin(yaw+angle),z:Math.cos(yaw+angle)});
  approx(runSpeedForDirection(direction(0),yaw,combatPace),2.96);
  approx(runSpeedForDirection(direction(Math.PI/2),yaw,combatPace),2.25);
  approx(runSpeedForDirection(direction(Math.PI),yaw,combatPace),1.9);
  let previous=runSpeedForDirection(direction(0),yaw,combatPace);
  for(let i=1;i<=360;i++){
   const speed=runSpeedForDirection(direction(i*Math.PI/180),yaw,combatPace);
   assert.ok(Math.abs(speed-previous)<.013,'no sudden speed change at a gait boundary');
   assert.ok(speed>=1.9&&speed<=2.96);previous=speed;
  }
 }
});

test('locked retreat uses the slower pace consistently at 30, 60 and 120 Hz',()=>{
 for(const fps of [30,60,120]){
  const state=fighting(),motion=new MotionState({animationMetadata:{player:combatPace}});
  state.boss.action={name:'awaken'};
  for(let frame=0;frame<fps*2;frame++)motion.step(1/fps,{forward:-1,lockOn:true},state);
  const expected=8+1.9*2-1.9*(1-Math.exp(-24))/12;
  approx(motion.player.z,expected);approx(motion.player.x,0);
 }
});

test('free-camera travel keeps the forward pace while guarded travel keeps the shield pace',()=>{
 for(const blocking of [false,true]){
  const state=fighting(),motion=new MotionState({animationMetadata:{player:combatPace}});
  state.player.blocking=blocking;state.boss.action={name:'awaken'};
  for(let frame=0;frame<120;frame++)motion.step(1/120,{forward:-1,lockOn:false},state);
  const speed=blocking?1.45:2.96;
  approx(motion.player.z,8+speed-speed*(1-Math.exp(-12))/12);
 }
});

test('full-body attacks and healing commit the stance instead of sliding beneath planted feet',()=>{
 for(const name of ['light','heavy','heal']){
  const state=fighting(),motion=new MotionState({animationMetadata:{player:combatPace}});
  state.player.action={name,elapsed:.8};state.boss.action={name:'awaken'};
  const start={...motion.player};
  for(let frame=0;frame<120;frame++)motion.step(1/120,{forward:1,right:1,lockOn:true},state);
  approx(motion.player.x,start.x);approx(motion.player.z,start.z);
 }
});

test('committing an attack settles incoming velocity without sustained attack movement',()=>{
 const state=fighting(),motion=new MotionState({animationMetadata:{player:combatPace}});
 state.player.action={name:'heavy',elapsed:.8};state.boss.action={name:'awaken'};
 motion.velocities.player.z=-2.96;
 for(let frame=0;frame<120;frame++)motion.step(1/120,{forward:1,lockOn:true},state);
 const afterSecond=motion.player.z;
 for(let frame=0;frame<120;frame++)motion.step(1/120,{forward:1,lockOn:true},state);
 assert.ok(Math.abs(motion.player.z-afterSecond)<.00001);
 assert.ok(Math.abs(motion.player.z-(8-2.96*(1-Math.exp(-24))/12))<.0001,'settling stays within a tenth of a millimetre of the analytic stop');
});

test('an attack can aim early, then stops turning after its commitment point',()=>{
 const state=fighting(),motion=new MotionState();state.boss.action={name:'awaken'};
 state.timings={player:{heavy:{windup:.88}}};
 state.player.action={name:'heavy',elapsed:.1};motion.boss.x=4;
 const initial=motion.player.yaw;motion.step(1/60,{lockOn:true},state);
 assert.notEqual(motion.player.yaw,initial);
 state.player.action.elapsed=.8;const committed=motion.player.yaw;motion.boss.x=-4;
 motion.step(1/60,{lockOn:true},state);approx(motion.player.yaw,committed);
});

// Directional rolls: pressing a direction with the roll turns the body into that
// heading through a quick transition and runs the authored forward roll along it.
const rollCurve=[[0,0],[.15,0],[.3,.6],[.65,1.5],[.9,1.8],[1.1,1.8]];
const ROLL_DISTANCE=1.8;
function rollFixture(){
 const metadata={player:{clips:{dodge:{duration:1.2,direction:'forward',travelCurve:rollCurve}}}};
 const motion=new MotionState({animationMetadata:metadata,bounds:{minX:-20,maxX:20,minZ:-20,maxZ:20}});
 const state={status:'fighting',player:{health:100,action:null,blocking:false},boss:{phase:1,action:{name:'awaken',elapsed:0}}};
 return {motion,state};
}
function roll(motion,state,input,{seconds=1.2,fps=120}={}){
 state.player.action={name:'dodge',elapsed:0};
 motion.beginDodge(input);
 for(let frame=0;frame<Math.round(seconds*fps);frame++){state.player.action.elapsed=frame/fps;motion.step(1/fps,input,state);}
}
function stand(motion,state,input,{seconds=1,fps=120}={}){
 state.player.action=null;
 for(let frame=0;frame<Math.round(seconds*fps);frame++)motion.step(1/fps,input,state);
}
const angleTo=(yaw,target)=>Math.abs(Math.atan2(Math.sin(yaw-target),Math.cos(yaw-target)));

test('a locked-on roll to the left travels left in world space and turns the body into it',()=>{
 const {motion,state}=rollFixture();
 const start={...motion.player},input={right:-1,cameraYaw:0,lockOn:true};
 state.player.action={name:'dodge',elapsed:0};motion.beginDodge(input);
 // The entry turn is quick and rate limited: still turning at a frame, done by 0.15 s.
 motion.step(1/120,input,state);
 assert.ok(angleTo(motion.player.yaw,-Math.PI/2)>.05,'the body turns over several frames instead of snapping');
 for(let frame=1;frame<18;frame++){state.player.action.elapsed=frame/120;motion.step(1/120,input,state);}
 assert.ok(angleTo(motion.player.yaw,-Math.PI/2)<.02,'faces the roll heading within 0.15 s');
 for(let frame=18;frame<144;frame++){state.player.action.elapsed=frame/120;motion.step(1/120,input,state);}
 assert.ok(Math.abs(motion.player.x-(start.x-ROLL_DISTANCE))<1e-6,'travels the authored distance to the left');
 assert.ok(Math.abs(motion.player.z-start.z)<1e-6,'and nothing forward');
});

test('a locked-on roll to the right mirrors it and keeps the authored travel distance',()=>{
 const {motion,state}=rollFixture();
 const start={...motion.player};
 roll(motion,state,{right:1,cameraYaw:0,lockOn:true});
 assert.ok(Math.abs(motion.player.x-(start.x+ROLL_DISTANCE))<1e-6);
 assert.ok(Math.abs(motion.player.z-start.z)<1e-6);
 assert.ok(angleTo(motion.player.yaw,Math.PI/2)<1e-6,'holds the roll heading through the tumble');
});

test('a locked-on roll backward rolls away from the boss and forward rolls at it',()=>{
 for(const [forward,expected] of [[-1,1],[1,-1]]){
  const {motion,state}=rollFixture();
  const start={...motion.player};
  roll(motion,state,{forward,cameraYaw:0,lockOn:true});
  assert.ok(Math.abs(motion.player.z-(start.z+expected*ROLL_DISTANCE))<1e-6);
  assert.ok(Math.abs(motion.player.x-start.x)<1e-6);
 }
});

test('the roll hands the facing back to lock-on: the body turns to the boss without snapping',()=>{
 const {motion,state}=rollFixture();
 const input={right:-1,cameraYaw:0,lockOn:true};
 roll(motion,state,input);
 const afterRoll=motion.player.yaw,toBoss=Math.atan2(motion.boss.x-motion.player.x,motion.boss.z-motion.player.z);
 assert.ok(angleTo(afterRoll,toBoss)>1.4,'the roll ends side on to the boss');
 stand(motion,state,{cameraYaw:0,lockOn:true},{seconds:.06});
 const partway=angleTo(motion.player.yaw,toBoss);
 assert.ok(partway<angleTo(afterRoll,toBoss)-.05&&partway>.3,'turns back at a rate, not in one frame');
 stand(motion,state,{cameraYaw:0,lockOn:true},{seconds:.8});
 assert.ok(angleTo(motion.player.yaw,Math.atan2(motion.boss.x-motion.player.x,motion.boss.z-motion.player.z))<.01,'ends facing the boss again');
 assert.ok(facesTarget(motion.player,motion.boss,.05));
});

test('an unlocked roll goes where the stick points and turns into it too',()=>{
 const {motion,state}=rollFixture();
 const start={...motion.player};
 roll(motion,state,{right:1,forward:1,cameraYaw:0,lockOn:false});
 const expected=Math.SQRT1_2*ROLL_DISTANCE;
 assert.ok(Math.abs(motion.player.x-(start.x+expected))<1e-6);
 assert.ok(Math.abs(motion.player.z-(start.z-expected))<1e-6);
 assert.ok(angleTo(motion.player.yaw,Math.atan2(1,-1))<1e-6);
});

test('a roll with no direction held keeps the authored heading and facing',()=>{
 const {motion,state}=rollFixture();
 const start={...motion.player};
 roll(motion,state,{cameraYaw:0,lockOn:true});
 assert.ok(Math.abs(motion.player.z-(start.z-ROLL_DISTANCE))<1e-6,'rolls along the current facing');
 assert.ok(Math.abs(motion.player.x-start.x)<1e-6);
 assert.equal(motion.player.yaw,start.yaw);
});

function walledFixture(){
 const metadata={player:{clips:{dodge:{duration:1.2,direction:'forward',travelCurve:rollCurve}}}};
 const motion=new MotionState({animationMetadata:metadata});
 const state={status:'fighting',player:{health:100,action:null,blocking:false},boss:{phase:1,action:{name:'awaken',elapsed:0}}};
 return {motion,state};
}

test('a directional roll straight into a wall stops at it and gains nothing sideways',()=>{
 const {motion,state}=walledFixture();
 motion.player.x=9;
 roll(motion,state,{right:1,cameraYaw:0,lockOn:true});
 assert.ok(motion.player.x<=9.55&&motion.player.x>8.9,'stopped at the arena wall');
 assert.ok(Math.abs(motion.player.z-8)<1e-6,'a perpendicular roll has no tangential component to keep');
});

test('a diagonal roll into a wall slides along it instead of dead-stopping',()=>{
 const {motion,state}=walledFixture();
 motion.player.x=9;motion.player.z=0;
 const tangential=Math.SQRT1_2*ROLL_DISTANCE;
 roll(motion,state,{right:1,forward:1,cameraYaw:0,lockOn:true});
 assert.ok(motion.player.x<=9.55&&motion.player.x>8.9,'held inside the arena wall');
 assert.ok(Math.abs(motion.player.z-(-tangential))<1e-6,'keeps the whole tangential component of the roll');
});

test('the lock-on turn eases out onto the boss instead of arriving at full speed',()=>{
 const {motion,state}=rollFixture();
 const input={right:-1,cameraYaw:0,lockOn:true};
 roll(motion,state,input);
 const settle={cameraYaw:0,lockOn:true},rates=[];
 let previous=motion.player.yaw;
 for(let frame=0;frame<180;frame++){
  stand(motion,state,settle,{seconds:1/120,fps:120});
  rates.push(Math.abs(Math.atan2(Math.sin(motion.player.yaw-previous),Math.cos(motion.player.yaw-previous)))*120);
  previous=motion.player.yaw;
 }
 const peak=Math.max(...rates),last=rates.filter(rate=>rate>1e-9).at(-1);
 assert.ok(peak>2,'the body really does turn back');
 assert.ok(last<peak*.35,`the turn eases out (last ${last.toFixed(2)} rad/s against a peak of ${peak.toFixed(2)})`);
 assert.ok(angleTo(motion.player.yaw,Math.atan2(motion.boss.x-motion.player.x,motion.boss.z-motion.player.z))<.01,'and still arrives');
});

test('a locked back roll comes round to the boss as fast as a side roll does',()=>{
 const seconds=[];
 for(const input of [{forward:-1,cameraYaw:0,lockOn:true},{right:-1,cameraYaw:0,lockOn:true}]){
  const {motion,state}=rollFixture();
  roll(motion,state,input);
  let elapsed=0;
  while(elapsed<2&&angleTo(motion.player.yaw,Math.atan2(motion.boss.x-motion.player.x,motion.boss.z-motion.player.z))>.02){
   stand(motion,state,{cameraYaw:0,lockOn:true},{seconds:1/120,fps:120});elapsed+=1/120;
  }
  seconds.push(elapsed);
 }
 assert.ok(seconds[0]<.75,`a half-turn recovery takes ${seconds[0].toFixed(2)} s`);
 assert.ok(seconds[0]<seconds[1]*2.2,'and is not disproportionately slower than a side roll');
});

test('the roll entry is a transition, not a spin: a half turn is rate capped and still lands on the heading',()=>{
 // ROLL_TURN aimed for a fixed 0.12 s, so the bigger the turn the faster the whip: a locked
 // back roll span 180 degrees at 1375 deg/s. The rate is capped, so a half turn takes about
 // twice as long as a quarter turn instead of the same time.
 const measure=input=>{
  const {motion,state}=rollFixture();
  const heading=Math.atan2(cameraRelativeDirection(input).x,cameraRelativeDirection(input).z);
  state.player.action={name:'dodge',elapsed:0};motion.beginDodge(input);
  let previous=motion.player.yaw,peak=0,seconds=0,settled=null;
  for(let frame=0;frame<180;frame++){
   state.player.action.elapsed=frame/120;motion.step(1/120,input,state);seconds+=1/120;
   peak=Math.max(peak,angleTo(motion.player.yaw,previous)*120);previous=motion.player.yaw;
   if(settled===null&&angleTo(motion.player.yaw,heading)<1e-6)settled=seconds;
  }
  return {peak,settled,error:angleTo(motion.player.yaw,heading)};
 };
 const back=measure({forward:-1,cameraYaw:0,lockOn:true}),side=measure({right:-1,cameraYaw:0,lockOn:true});
 assert.ok(back.peak<=12.001,`the entry rate is capped (${back.peak.toFixed(1)} rad/s)`);
 assert.ok(side.peak<=12.001,`for a side roll too (${side.peak.toFixed(1)} rad/s)`);
 assert.ok(back.settled>.2&&back.settled<.32,`a half turn takes ${back.settled.toFixed(3)} s`);
 assert.ok(side.settled<.16,`a quarter turn still takes ${side.settled.toFixed(3)} s`);
 assert.ok(back.settled>side.settled*1.6,'the half turn takes about twice as long, instead of the same time');
 approx(back.error,0);approx(side.error,0);
});
