import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {loadGLB} from '../scripts/load-glb-node.mjs';
import {ASSETS} from '../src/game/asset-paths.js';
import {actorDimensions} from '../src/game/actor-scale.js';
import {createPlayerCloth, updatePlayerCloth, bindCloth} from '../src/game/player-cloth.js';
import {createBossCloth} from '../src/game/boss-cloth.js';

// The garments are detachable code cloth pinned to the skeleton. What has to
// hold, whatever the clip does: the sewn rows stay welded to their socket, no
// seam is drawn past its limit, nothing ends a frame inside the body capsules
// or under the flagstones, and only a real teleport resets the simulation.
// scripts/audit-cloth.mjs runs the same checks over longer, harsher takes.

const FLOOR_Y = .02, SEAM_LIMIT = 1.1;
const localPath = href => decodeURIComponent(new URL(href).pathname);

async function rigged(kind) {
  const isBoss = kind === 'boss';
  const gltf = await loadGLB(localPath(isBoss ? ASSETS.bossRig : ASSETS.playerRig));
  const {scale} = actorDimensions(isBoss, ASSETS.motion[kind]);
  const root = new T.Group(); root.scale.setScalar(scale);
  const visual = new T.Group(); root.add(visual); visual.add(gltf.scene);
  const cloth = isBoss ? createBossCloth(2.5) : createPlayerCloth(1.85);
  root.add(cloth); root.updateMatrixWorld(true);
  const bindings = bindCloth(cloth, gltf.scene);
  const mixer = new T.AnimationMixer(gltf.scene);
  const inverse = new T.Matrix4(), matrix = new T.Matrix4();
  const play = name => {
    mixer.stopAllAction();
    const clip = gltf.animations.find(c => c.name === name);
    assert.ok(clip, `${kind} is missing the ${name} clip`);
    return mixer.clipAction(clip).reset().play();
  };
  const step = (frame, speed = 0) => {
    mixer.update(1 / 60); root.updateMatrixWorld(true);
    inverse.copy(root.matrixWorld).invert();
    for (const {garment, bone, offset} of bindings) {
      matrix.copy(inverse).multiply(bone.matrixWorld).multiply(offset);
      matrix.decompose(garment.position, garment.quaternion, garment.scale);
    }
    root.updateMatrixWorld(true);
    updatePlayerCloth(cloth, 1 / 60, frame / 60, {speed});
  };
  return {kind, root, cloth, scale, bindings, play, step};
}

function capsuleDepth(x, y, z, capsule) {
  const dx = capsule.bx - capsule.ax, dy = capsule.by - capsule.ay, dz = capsule.bz - capsule.az;
  const lengthSq = dx * dx + dy * dy + dz * dz;
  let t = lengthSq > 1e-9 ? ((x - capsule.ax) * dx + (y - capsule.ay) * dy + (z - capsule.az) * dz) / lengthSq : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const sx = capsule.sx || 1;
  return capsule.r - Math.hypot((x - (capsule.ax + dx * t)) / sx, y - (capsule.ay + dy * t), z - (capsule.az + dz * t));
}

