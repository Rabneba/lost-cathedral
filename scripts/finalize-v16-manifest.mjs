// Write the reviewed V16 manifest: V15's manifest with only the light and heavy entries replaced
// by the measured timings of the retargeted Sword 4 clips. Everything else (shield mount, other
// clips, locomotion speeds, runtime adjustments) is carried over untouched.
//
//   node scripts/finalize-v16-manifest.mjs
import {readFileSync, writeFileSync} from 'node:fs';
import {createHash as hash} from 'node:crypto';

const BASE = 'docs/player-motion-revision-2/player-video-candidate-v15-manifest.json';
const GLB = 'assets/player-motion-revision-3/player-video-candidate-v16.glb';
const OUT = 'docs/player-motion-revision-3/player-video-candidate-v16-manifest.json';
const ASSET_OUT = 'assets/player-motion-revision-3/player-video-candidate-v16-manifest.json';

// Measured with scripts/fit-hit-window.mjs (blade contact weighted by tip speed) at yaw 0.
const MEASURED = {
  light: {
    duration: 39 / 30, windup: .4083, active: .25, recovery: .6417,
    sourceFbx: 'assets/library/sword-4/Sword_hit1_in_place.fbx',
    sourceAction: 'root|Sword_hit1|BaseLayer', sourceFrames: [52, 105], sourceFps: 30,
    note: 'A horizontal cut: the blade cocks over the left shoulder and sweeps through to the low right.',
  },
  heavy: {
    duration: 63 / 30, windup: .8917, active: .25, recovery: .9583,
    sourceFbx: 'assets/library/sword-4/Sword_hit3_in_place.fbx',
    sourceAction: 'root|Sword_hit3|BaseLayer', sourceFrames: [1, 51], sourceFps: 30,
    note: 'A committed overhead chop: the blade is raised flat above the head and driven down across the body to a low finish.',
  },
};
const TRANSFER = 'user-supplied "Sword 4" pack, retargeted to this rig by '
  + 'scripts/blender/player_replace_attack_clip.py: per-bone rest alignment from joint-position '
  + 'frames against a source reference frame, world-space rotation delta, forearm pronation moved '
  + 'off the wrist, left arm and both grips held at the V15 guard pose, hips travel kept, soles '
  + 'grounded through skinned foot vertices, sockets hand-relative';

const meta = JSON.parse(readFileSync(BASE, 'utf8'));
const sha = hash('sha256').update(readFileSync(GLB)).digest('hex');
meta.asset = GLB;
meta.revision = 'sword4-attacks-2026-09-16';
meta.previousCandidateSha256 = meta.sha256;
meta.sha256 = sha;
meta.reviewStatus = 'V16: light and heavy replaced by retargeted clips from the user\'s Sword 4 pack '
  + '(library clips). Every other clip is byte-identical to V15. User judgement pending.';
for (const [name, m] of Object.entries(MEASURED)) {
  const previous = meta.clips[name] || {};
  meta.clips[name] = {
    duration: m.duration,
    blendIn: previous.blendIn ?? .1,
    windup: m.windup,
    active: m.active,
    recovery: m.recovery,
    hitWindows: [[m.windup, +(m.windup + m.active).toFixed(4)]],
    facingYawDegrees: 0,
    source: `${m.sourceFbx} (${m.sourceAction}), source frames ${m.sourceFrames[0]}-${m.sourceFrames[1]} at ${m.sourceFps} fps, resampled to ${m.duration.toFixed(3)} s; ${TRANSFER}`,
    sourceFrames: m.sourceFrames,
    sourceFps: m.sourceFps,
    note: m.note,
    hitWindowSource: 'blade contact at the solid-body distance weighted by blade-tip speed (scripts/fit-hit-window.mjs), capped at 0.25 s',
  };
}
meta.limitations = [
  ...(meta.limitations || []).filter(line => !/Monocular capture/.test(line)),
  'The Sword 4 pack is sword-only: the light and heavy hold the left (shield) arm and both hand '
  + 'grips at the V15 guard pose rather than transferring them, so the shield never swings through the body.',
  'The source skeleton distributes forearm pronation over twist bones this rig does not have, so the '
  + 'retarget rolls the forearm about its own axis and leaves at most 25 degrees at the wrist; the '
  + 'hand, the socket and the blade are untouched by that correction.',
];
writeFileSync(OUT, JSON.stringify(meta, null, 1));
writeFileSync(ASSET_OUT, JSON.stringify(meta, null, 1));
console.log('wrote', OUT, 'sha256', sha.slice(0, 16));
for (const name of ['light', 'heavy']) console.log(name, JSON.stringify({...meta.clips[name], source: undefined}));
