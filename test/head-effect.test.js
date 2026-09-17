import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {createHeadEffect} from '../src/game/head-effect.js';
import {createPuddles} from '../src/game/puddles.js';

test('recessed mist follows the animated head and enlarged actor once',()=>{
 const root=new T.Group(),head=new T.Bone();root.scale.setScalar(1.3);head.scale.setScalar(.01);root.add(head);
 const effect=createHeadEffect(head);root.updateMatrixWorld(true);
 const before=effect.mesh.getWorldPosition(new T.Vector3());
 head.position.set(.2,1,.3);head.rotation.y=Math.PI/2;root.updateMatrixWorld(true);
 const actual=effect.mesh.getWorldPosition(new T.Vector3());
 const expected=effect.mesh.position.clone().applyMatrix4(head.matrixWorld);
 assert.ok(actual.distanceTo(expected)<1e-10);assert.ok(actual.distanceTo(before)>1);
 assert.ok(Math.abs(effect.mesh.getWorldScale(new T.Vector3()).x-.195)<1e-10);
 effect.dispose();assert.equal(head.children.length,0);
});

test('attack anticipation rises and decays; death/reset and exact seek stay coherent',()=>{
 const effect=createHeadEffect(new T.Bone()),timing={hitWindows:[[1.5,1.8]]};
 effect.update(0,1,{name:'idle',elapsed:1},timing,100);assert.equal(effect.uniforms.uThreat.value,0);
 effect.update(0,1.5,{name:'slam',elapsed:1.5},timing,100);assert.equal(effect.uniforms.uThreat.value,1);
 effect.update(0,2.6,{name:'slam',elapsed:2.6},timing,100);assert.equal(effect.uniforms.uThreat.value,0);
 effect.update(0,2,{name:'death',elapsed:2},timing,0);assert.equal(effect.uniforms.uLife.value,0);
 effect.reset();assert.equal(effect.uniforms.uLife.value,1);assert.equal(effect.uniforms.uThreat.value,0);
 effect.dispose();
});

test('puddles share one reflector and Low avoids a scene reflection render',()=>{
 const scene=new T.Scene(),puddles=createPuddles(scene);
 assert.equal(scene.children.filter(n=>n.isReflector).length,1);
 puddles.quality('low');assert.equal(puddles.mesh.material.uniforms.uReflect.value,0);
 assert.doesNotThrow(()=>puddles.mesh.onBeforeRender(null,scene,null));
 // 768x432 since 16 Sep: the eight-tap depth-varying blur needs the extra
 // pixels, and the whole composer still renders in 2-5 ms (stream A).
 puddles.quality('high');assert.equal(puddles.mesh.getRenderTarget().width,768);
 assert.equal(puddles.mesh.material.depthWrite,false);
 puddles.dispose();assert.equal(scene.children.length,0);
});