function inspect(actor) {
  const simulation = actor.cloth.clothSimulation;
  const worst = {seam: 0, body: 0, root: 0, floor: 0, seamLowest: Infinity};
  for (const panel of simulation.panels) {
    if (!panel.initialized) continue;
    const {rows, cols, stride, position, target, lengthV, count, collide} = panel;
    for (let k = 0; k < count * 3; k++) assert.ok(Number.isFinite(position[k]), `${actor.kind}: a cloth point went non-finite`);
    for (let i = 0; i <= cols; i++) {
      const k = i * 3;
      worst.root = Math.max(worst.root, Math.hypot(position[k] - target[k], position[k + 1] - target[k + 1], position[k + 2] - target[k + 2]));
      worst.seamLowest = Math.min(worst.seamLowest, target[k + 1], target[(stride + i) * 3 + 1]);
    }
    for (let j = 0; j < rows; j++) for (let i = 0; i <= cols; i++) {
      const a = (j * stride + i) * 3, b = a + stride * 3, rest = lengthV[j * stride + i] * actor.scale;
      if (rest < 1e-5) continue;
      worst.seam = Math.max(worst.seam, Math.hypot(position[b] - position[a], position[b + 1] - position[a + 1], position[b + 2] - position[a + 2]) / rest - 1);
    }
    for (let j = 2; j <= rows; j++) for (let i = 0; i <= cols; i++) {
      const k = (j * stride + i) * 3, y = position[k + 1];
      for (const index of collide) {
        const capsule = simulation.colliders[index];
        if (capsule.live) worst.body = Math.max(worst.body, capsuleDepth(position[k], y, position[k + 2], capsule));
      }
      if (y < FLOOR_Y) worst.floor = Math.max(worst.floor, FLOOR_Y - y);
    }
  }
  return worst;
}

test('player cloth: the belt tassets and helm crest are sewn to the measured armour, not floating', async () => {
  const actor = await rigged('player');
  assert.equal(actor.bindings.length, 2, 'both garment sockets must find their bone');
  assert.deepEqual(actor.cloth.userData.bindings.map(b => b.bone), ['mixamorigHips', 'mixamorigHead']);
  const waist = actor.cloth.getObjectByName('waist-cloth-socket');
  // Measured off the skinned mesh (scripts/measure-cloth-anchors.mjs): the rear
  // of the hip armour sits at z = -0.142 around y = 1.03. The socket must be on
  // that surface, not the 4 cm further forward it used to hover at.
  assert.ok(Math.abs(waist.position.y - 1.028) < .02, `waist socket at y ${waist.position.y}`);
  assert.ok(Math.abs(waist.position.z + .142) < .015, `waist socket at z ${waist.position.z}`);
  assert.ok(actor.cloth.clothSimulation.colliders.every(c => c.boneA && c.boneB), 'every body capsule must ride a bone');
});

test('boss cloth: a shoulder cloak on the spine, not the player strips repainted', async () => {
  const actor = await rigged('boss');
  assert.deepEqual(actor.cloth.userData.bindings.map(b => b.bone), ['mixamorigSpine2']);
  assert.ok(actor.cloth.getObjectByName('boss-torn-cloak'), 'the boss needs a cloak panel');
  assert.ok(actor.cloth.getObjectByName('boss-cloak-mantle'), 'the boss needs a mantle over the seam');
  assert.equal(actor.cloth.getObjectByName('detachable-torn-tail'), undefined, 'the boss must not wear the player waist tails');
  const mantle = actor.cloth.getObjectByName('cloak-shoulder-socket');
  // The mantle arc measured across the shoulder blades: y 2.108, z -0.285.
  assert.ok(Math.abs(mantle.position.y - 2.108) < .03 && Math.abs(mantle.position.z + .285) < .03,
    `cloak socket at ${mantle.position.toArray()}`);
});

