import test from 'node:test';
import assert from 'node:assert/strict';
import {TRANSITION_DURATION,transitionTravel,transitionPhase} from '../src/preview/transition-sequence.js';

test('movement review starts and stops without travel discontinuities',()=>{
 const speed=2.96;
 assert.equal(transitionTravel(0,speed),0);
 assert.equal(transitionTravel(.6,speed),0);
 assert.equal(transitionTravel(TRANSITION_DURATION,speed),transitionTravel(TRANSITION_DURATION+1,speed));
 let previous=0;
 for(let t=0;t<=TRANSITION_DURATION;t+=1/120){
  const position=transitionTravel(t,speed),delta=position-previous;
  assert.ok(delta>=-1e-8&&delta<=speed/120+1e-7);previous=position;
 }
 for(const boundary of [.6,.88,4.5,4.8])assert.ok(Math.abs(transitionTravel(boundary+1e-6,speed)-transitionTravel(boundary-1e-6,speed))<1e-5);
 assert.equal(transitionPhase(0,false),'Idle');assert.equal(transitionPhase(2,false),'Running');
 assert.equal(transitionPhase(2,true),'Walking');assert.equal(transitionPhase(5.5,false),'Idle');
});
