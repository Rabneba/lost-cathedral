import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {Fight} from '../src/game/encounter.js';
import {ASSETS} from '../src/game/asset-paths.js';
import {AttackInput, CHAIN_RECOVERY_LEFT, HOLD_SECONDS, LIGHT2_TIMING, chainPoint, chainWindow, followUp, withComboTimings} from '../src/game/player-combo.js';

// A V17-shaped light plus a light2, as the V18 manifest declares them (numbers rounded).
const LIGHT = {duration: 1.3, windup: .4083, active: .25, recovery: .6417, hitWindows: [[.4083, .6583]], chainAt: 1.067};
const LIGHT2 = {duration: 1.0333, windup: .3, active: .25, recovery: .4833, hitWindows: [[.3, .55]], damage: 70, cost: 22};
const metadata = {player: {clips: {light: LIGHT, light2: LIGHT2}}};
const advance = (f, seconds, g = {distance: 2, playerHit: false, bossHit: false, playerFacing: true}) => { for (let i = 0; i < Math.round(seconds * 120); i++) f.step(1 / 120, g); };
const fighting = () => { const f = new Fight(metadata); f.start(); return f; };
const near = (a, b, eps = 1 / 120 + 1e-6) => Math.abs(a - b) <= eps;
// Step until the player's action name changes; returns the fight time at which it did.
function stepUntilAction(f, name, limit = 3, g = {distance: 2}) { for (let i = 0; i < limit * 120; i++) { f.step(1 / 120, g); if (f.player.action?.name === name) return f.time; } throw new Error(`${name} never started`); }

test('chain point: the manifest chainAt wins, else a fixed fraction of the recovery is still ahead; a heavy waits for the end', () => {
  assert.equal(chainPoint(LIGHT), 1.067);
  const unmarked = {...LIGHT, chainAt: undefined};
  assert.ok(near(chainPoint(unmarked), .6583 + .6417 * (1 - CHAIN_RECOVERY_LEFT), 1e-9));
  assert.equal(chainPoint(LIGHT, 'heavy'), 1.3);
  assert.equal(chainPoint({windup: .18, active: .14, recovery: .32}, 'heavy'), .64);
  assert.equal(chainPoint({...LIGHT, chainAt: 9}), 1.3, 'a chain point cannot lie past the clip');
});

test('chain window: the whole light by default, narrowed by chainOpen; nothing chains out of light2 or a heavy', () => {
  assert.deepEqual(chainWindow(LIGHT), [0, 1.3]);
  assert.deepEqual(chainWindow({...LIGHT, chainOpen: .6583}), [.6583, 1.3]);
  assert.equal(followUp('light', 'light'), 'light2');
  assert.equal(followUp('light', 'light2'), 'light2');
  assert.equal(followUp('light', 'heavy'), 'heavy');
  assert.equal(followUp('light2', 'light'), null);
  assert.equal(followUp('heavy', 'light'), null);
  assert.equal(followUp('dodge', 'light'), null);
});

test('light2 timing joins the player table only when the bundle carries the clip', () => {
  assert.equal(withComboTimings({light: LIGHT}, {clips: {light: LIGHT}}).light2, undefined);
  const timings = withComboTimings({light: LIGHT}, metadata.player);
  assert.equal(timings.light2.damage, 70);
  assert.equal(timings.light2.cost, LIGHT2_TIMING.cost);
  assert.equal(timings.light2.windup, .3);
});

test('tap then tap: the second light queues light2, which starts exactly at the chain point and cancels the recovery', () => {
  const f = fighting();
  assert.equal(f.request('light'), true);
  advance(f, .3);
  assert.equal(f.request('light'), true, 'a second tap inside the light is accepted');
  assert.equal(f.player.action.name, 'light');
  assert.equal(f.player.action.queued, 'light2');
  assert.equal(f.player.stamina, 78, 'light2 is paid when it starts, not when it is queued');
  assert.ok(f.drain().some(e => e.type === 'player-chain' && e.name === 'light2'));
  advance(f, 1.0 - .3);
  assert.equal(f.player.action.name, 'light');
  const at = stepUntilAction(f, 'light2');
  assert.ok(near(at, 1.067), `light2 began at ${at}`);
  assert.equal(f.player.action.chained, true);
  assert.ok(f.player.action.elapsed < 1 / 120 + 1e-9, 'the fixed-step overshoot is carried into light2');
  assert.equal(f.player.stamina, 56);
  assert.ok(f.drain().some(e => e.type === 'player-action' && e.name === 'light2' && e.chained));
  // light2 lands once inside its own window, and cannot chain again.
  advance(f, .35, {distance: 2, playerHit: true});
  assert.equal(f.boss.health, 1800 - 70);
  assert.equal(f.request('light'), false, 'no third hit');
  advance(f, 1, {distance: 2, playerHit: true});
  assert.equal(f.boss.health, 1730);
  assert.equal(f.player.action, null);
});

test('an input after the chain point starts light2 immediately; after the light ends it is a fresh light', () => {
  const f = fighting();
  f.request('light');
  advance(f, 1.2);
  assert.equal(f.request('light'), true);
  assert.equal(f.player.action.name, 'light2');
  assert.equal(f.player.action.elapsed, 0);
  const g = fighting();
  g.request('light');
  advance(g, 1.31);
  assert.equal(g.player.action, null);
  assert.equal(g.request('light'), true);
  assert.equal(g.player.action.name, 'light');
  assert.equal(g.player.action.queued, undefined);
});

