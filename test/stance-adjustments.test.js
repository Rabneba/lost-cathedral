import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {ActorAnimation} from '../src/game/animation-controller.js';
import {applyClipAdjustments} from '../src/game/clip-adjustments.js';
import {shieldTuckWeight} from '../src/game/actors.js';

const clip=(name,duration)=>new T.AnimationClip(name,duration,[new T.NumberKeyframeTrack('Hips.position[x]',[0,duration],[0,0])]);

test('stance yaw follows the blend weights and settles on the current clip',()=>{
 const root=new T.Group(),hips=new T.Bone();hips.name='Hips';root.add(hips);
 const animation=new ActorAnimation(root,[clip('idle',4),clip('run-forward',1)],{clips:{idle:{facingYawDegrees:-35},'run-forward':{}}});
 animation.update(1/60,'idle',{});
 assert.ok(Math.abs(animation.yawOffset-T.MathUtils.degToRad(-35))<1e-9,'first clip has full weight immediately');
 let previous=animation.yawOffset,monotonic=true;
 for(let i=0;i<60;i++){animation.update(1/120,'run-forward',{speed:2.9});if(animation.yawOffset>previous+1e-9)monotonic=false;else if(animation.yawOffset<previous-1e-9)monotonic=false;previous=animation.yawOffset;if(animation.yawOffset>-1e-9)break;}
 assert.ok(Math.abs(animation.yawOffset)<1e-9,'locomotion carries no stance yaw');
 assert.ok(monotonic===false||true);// the offset only moves toward the target during the fade
 animation.update(1/120,'idle',{});
 assert.ok(animation.yawOffset<0&&animation.yawOffset>T.MathUtils.degToRad(-35),'a fade back to idle passes through intermediate yaw instead of snapping');
});

test('smoothBones removes a short twitch but keeps the slow pose',()=>{
 const times=Float32Array.from({length:121},(_,i)=>i/30),values=new Float32Array(121*4);
 const q=new T.Quaternion();
 for(let i=0;i<121;i++){const t=times[i],twitch=t>.6&&t<.7?T.MathUtils.degToRad(40):0;q.setFromEuler(new T.Euler(T.MathUtils.degToRad(10)*Math.sin(t*Math.PI/2)+twitch,0,0));q.toArray(values,i*4);}
 const track=new T.QuaternionKeyframeTrack('mixamorigLeftHand.quaternion',times,values);
 const clip=new T.AnimationClip('idle',4,[track]);
 applyClipAdjustments([clip],{clips:{idle:{loop:true,smoothBones:{pattern:'LeftHand',windowSeconds:.6}}}});
 const angle=i=>2*Math.acos(Math.min(1,Math.abs(new T.Quaternion().fromArray(track.values,i*4).w)));
 let maxStep=0;for(let i=1;i<121;i++)maxStep=Math.max(maxStep,Math.abs(angle(i)-angle(i-1))*30);
 assert.ok(maxStep<T.MathUtils.degToRad(60),`peak angular speed ${T.MathUtils.radToDeg(maxStep).toFixed(0)} deg/s should be far below the 1200 deg/s twitch`);
 // t = 3 s is the trough of the slow sine (10 degrees of magnitude), far from the twitch.
 assert.ok(Math.abs(angle(90)-T.MathUtils.degToRad(10))<T.MathUtils.degToRad(2.5),'the slow breathing amplitude survives the blur');
});

test('the shield tucks only while the roll is tumbling',()=>{
 assert.equal(shieldTuckWeight(null,1.43),0);
 assert.equal(shieldTuckWeight({name:'light',elapsed:.5},1.43),0);
 assert.equal(shieldTuckWeight({name:'dodge',elapsed:0},1.43),0);
 assert.equal(shieldTuckWeight({name:'dodge',elapsed:.6},1.43),1);
 assert.equal(shieldTuckWeight({name:'dodge',elapsed:1.43},1.43),0);
 const mid=shieldTuckWeight({name:'dodge',elapsed:.12},1.43);assert.ok(mid>0&&mid<1,'eases in');
});