for (const kind of ['player', 'boss']) test(`${kind} cloth: stays attached, unstretched and outside the body through idle, locomotion and an action`, async () => {
  const actor = await rigged(kind);
  const clips = kind === 'boss' ? ['idle', 'walk-forward', 'sweep'] : ['idle', 'run-forward', 'dodge'];
  for (const clip of clips) {
    actor.play(clip);
    const moving = clip !== 'idle', speed = moving ? (kind === 'boss' ? 2.2 : 4.6) : 0;
    const before = actor.cloth.clothSimulation.panels.reduce((sum, p) => sum + p.resets, 0);
    for (let frame = 0; frame < 150; frame++) {
      if (moving) {
        const yaw = Math.sin(frame / 60 * 1.9) * .9;
        actor.root.rotation.y = yaw;
        actor.root.position.x += Math.sin(yaw) * speed / 60;
        actor.root.position.z += Math.cos(yaw) * speed / 60;
      }
      actor.step(frame, speed);
      if (frame < 8) continue;
      const worst = inspect(actor);
      assert.ok(worst.root < 1e-4, `${kind}/${clip}: a sewn row drifted ${worst.root} m off its socket`);
      assert.ok(worst.seam < SEAM_LIMIT - 1 + .005, `${kind}/${clip}: a seam stretched ${(worst.seam * 100).toFixed(1)}%`);
      assert.ok(worst.body < .04 * actor.scale, `${kind}/${clip}: cloth sank ${worst.body.toFixed(3)} m into the body`);
      // A hem can never be lifted above the belt it hangs from, so a clip that
      // drives the seam under the floor is allowed to take its first rows down.
      const allowance = Math.max(0, FLOOR_Y - worst.seamLowest);
      assert.ok(worst.floor <= allowance + .002, `${kind}/${clip}: hem tunnelled the floor by ${worst.floor.toFixed(3)} m`);
    }
    const resets = actor.cloth.clothSimulation.panels.reduce((sum, p) => sum + p.resets, 0) - before;
    assert.equal(resets, 0, `${kind}/${clip}: ${resets} discontinuity resets during ordinary motion`);
  }
});

test('cloth survives a teleport: one reset, then settled fabric again', async () => {
  const actor = await rigged('player');
  actor.play('idle');
  for (let frame = 0; frame < 90; frame++) actor.step(frame);
  const before = actor.cloth.clothSimulation.panels.reduce((sum, p) => sum + p.resets, 0);
  actor.root.position.set(7, 0, -12);
  for (let frame = 90; frame < 210; frame++) actor.step(frame);
  const resets = actor.cloth.clothSimulation.panels.reduce((sum, p) => sum + p.resets, 0) - before;
  assert.equal(resets, actor.cloth.clothSimulation.panels.length, 'every panel must re-seat after a teleport');
  const worst = inspect(actor);
  assert.ok(worst.root < 1e-4 && worst.seam < SEAM_LIMIT - 1 + .005 && worst.floor <= .002,
    `cloth did not settle after the teleport: ${JSON.stringify(worst)}`);
});

test('the 60 Hz cloth step stays cheap enough for two actors in one frame', async () => {
  const actor = await rigged('player');
  actor.cloth.clothSimulation.profile = true;
  actor.play('run-forward');
  for (let frame = 0; frame < 400; frame++) { actor.root.position.z -= 4.6 / 60; actor.step(frame, 4.6); }
  const timings = actor.cloth.clothSimulation.timings.slice(120).sort((a, b) => a - b);
  const median = timings[Math.floor(timings.length / 2)];
  // 0.71 ms on a quiet machine; the bound is loose because the suite may share
  // the box with GPU captures, and a regression that matters is several times it.
  assert.ok(median < 3, `the player's cloth step costs ${median.toFixed(3)} ms per 60 Hz tick`);
});

for (const kind of ['player', 'boss']) test(`${kind} cloth: a standing idle hangs still instead of thrashing`, async () => {
  // The seam sweep only moves the lower particle of each pair (the row above is
  // sewn to the armour), so it does not conserve momentum. Letting the whole
  // correction become the next frame's velocity fed the panel from its own
  // solver: the pelvis wobbling a centimetre in the idle clip used to swing the
  // hem around a 25 cm orbit while the character stood still. This pins it.
  const actor = await rigged(kind);
  actor.play('idle');
  const panels = actor.cloth.clothSimulation.panels;
  const previous = panels.map(() => null);
  let worst = 0;
  for (let frame = 0; frame < 300; frame++) {
    actor.step(frame);
    if (frame < 150) continue;             // let the cut shape fall into its drape first
    panels.forEach((panel, index) => {
      const {rows, stride, cols, position, socket} = panel;
      const e = socket.matrixWorld.elements;
      const hem = [];
      for (let i = 0; i <= cols; i++) { const k = (rows * stride + i) * 3; hem.push(position[k] - e[12], position[k + 1] - e[13], position[k + 2] - e[14]); }
      const was = previous[index];
      if (was) for (let i = 0; i < hem.length; i += 3)
        worst = Math.max(worst, Math.hypot(hem[i] - was[i], hem[i + 1] - was[i + 1], hem[i + 2] - was[i + 2]) * 60);
      previous[index] = hem;
    });
  }
  assert.ok(worst < .55 * actor.scale, `${kind}: a hem moves at ${worst.toFixed(2)} m/s relative to its seam while standing still`);
});

