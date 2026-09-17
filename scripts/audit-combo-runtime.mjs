// The light combo through the real runtime: the player actor (blends, facing yaw, foot plant, sole
// lift) plays idle -> light -> light2 (chained at the manifest chain point, exactly as the encounter
// does it) -> idle at 120 Hz, and this reports what the cross-fades do that pure-clip audits cannot
// see: the sword tip's speed through the chain against its speed in the cuts (a pop is a spike),
// the planted toes' slide per phase (the lock-on pivot lives here), the lowest sole (the runtime
// soles bar is -3 mm) and the largest per-frame root lift. Reads the game's own bundle
// (src/game/asset-paths.js) unless VESPER_RIG / VESPER_MANIFEST override it.
//
//   node scripts/audit-combo-runtime.mjs  [VESPER_COMBO_REPORT=docs/.../v18-combo-runtime.json]
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import * as T from 'three';
import {loadGLB} from './load-glb-node.mjs';
import {createActor, weaponSegmentFor} from '../src/game/actors.js';
import {ASSETS} from '../src/game/asset-paths.js';
import {chainPoint} from '../src/game/player-combo.js';

const RIG = process.env.VESPER_RIG || fileURLToPath(ASSETS.playerRig);
const metadata = process.env.VESPER_MANIFEST ? JSON.parse(await fs.readFile(process.env.VESPER_MANIFEST, 'utf8')) : ASSETS.motion.player;
const gltf = await loadGLB(RIG), actor = createActor(gltf, 1.85, false, true, metadata);
const socket = actor.body.getObjectByName('WeaponSocket');
actor.weapon = new T.Group(); actor.weapon.rotation.x = Math.PI / 2; socket.add(actor.weapon);
actor.weaponSegment = weaponSegmentFor(false, ASSETS);
const light = metadata.clips.light, light2 = metadata.clips.light2;
if (!light2) throw new Error('the bundle has no light2');
const chainAt = chainPoint(light), RATE = 120, origin = {x: 0, z: 0, yaw: 0};

// Skinned foot vertices, as audit-runtime-soles.mjs finds them.
const vertices = [];
gltf.scene.traverse(mesh => {
  if (!mesh.isSkinnedMesh) return;
  const {position, skinIndex, skinWeight} = mesh.geometry.attributes;
  for (let index = 0; index < position.count; index++) {
    let weight = 0;
    for (let c = 0; c < 4; c++) if (/(?:Foot|ToeBase)$/.test(mesh.skeleton.bones[skinIndex.getComponent(index, c)].name)) weight += skinWeight.getComponent(index, c);
    if (weight >= .5) vertices.push({mesh, index});
  }
});
const point = new T.Vector3();
const lowestSole = () => { let y = Infinity; for (const {mesh, index} of vertices) y = Math.min(y, mesh.getVertexPosition(index, point).applyMatrix4(mesh.matrixWorld).y); return y; };
const toes = () => Object.fromEntries(['Left', 'Right'].map(side => [side, actor.body.getObjectByName('mixamorig' + side + 'ToeBase').getWorldPosition(new T.Vector3())]));

