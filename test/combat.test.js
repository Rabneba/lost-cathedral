import test from 'node:test';
import assert from 'node:assert/strict';
import { Encounter, RULES } from '../src/game/combat.js';

function advance(game, seconds, geometry = { distance: 20 }, fps = 120) {
  const frames = Math.round(seconds * fps);
  for (let i = 0; i < frames; i++) game.update(1 / fps, geometry);
}

function fighting() {
  const game = new Encounter();
  game.start();
  return game;
}

test('actions require an active fight and commit through recovery', () => {
  const game = new Encounter();
  assert.equal(game.request('light'), false);
  game.start();
  assert.equal(game.request('light'), true);
  assert.equal(game.request('dodge'), false);
  advance(game, 0.7);
  assert.equal(game.request('dodge'), true);
});

test('attacks deal damage once, only during contact and in reach', () => {
  const game = fighting();
  game.request('light');
  advance(game, 0.15, { distance: 2 });
  assert.equal(game.snapshot().boss.health, RULES.bossHealth);
  advance(game, 0.2, { distance: 2 });
  assert.equal(game.snapshot().boss.health, RULES.bossHealth - 65);
  advance(game, 0.4, { distance: 2 });
  assert.equal(game.snapshot().boss.health, RULES.bossHealth - 65);
  game.request('heavy');
  advance(game, 1.3);
  assert.equal(game.snapshot().boss.health, RULES.bossHealth - 65);
});

test('wrong-facing attacks miss even inside weapon reach', () => {
  const game = fighting();
  game.request('heavy');
  advance(game, 1.3, { distance: 2, playerFacing: false, bossFacing: false });
  assert.equal(game.snapshot().boss.health, RULES.bossHealth);
});

test('stamina gates actions and regenerates after recovery', () => {
  const game = fighting();
  for (let i = 0; i < 3; i++) {
    assert.equal(game.request('dodge'), true);
    advance(game, 0.65);
  }
  assert.equal(game.request('heavy'), false);
  advance(game, 4);
  assert.equal(game.snapshot().player.stamina, RULES.stamina);
});

test('a well-timed dodge avoids the boss hit', () => {
  const game = fighting();
  advance(game, 1.85, { distance: 3 });
  game.request('dodge');
  advance(game, 0.4, { distance: 3 });
  assert.equal(game.snapshot().player.health, RULES.playerHealth);
  assert.ok(game.drainEvents().some((event) => event.type === 'evade'));
});

test('an early dodge expires before impact; healing consumes one flask', () => {
  const game = fighting();
  advance(game, 1.25, { distance: 3 });
  game.request('dodge');
  advance(game, 1, { distance: 3 });
  assert.equal(game.snapshot().player.health, 74);
  assert.equal(game.request('heal'), true);
  assert.equal(game.snapshot().player.flasks, 2);
  assert.equal(game.snapshot().player.health, 74);
  advance(game, 1.4);
  assert.equal(game.snapshot().player.health, 100);
  assert.equal(game.request('heal'), false);
});

test('boss enters its second phase once and victory freezes combat', () => {
  const game = fighting();
  for (let i = 0; i < 20 && game.snapshot().status === 'fighting'; i++) {
    game.request('heavy');
    advance(game, 1.5, { distance: 2, bossFacing: false });
  }
  assert.equal(game.snapshot().status, 'victory');
  assert.equal(game.drainEvents().filter((event) => event.type === 'phase-change').length, 1);
  const final = game.snapshot();
  assert.equal(game.request('light'), false);
  advance(game, 3, { distance: 2 });
  assert.deepEqual(game.snapshot(), final);
});

test('defeat stops combat and restart resets the entire encounter', () => {
  const game = fighting();
  advance(game, 25, { distance: 2 });
  assert.equal(game.snapshot().status, 'defeat');
  assert.equal(game.snapshot().player.health, 0);
  game.restart();
  assert.deepEqual(game.snapshot(), new Encounter().snapshot());
  assert.deepEqual(game.drainEvents(), []);
});

test('combat timing is consistent at 30 and 120 rendering frames per second', () => {
  const slow = fighting();
  const fast = fighting();
  advance(slow, 8, { distance: 3 }, 30);
  advance(fast, 8, { distance: 3 }, 120);
  assert.deepEqual(slow.snapshot(), fast.snapshot());
});

// Player combo (src/game/player-combo.js) on the abstract rules: the same chain as encounter.js.
test('a second light input chains into light2 at the chain point and there is no third hit', () => {
  const game = fighting();
  assert.equal(game.request('light'), true);
  advance(game, 0.2, { distance: 2 });
  assert.equal(game.request('light'), true);
  assert.equal(game.snapshot().player.action.queued, 'light2');
  assert.equal(game.snapshot().player.stamina, 78);
  // light: windup .18 + active .14 = .32, recovery .32 -> chain at .32 + .32 * .64 = .5248
  advance(game, 0.31, { distance: 2 });
  assert.equal(game.snapshot().player.action.name, 'light');
  advance(game, 0.02, { distance: 2 });
  assert.equal(game.snapshot().player.action.name, 'light2');
  assert.equal(game.snapshot().player.stamina, 56);
  assert.equal(game.request('light'), false);
  advance(game, 0.3, { distance: 2 });
  assert.equal(game.snapshot().boss.health, RULES.bossHealth - 65 - 70);
  assert.ok(game.drainEvents().some((event) => event.type === 'player-action' && event.action === 'light2' && event.chained));
});

test('light2 cannot start on its own, a queued heavy waits for the light to end, and stamina gates the chain', () => {
  const game = fighting();
  assert.equal(game.request('light2'), false);
  game.request('light');
  advance(game, 0.4);
  assert.equal(game.request('heavy'), true);
  advance(game, 0.23);
  assert.equal(game.snapshot().player.action.name, 'light');
  advance(game, 0.02);
  assert.equal(game.snapshot().player.action.name, 'heavy');
  assert.equal(game.snapshot().player.stamina, 100 - 22 - 38);
  const poor = fighting();
  poor.state.player.stamina = 40;
  poor.request('light');
  advance(poor, 0.2);
  assert.equal(poor.request('light'), false);
  assert.equal(poor.snapshot().player.action.queued, undefined);
});