test('a paused review frame shows the drape, not the cut shape', async () => {
  // The animation studio scrubs with dt = 0. Returning early there left the
  // fabric frozen in the shape it was cut in, rigidly bolted to whatever angle
  // the held pose puts the bone at; updatePlayerCloth settles instead.
  const actor = await rigged('boss');
  actor.play('idle');
  for (let frame = 0; frame < 30; frame++) actor.step(frame);
  const cloak = actor.cloth.clothSimulation.panels[0];
  const hemY = () => { let low = Infinity; for (let i = 0; i <= cloak.cols; i++) low = Math.min(low, cloak.position[(cloak.rows * cloak.stride + i) * 3 + 1]); return low; };
  const beforeSeatY = hemY();
  updatePlayerCloth(actor.cloth, 0, 9, {speed: 0});
  const settled = hemY();
  assert.ok(Number.isFinite(settled) && settled < beforeSeatY + .05,
    `a paused frame left the cloak at y ${settled} (it was ${beforeSeatY} while running)`);
  const worst = inspect(actor);
  assert.ok(worst.root < 1e-4, `a paused frame drifted a sewn row ${worst.root} m off its socket`);
  assert.ok(worst.seam < SEAM_LIMIT - 1 + .005, `a paused frame stretched a seam by ${(worst.seam * 100).toFixed(1)}%`);
});

test('the boss cloak drapes as a cape: wider at the hem than at the yoke, with folds deep enough to shade', async () => {
  // The round-1 cape passed every attachment check in this file while settling
  // to 0.739 m at the yoke and 0.764 m at the hem out of a 1.45 m cut — a
  // constant-width slab with 6-19 mm of fold relief on a 3.25 m character, which
  // reads as a tabard pinned to his back. None of the checks above can see that,
  // so the shape of the drape is pinned here.
  const actor = await rigged('boss');
  actor.play('idle');
  for (let frame = 0; frame < 420; frame++) actor.step(frame);
  const cloak = actor.cloth.clothSimulation.panels[0];
  assert.equal(cloak.mesh.name, 'boss-torn-cloak');
  const width = j => {
    let min = Infinity, max = -Infinity;
    for (let i = 0; i <= cloak.cols; i++) { const x = cloak.position[(j * cloak.stride + i) * 3]; min = Math.min(min, x); max = Math.max(max, x); }
    return max - min;
  };
  const yoke = width(0), hem = width(cloak.rows);
  // Clasped across the pauldrons, which measure 1.089 m apart at seam height.
  assert.ok(yoke > .77 * actor.scale, `the cloak yoke is only ${yoke.toFixed(3)} m across the shoulders`);
  assert.ok(hem > yoke * 1.12, `the cloak hem (${hem.toFixed(3)} m) is no wider than its yoke (${yoke.toFixed(3)} m)`);
  // Fold relief: the spread of z about the row's own mean, which is a crude but
  // sign-stable stand-in for the quadratic fit scripts/audit-cloth.mjs uses.
  let relief = 0;
  for (let j = Math.ceil(cloak.rows / 2); j <= cloak.rows; j++) {
    let sum = 0, squared = 0;
    for (let i = 0; i <= cloak.cols; i++) { const z = cloak.position[(j * cloak.stride + i) * 3 + 2]; sum += z; squared += z * z; }
    const n = cloak.cols + 1;
    relief = Math.max(relief, Math.sqrt(Math.max(0, squared / n - (sum / n) ** 2)));
  }
  assert.ok(relief > .03 * actor.scale, `the cloak's folds are only ${(relief * 1000).toFixed(0)} mm deep`);
});

