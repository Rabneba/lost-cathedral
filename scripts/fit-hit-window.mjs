// Choose an attack's damage window from where the visible blade actually sweeps through the
// opponent, instead of from the sword hand's speed. scripts/find-hit-window.mjs reports only the
// first and last contact of a clip, which is useless when the guard pose already rests inside the
// target capsule (the Sword 4 light does): this walks every candidate window of at most
// VESPER_MAX_WINDOW seconds and keeps the one with the densest contact at the solid-body distance,
// tie-broken by contact at +30 cm.
//
//   VESPER_RIG=... VESPER_MANIFEST=... [VESPER_CLIPS=light,heavy] [VESPER_MAX_WINDOW=.25]
//   [VESPER_YAW=<facingYawDegrees override>] node scripts/fit-hit-window.mjs
import {readFileSync} from 'node:fs';
import * as T from 'three';
import {loadGLB} from './load-glb-node.mjs';
import {createActor, weaponSegmentFor} from '../src/game/actors.js';
import {ASSETS} from '../src/game/asset-paths.js';
import {actorDimensions, actorCapsule} from '../src/game/actor-scale.js';
import {sweptWeaponContact} from '../src/game/weapon-motion.js';

const RIG = process.env.VESPER_RIG, MANIFEST = process.env.VESPER_MANIFEST;
if (!RIG || !MANIFEST) throw new Error('VESPER_RIG and VESPER_MANIFEST required');
const clips = (process.env.VESPER_CLIPS || 'light,heavy').split(',');
const MAX = +(process.env.VESPER_MAX_WINDOW || .25), RATE = 120;
const metadata = JSON.parse(readFileSync(MANIFEST, 'utf8'));
if (process.env.VESPER_YAW) for (const c of clips) metadata.clips[c].facingYawDegrees = Number(process.env.VESPER_YAW);
const target = actorDimensions(true, ASSETS.motion.boss);
const gltf = await loadGLB(RIG), actor = createActor(gltf, 1.85, false, true, metadata);
const socket = actor.body.getObjectByName('WeaponSocket');
actor.weapon = new T.Group(); actor.weapon.rotation.x = Math.PI / 2; socket.add(actor.weapon);
actor.weaponSegment = weaponSegmentFor(false, ASSETS);
const near = actor.dimensions.bodyRadius + target.bodyRadius + .05;
const capsules = [near, near + .3].map(d => actorCapsule({x: 0, z: d}, target));

for (const name of clips) {
  const clip = metadata.clips[name];
  if (!clip) continue;
  const origin = {x: 0, z: 0, yaw: 0};
  actor.reset(origin);
  const action = {name, elapsed: 0}, state = {health: 100, blocking: false, action};
  const frames = Math.ceil(clip.duration * RATE), hitsNear = [], hitsMid = [], tipSpeed = [];
  let previousTip = null;
  for (let frame = 0; frame <= frames; frame++) {
    action.elapsed = Math.min(clip.duration, frame / RATE);
    actor.update(1 / RATE, action.elapsed, state, origin);
    hitsNear.push(frame && sweptWeaponContact(actor.previousSegment, actor.segment, capsules[0], target.hurtRadius) ? 1 : 0);
    hitsMid.push(frame && sweptWeaponContact(actor.previousSegment, actor.segment, capsules[1], target.hurtRadius) ? 1 : 0);
    const tip = new T.Vector3(...actor.segment[1]);
    tipSpeed.push(previousTip ? tip.distanceTo(previousTip) * RATE : 0);
    previousTip = tip;
  }
  // A guard pose can rest the blade inside the opponent's capsule for the whole clip, so density
  // alone would pick the recovery. The cut is the contact that MOVES: each contact frame is
  // weighted by the tip's speed there.
  // The strike is the fastest contact frame. The window opens at the first contact of that pass
  // (searching back at most 0.2 s, then two frames of lead-in) and runs for MAX seconds, so it
  // brackets the cut itself rather than the follow-through the blade spends resting in the capsule.
  const width = Math.round(MAX * RATE);
  let peak = 1;
  for (let i = 1; i <= frames; i++) if (hitsNear[i] * tipSpeed[i] > hitsNear[peak] * tipSpeed[peak]) peak = i;
  let start = peak;
  for (let i = peak; i >= Math.max(1, peak - Math.round(.2 * RATE)); i--) if (hitsNear[i]) start = i;
  start = Math.max(0, start - 2);
  const end = Math.min(frames, start + width);
  let a = 0, b = 0;
  for (let i = start + 1; i <= end; i++) { a += hitsNear[i]; b += hitsMid[i]; }
  const best = {start, end, span: end - start, a, b};
  const t0 = best.start / RATE, t1 = best.end / RATE;
  console.log(JSON.stringify({
    clip: name, duration: +clip.duration.toFixed(4),
    window: [+t0.toFixed(4), +t1.toFixed(4)],
    near: `${best.a}/${best.span}`, plus30cm: `${best.b}/${best.span}`,
    windup: +t0.toFixed(4), active: +(t1 - t0).toFixed(4), recovery: +(clip.duration - t1).toFixed(4),
  }));
}