// The sequence the encounter produces for tap-tap: light from 0, light2 taking over at chainAt with a
// fresh action object (the animation controller restarts the layer on a new token), then idle.
const phases = [
  {name: 'idle-in', seconds: .5, action: () => null},
  {name: 'light', seconds: chainAt, action: t => ({name: 'light', elapsed: t})},
  {name: 'light2', seconds: light2.duration, action: t => ({name: 'light2', elapsed: t, chained: true})},
  {name: 'idle-out', seconds: .8, action: () => null},
];
const blend = light2.blendIn ?? .1;
const rows = [], samples = [];
let clock = 0, previousTip = null, previousToes = null, previousLift = 0, token = null;
actor.reset(origin);
for (const phase of phases) {
  const row = {phase: phase.name, seconds: +phase.seconds.toFixed(4), maxTipSpeed: 0, maxTipSpeedAt: 0, maxToeSlide: 0, maxToeSlideAt: 0, lowestSole: Infinity, maxLiftStep: 0, blendTipSpeed: 0, blendToeSlide: 0};
  const actionObject = phase.action(0);
  for (let frame = 0; frame < Math.round(phase.seconds * RATE); frame++) {
    const t = frame / RATE;
    let action = null;
    if (actionObject) { actionObject.elapsed = t; action = actionObject; }
    clock += 1 / RATE;
    actor.update(1 / RATE, clock, {health: 100, blocking: false, action}, origin);
    const tip = new T.Vector3(...actor.segment[1]), feet = toes(), sole = lowestSole(), lift = actor.visualRoot.position.y * actor.worldScale;
    const tipSpeed = previousTip ? tip.distanceTo(previousTip) * RATE : 0;
    let slide = 0;
    if (previousToes) for (const side of ['Left', 'Right']) {
      // Planted when the toe is within 4 cm of the floor in both frames.
      if (feet[side].y < .04 && previousToes[side].y < .04) slide = Math.max(slide, Math.hypot(feet[side].x - previousToes[side].x, feet[side].z - previousToes[side].z) * RATE);
    }
    if (tipSpeed > row.maxTipSpeed) { row.maxTipSpeed = tipSpeed; row.maxTipSpeedAt = t; }
    if (slide > row.maxToeSlide) { row.maxToeSlide = slide; row.maxToeSlideAt = t; }
    if (t < blend) { row.blendTipSpeed = Math.max(row.blendTipSpeed, tipSpeed); row.blendToeSlide = Math.max(row.blendToeSlide, slide); }
    row.lowestSole = Math.min(row.lowestSole, sole);
    row.maxLiftStep = Math.max(row.maxLiftStep, Math.abs(lift - previousLift));
    samples.push({phase: phase.name, t: +t.toFixed(4), tipSpeed: +tipSpeed.toFixed(2), slide: +slide.toFixed(2), sole: +sole.toFixed(4), yawOffsetDeg: +T.MathUtils.radToDeg(actor.animation.yawOffset || 0).toFixed(1)});
    previousTip = tip; previousToes = feet; previousLift = lift;
  }
  for (const key of ['maxTipSpeed', 'maxToeSlide', 'lowestSole', 'maxLiftStep', 'blendTipSpeed', 'blendToeSlide']) row[key] = +row[key].toFixed(3);
  rows.push(row);
}
const cutTip = Math.max(rows[1].maxTipSpeed, rows[2].maxTipSpeed);
const report = {
  createdAt: new Date().toISOString(), rig: RIG, sha256: createHash('sha256').update(await fs.readFile(RIG)).digest('hex'),
  chainAt, light2BlendIn: blend, facingYawDegrees: light2.facingYawDegrees ?? 0,
  method: 'Real actor (createActor) at 120 Hz through idle -> light (cut at the manifest chain point) -> light2 -> idle. Tip speed from the weapon segment end; toe slide is the horizontal speed of a ToeBase while below 4 cm in consecutive frames; lowest sole from the skinned foot vertices after the runtime foot plant and sole lift; yawOffset is the blended facingYawDegrees.',
  rows,
  verdict: {
    tipPopAtChain: rows[2].blendTipSpeed, tipSpeedInCuts: +cutTip.toFixed(3), chainTipRatio: +(rows[2].blendTipSpeed / cutTip).toFixed(3),
    pivotToeSlideAtChain: rows[2].blendToeSlide, recoveryToeSlide: rows[2].maxToeSlide, lowestSole: Math.min(...rows.map(r => r.lowestSole)),
  },
};
report.passed = report.verdict.chainTipRatio < 1 && report.verdict.lowestSole > -.003 && rows.every(r => r.maxLiftStep <= .06 * actor.worldScale);
await fs.writeFile(process.env.VESPER_COMBO_REPORT || 'docs/player-motion-revision-3/v18-combo-runtime.json', JSON.stringify({...report, samples}, null, 1) + '\n');
console.log(JSON.stringify({rows, verdict: report.verdict, passed: report.passed}, null, 1));
if (!report.passed) process.exitCode = 1;