test('a paused review frame settles all the way, not half way', async () => {
  // 34 relaxation steps was half a second of fall: the boss cloak measured
  // 1.055 m across the hem at step 34, 0.848 at 60 and 0.762 from 120 on, so
  // every scrubbed studio still showed a cape the running game never draws — and
  // those stills were what the cape's silhouette was signed off on.
  const actor = await rigged('boss');
  actor.play('idle');
  for (let frame = 0; frame < 420; frame++) actor.step(frame);
  const cloak = actor.cloth.clothSimulation.panels[0];
  const hem = () => {
    let min = Infinity, max = -Infinity;
    for (let i = 0; i <= cloak.cols; i++) { const x = cloak.position[(cloak.rows * cloak.stride + i) * 3]; min = Math.min(min, x); max = Math.max(max, x); }
    return max - min;
  };
  const live = hem();
  for (const panel of actor.cloth.clothSimulation.panels) panel.initialized = false;
  updatePlayerCloth(actor.cloth, 0, 9, {speed: 0});
  const settled = hem();
  assert.ok(actor.cloth.clothSimulation.settleSteps > 120, `a paused frame relaxed for only ${actor.cloth.clothSimulation.settleSteps} steps`);
  assert.ok(Math.abs(settled - live) < .045 * actor.scale,
    `a paused frame hangs the hem at ${settled.toFixed(3)} m where the running game hangs it at ${live.toFixed(3)} m`);
});

test('the fabric map carries thread, not a printed motif', async () => {
  // The map repeats 2-11 times across a garment, so any term at the tile's own
  // scale is a pattern stamped over the whole panel at a fixed spacing. That is
  // what the old `wrinkle * .17 * sin(u*PI*3 + …)` was: a regular nested chevron
  // about 8 cm across on the cape, diagonal banding down the player's tassets.
  const {createPlayerCloth: build} = await import('../src/game/player-cloth.js');
  const cloth = build(1.85);
  const maps = [...new Set(cloth.clothSimulation.panels.map(panel => panel.mesh.material))];
  assert.ok(maps.length >= 2, 'the player should have at least two fabrics');
  const {createBossCloth: buildBoss} = await import('../src/game/boss-cloth.js');
  for (const material of [...maps, ...new Set(buildBoss(2.5).clothSimulation.panels.map(p => p.mesh.material))]) {
    const image = material.map.image, size = image.width, data = image.data;
    const value = (x, y) => data[(y * size + x) * 4] / 255;
    let mean = 0;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) mean += value(x, y);
    mean /= size * size;
    let variance = 0;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) variance += (value(x, y) - mean) ** 2;
    const deviation = Math.sqrt(variance / (size * size));
    // Projection onto the lowest few whole-tile frequencies, in both axes.
    for (let k = 1; k <= 4; k++) for (const axis of [0, 1]) {
      let sine = 0, cosine = 0;
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const phase = 2 * Math.PI * k * (axis ? y : x) / size, d = value(x, y) - mean;
        sine += d * Math.sin(phase); cosine += d * Math.cos(phase);
      }
      const amplitude = 2 * Math.hypot(sine, cosine) / (size * size);
      assert.ok(amplitude < Math.max(.006, deviation * .22),
        `the fabric map has a ${amplitude.toFixed(4)} motif at ${k} cycles per tile (rms ${deviation.toFixed(4)}) — it will print over the garment`);
    }
    // …and it has to wrap: a twill that does not divide the tile draws a grid at
    // every tile edge instead.
    let seam = 0, neighbour = 0;
    for (let y = 0; y < size; y++) { seam += Math.abs(value(0, y) - value(size - 1, y)); neighbour += Math.abs(value(1, y) - value(0, y)); }
    assert.ok(seam < neighbour * 2.2 + 1e-6, `the fabric map does not tile: its wrap edge jumps ${(seam / size).toFixed(3)} against a ${(neighbour / size).toFixed(3)} neighbour step`);
  }
});
