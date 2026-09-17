import test from 'node:test';
import assert from 'node:assert/strict';
import {soundPlacement,cathedralImpulse,pickTake,soundTakes,SOUNDS,SOUND_LEVEL,takeGain,bufferRms,NORMALIZED} from '../src/game/audio.js';

test('world sound follows camera side and falls off beyond nearby combat',()=>{
 const listener={x:0,z:0,yaw:0};
 assert.equal(soundPlacement(listener).pan,0);
 assert.equal(soundPlacement(listener,{x:0,z:2}).gain,1);
 assert.ok(soundPlacement(listener,{x:4,z:0}).pan>0);
 assert.ok(soundPlacement(listener,{x:-4,z:0}).pan<0);
 assert.ok(soundPlacement({...listener,yaw:Math.PI},{x:4,z:0}).pan<0);
 assert.ok(soundPlacement(listener,{x:30,z:0}).gain<.5);
 assert.ok(Math.abs(soundPlacement(listener,{x:100,z:0}).pan)<=.85);
});

test('room response is finite stereo with predelay and a decaying tail',()=>{
 const channels=[];
 const buffer=cathedralImpulse({sampleRate:48000,createBuffer:(count,length)=>{
  for(let i=0;i<count;i++)channels.push(new Float32Array(length));
  return{getChannelData:i=>channels[i]};
 }});
 assert.equal(channels.length,2);
 assert.equal(channels[0].length,86400);
 assert.ok(channels.every(samples=>samples.every(Number.isFinite)));
 assert.ok(channels.every(samples=>samples.slice(0,1200).every(x=>x===0)));
 const energy=(from,to)=>channels.reduce((sum,s)=>sum+s.slice(from,to).reduce((n,v)=>n+v*v,0),0);
 assert.ok(energy(1200,12000)>100*energy(72000,82800));
 assert.notDeepEqual(buffer.getChannelData(0),buffer.getChannelData(1));
});

test('a sound with several takes never plays the same take twice in a row',()=>{
 assert.deepEqual(pickTake('one.mp3'),{index:0,value:'one.mp3'});
 assert.deepEqual(pickTake(['one.mp3']),{index:0,value:'one.mp3'});
 assert.equal(pickTake([]).value,undefined);
 assert.equal(pickTake(undefined).value,undefined);
 const takes=['a','b','c'];let last=-1,seed=7;
 const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 const seen=new Set();
 for(let i=0;i<300;i++){const pick=pickTake(takes,last,random);assert.notEqual(pick.index,last);assert.equal(pick.value,takes[pick.index]);seen.add(pick.index);last=pick.index;}
 assert.equal(seen.size,3);
 // Two takes alternate strictly; the picker still covers every index.
 assert.equal(pickTake(['a','b'],0,random).index,1);assert.equal(pickTake(['a','b'],1,random).index,0);
 assert.equal(pickTake(['a','b','c'],1,()=>.999999).index,2);
 assert.deepEqual(soundTakes(['x',null,'y']),['x','y']);
 for(const name of ['playerHitArmor','bossSwing','bossHitPlayer','playerSwing','block']){assert.ok(SOUNDS.includes(name));assert.ok(SOUND_LEVEL[name]>0&&SOUND_LEVEL[name]<=1);}
});

test('round-2 takes are brought to a common loudness within +-5 dB',()=>{
 assert.ok(Math.abs(takeGain(.1)-1)<1e-9);
 assert.ok(Math.abs(takeGain(.0617)-1.62)<.01); // player-hit-armor-3, RMS -24.2 dBFS
 assert.equal(takeGain(.207),.56);              // boss-swing-4, RMS -13.7 dBFS: clamped
 assert.equal(takeGain(.0427),1.78);            // player-hit-armor-5, RMS -27.4 dBFS: clamped
 assert.equal(takeGain(0),1);assert.equal(takeGain(NaN),1);
 const left=new Float32Array(1000).fill(.5),right=new Float32Array(1000).fill(-.5);
 assert.ok(Math.abs(bufferRms({numberOfChannels:2,getChannelData:i=>i?right:left})-.5)<1e-9);
 for(const name of NORMALIZED)assert.ok(SOUNDS.includes(name));
 assert.ok(!NORMALIZED.has('bossRoar'));
});
