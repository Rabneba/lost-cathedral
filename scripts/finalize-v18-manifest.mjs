// Write the reviewed V18 manifest: V17's manifest (docs copy) with the light2 entry replaced by the
// measured timings of the retargeted Sword_hit2 clip and the light given its chain point. Every other
// entry (light, heavy, shield mount, locomotion speeds, runtime adjustments) is carried over untouched.
//
//   VESPER_LIGHT2_WINDOW=<start>,<end>   the blade-contact hit window from scripts/fit-hit-window.mjs
//   VESPER_CHAIN_AT=1.067                seconds into the light where light2 takes over (measured with
//                                        scripts/measure-chain-point.mjs)
//   [VESPER_LIGHT2_BLEND=.16]            cross-fade into light2 (the 51.65 deg pivot happens inside it)
//   node scripts/finalize-v18-manifest.mjs
import {readFileSync, writeFileSync} from 'node:fs';
import {createHash as hash} from 'node:crypto';

const BASE = 'docs/player-motion-revision-3/player-video-candidate-v17-manifest.json';
const BUILT = 'assets/player-motion-revision-3/player-video-candidate-v18-manifest.json';
const REPORT = 'assets/player-motion-revision-3/player-video-candidate-v18-report.json';
const GLB = 'assets/player-motion-revision-3/player-video-candidate-v18.glb';
const OUT = 'docs/player-motion-revision-3/player-video-candidate-v18-manifest.json';

const E = process.env;
if (!E.VESPER_LIGHT2_WINDOW || !E.VESPER_CHAIN_AT) throw new Error('VESPER_LIGHT2_WINDOW=start,end and VESPER_CHAIN_AT are required');
const [start, end] = E.VESPER_LIGHT2_WINDOW.split(',').map(Number), chainAt = +E.VESPER_CHAIN_AT, blendIn = +(E.VESPER_LIGHT2_BLEND || .16);

const meta = JSON.parse(readFileSync(BASE, 'utf8'));
const built = JSON.parse(readFileSync(BUILT, 'utf8')), report = JSON.parse(readFileSync(REPORT, 'utf8'));
const sha = hash('sha256').update(readFileSync(GLB)).digest('hex');
if (built.sha256 !== sha) throw new Error('the built manifest does not match the GLB on disk; rebuild first');
const light2 = built.clips.light2, duration = light2.duration;
if (!(start >= 0 && end > start && end <= duration && chainAt > meta.clips.light.hitWindows[0][1] && chainAt < meta.clips.light.duration)) throw new Error('window or chain point outside the clips');

meta.asset = GLB;
meta.revision = 'sword4-light-combo-2026-09-16';
meta.previousCandidateSha256 = meta.sha256;
meta.sha256 = sha;
meta.reviewStatus = 'V18: V17 plus light2, the second hit of the light combo, retargeted from Sword_hit2 of the user\'s '
  + 'Sword 4 pack in the light\'s own heading frame so it continues the light\'s recovery at the chain point; the cut '
  + 'is turned 51.65 deg into the opponent by the runtime (facingYawDegrees) and the recovery pivots back toward the '
  + 'guard. light, heavy and every other clip are byte-identical to V17. User judgement pending.';
meta.clips.light = {
  ...meta.clips.light,
  chainAt,
  chainNote: `light2 takes over ${chainAt.toFixed(3)} s in (${Math.round((1 - (chainAt - meta.clips.light.hitWindows[0][1]) / meta.clips.light.recovery) * 100)} % of the recovery still ahead): measured joint deltas to light2\'s first frame there are tip 0.14 m, hand 0.12 m, feet 0.02 m (scripts/measure-chain-point.mjs)`,
};
meta.clips.light2 = {
  duration,
  blendIn,
  windup: +start.toFixed(4),
  active: +(end - start).toFixed(4),
  recovery: +(duration - end).toFixed(4),
  hitWindows: [[+start.toFixed(4), +end.toFixed(4)]],
  facingYawDegrees: light2.facingYawDegrees,
  damage: 70,
  cost: 22,
  reach: 2.8,
  source: light2.source,
  sourceFrames: light2.sourceFrames,
  sourceFps: report.srcFps,
  note: 'The second hit of the light combo: a backhand cut across the front, only reachable by chaining out of the light. '
    + 'The performer\'s second cut faces 51.65 deg from the first, so the visual root turns that far as the clip blends in '
    + `and the pose pivots ${-report.pivot.endDegrees} deg back during the recovery (baked, VESPER_PIVOT_*), finishing 12 deg from the light\'s guard, which is the nearest stance to idle.`,
  pivot: {runtimeDegrees: light2.facingYawDegrees, bakedReturnDegrees: report.pivot.endDegrees, bakedSpan: report.pivot.span},
  // Enveloped corrections that keep the blade out of the character through the coil (0 frames of
  // self-contact, scripts/audit-player-blade-self-contact.mjs): the sword arm swings wider/higher, the
  // shield arm braces early and holds through the cut's start.
  armBrace: {liftDegrees: report.armOut?.degrees ?? 0, yawDegrees: report.armOut?.yawDegrees ?? 0, span: report.armOut?.span},
  shieldBrace: {pullDegrees: report.shieldBrace?.pullDegrees, dropDegrees: report.shieldBrace?.dropDegrees, span: report.shieldBrace?.span},
  chainedFrom: 'light',
  hitWindowSource: 'blade contact at the solid-body distance weighted by blade-tip speed (scripts/fit-hit-window.mjs), capped at 0.25 s',
};
meta.limitations = [
  ...(meta.limitations || []),
  'light2 is a chained clip: its first frame continues the light at 1.067 s, so it is never played from idle. Its 51.65 deg turn '
  + 'into the opponent happens in the 0.16 s cross-fade at the chain (the feet rotate about the root with it, as a lock-on pivot) and '
  + '39.65 deg of it is baked back into the recovery, where the planted toes slide up to about 1 m/s while the guard settles.',
  'The Sword 4 performer coils the second cut with the blade drawn behind the body; on this wider torso that path crossed the left '
  + 'flank, the left arm and the shield, so the sword arm is swung 15 deg wider and lifted 10 deg through the coil and the shield arm '
  + 'braces out of the opening sweep (VESPER_ARM_*, VESPER_SHIELD_* envelopes, 0 at both ends): authored, not captured.',
];
writeFileSync(OUT, JSON.stringify(meta, null, 1));
writeFileSync(BUILT, JSON.stringify(meta, null, 1));
console.log('wrote', OUT, 'sha256', sha.slice(0, 16));
console.log('light.chainAt', meta.clips.light.chainAt, 'light2', JSON.stringify({...meta.clips.light2, source: undefined, note: undefined}));
