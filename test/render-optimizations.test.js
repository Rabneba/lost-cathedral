import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {createPuddles} from '../src/game/puddles.js';
await import('../src/game/rendering.js');

test('every direct-light BRDF call is skipped when the light contributes nothing', () => {
 const chunk = T.ShaderChunk.lights_fragment_begin;
 const calls = chunk.split('RE_Direct( directLight,').length - 1;
 const guarded = chunk.split('if ( directLight.visible ) { RE_Direct( directLight,').length - 1;
 assert.ok(calls >= 3, 'point, spot and directional loops');
 assert.equal(guarded, calls);
});

test('the puddle mirror renders from renderMirror, never from inside the main pass', () => {
 const scene = new T.Scene(), puddles = createPuddles(scene);
 assert.equal(typeof puddles.renderMirror, 'function');
 const calls = [];
 const renderer = {coordinateSystem: T.WebGLCoordinateSystem, shadowMap: {autoUpdate: true}, render: () => calls.push('render')};
 assert.doesNotThrow(() => puddles.mesh.onBeforeRender(renderer, scene, new T.PerspectiveCamera()));
 assert.equal(calls.length, 0);
 puddles.quality('low');
 assert.equal(puddles.renderMirror(renderer, scene, new T.PerspectiveCamera()), false, 'low quality has no mirror');
 puddles.quality('high');
 puddles.mesh.visible = false;
 assert.equal(puddles.renderMirror(renderer, scene, new T.PerspectiveCamera()), false, 'a hidden mirror is skipped');
});