test('a narrowed chain window rejects early inputs', () => {
  const f = new Fight({player: {clips: {light: {...LIGHT, chainOpen: .6583}, light2: LIGHT2}}});
  f.start();
  f.request('light');
  advance(f, .5);
  assert.equal(f.request('light'), false);
  advance(f, .2);
  assert.equal(f.request('light'), true);
  assert.equal(f.player.action.queued, 'light2');
});

test('whiffing chains too, and a queued follow-up is dropped when the player is hit', () => {
  const f = fighting();
  f.request('light');
  advance(f, .9, {distance: 6, playerHit: false});
  assert.equal(f.request('light'), true);
  advance(f, .3, {distance: 6, playerHit: false});
  assert.equal(f.player.action.name, 'light2', 'a miss still chains');
  const g = fighting();
  g.request('light');
  advance(g, .5);
  g.request('light');
  g.boss.action = {name: 'sweep', elapsed: 1.099, hits: []};
  g.step(1 / 120, {distance: 2, bossHit: true, playerFacing: true});
  assert.equal(g.player.action.name, 'hit');
  advance(g, 1.5, {distance: 2});
  assert.equal(g.player.action, null, 'no light2 after the interruption');
});

test('stamina gates the chain at queue time and when it starts', () => {
  const f = fighting();
  f.player.stamina = 40;
  f.request('light');
  assert.equal(f.player.stamina, 18);
  advance(f, .3);
  assert.equal(f.request('light'), false, '18 < 22: no queue');
  assert.equal(f.player.action.queued, undefined);
  const g = fighting();
  g.request('light');
  advance(g, .3);
  g.request('light');
  g.player.stamina = 5;
  advance(g, 1);
  assert.equal(g.player.action.name, 'light', 'a queue whose stamina vanished is dropped, the light finishes');
  advance(g, .1);
  assert.equal(g.player.action, null);
});

test('a heavy input during the light queues a heavy that starts when the light ends', () => {
  const f = fighting();
  f.request('light');
  advance(f, .7);
  assert.equal(f.request('heavy'), true);
  assert.equal(f.player.action.queued, 'heavy');
  assert.equal(f.request('light'), false, 'the first queued follow-up stays');
  advance(f, 1.25 - .7);
  assert.equal(f.player.action.name, 'light');
  const at = stepUntilAction(f, 'heavy');
  assert.ok(near(at, 1.3), `heavy began at ${at}`);
  assert.equal(f.player.stamina, 100 - 22 - f.timings.player.heavy.cost);
});

test('a bundle without light2 has no combo at all', () => {
  const f = new Fight({player: {clips: {light: LIGHT}}});
  f.start();
  f.request('light');
  advance(f, .5);
  assert.equal(f.request('light'), false);
  assert.equal(f.request('heavy'), false, 'no follow-ups of any kind on a bundle without light2 (V17 and earlier behave as before)');
  assert.equal(f.timings.player.light2, undefined);
});

test('chained fights integrate identically at 30, 60 and 120 presentation frames per second', () => {
  function run(fps) {
    const f = fighting();
    let rem = 0, t = 0;
    const inputs = [[.1, 'light'], [.45, 'light'], [2.2, 'light'], [2.9, 'heavy']];
    for (let i = 0; i < fps * 6; i++) {
      rem += 1 / fps;
      while (rem + 1e-10 >= 1 / 120) {
        rem -= 1 / 120; t += 1 / 120;
        while (inputs.length && inputs[0][0] <= t + 1e-9) f.request(inputs.shift()[1]);
        f.step(1 / 120, {distance: 2, playerHit: true, bossHit: false, playerFacing: true});
      }
    }
    return {player: f.player, boss: f.boss, damage: f.stats.damage};
  }
  assert.deepEqual(run(30), run(60));
  assert.deepEqual(run(60), run(120));
});

test('attack input: a short press is a light at release, a held press is a heavy at the threshold', () => {
  const input = new AttackInput();
  input.press(1);
  assert.equal(input.update(1.1), null);
  assert.equal(input.release(1.12), 'light');
  assert.equal(input.holding, false);
  input.press(2);
  assert.equal(input.update(2 + HOLD_SECONDS - .001), null);
  assert.equal(input.update(2 + HOLD_SECONDS), 'heavy');
  assert.equal(input.release(2.5), null, 'the release after a fired hold is not another attack');
  input.press(3);
  input.press(3.05);
  assert.equal(input.release(3.1), 'light', 'a second device pressing during a hold does not restart it');
  input.press(4);
  input.cancel();
  assert.equal(input.release(4.1), null);
  assert.equal(input.update(9), null);
  assert.equal(new AttackInput({holdSeconds: .5}).holdSeconds, .5);
});

test('the game bundle is V18 with light2 and a chain point inside the light recovery', () => {
  const rig = fileURLToPath(ASSETS.playerRig), manifest = ASSETS.motion.player;
  assert.ok(rig.endsWith('player-video-candidate-v18.glb'));
  assert.ok(rig.endsWith(manifest.asset.replace(/^assets\//, '')));
  assert.equal(createHash('sha256').update(readFileSync(rig)).digest('hex'), manifest.sha256);
  const light = manifest.clips.light, light2 = manifest.clips.light2;
  assert.ok(light2, 'V18 carries the combo second hit');
  assert.ok(light.chainAt > light.hitWindows[0][1] && light.chainAt < light.duration);
  assert.ok(light2.hitWindows[0][0] >= .2 && light2.hitWindows[0][1] <= light2.duration);
  assert.equal(light2.damage, 70);
  assert.equal(light2.cost, 22);
  const f = new Fight(ASSETS.motion);
  assert.equal(f.timings.player.light2.damage, 70);
  assert.equal(chainPoint(f.timings.player.light), light.chainAt);
});
