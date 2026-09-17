// Where can one player clip hand over to another without the sword popping? Poses clip A at
// every time in a range and clip B at every time in another range (pure mixer poses, exactly what
// ActorAnimation cross-fades) and reports the joint deltas between the two poses: right hand,
// elbow, blade tip, hips, feet, left hand, and the hips' facing. The best pairs (lowest weighted
// score) are what the combo's chain point and the follow-up clip's trim should be built from.
//
//   VESPER_A_RIG=assets/.../v17.glb VESPER_A_CLIP=light VESPER_A_RANGE=0.66,1.30,0.0167 \
//   VESPER_B_RIG=assets/.../cand-hit2.glb VESPER_B_CLIP=light VESPER_B_RANGE=0,0.6,0.0333 \
//   [VESPER_TOP=12] [VESPER_PAIRS=1.011:0.333,1.1:0.4] [VESPER_A_YAW_DEG=0 VESPER_B_YAW_DEG=-51.65]
//   node scripts/measure-chain-point.mjs
//
// VESPER_PAIRS reports exactly those (tA:tB) pairs instead of the grid search.
import {AnimationMixer, Vector3, Quaternion, MathUtils} from 'three';
import {loadGLB} from './load-glb-node.mjs';

const E = process.env;
const range = text => { const [a, b, step] = text.split(',').map(Number); const out = []; for (let t = a; t <= b + 1e-9; t += step) out.push(+t.toFixed(4)); return out; };
const JOINTS = ['Hips', 'Spine2', 'RightArm', 'RightForeArm', 'RightHand', 'LeftArm', 'LeftForeArm', 'LeftHand', 'LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase'];

async function open(rig, clipName) {
  const gltf = await loadGLB(rig), scene = gltf.scene;
  const clip = gltf.animations.find(c => c.name === clipName);
  if (!clip) throw new Error(`${rig} has no clip ${clipName}; has ${gltf.animations.map(c => c.name).join(', ')}`);
  const mixer = new AnimationMixer(scene), action = mixer.clipAction(clip);
  action.play();
  const nodes = Object.fromEntries(JOINTS.map(j => [j, scene.getObjectByName('mixamorig' + j)]));
  nodes.socket = scene.getObjectByName('WeaponSocket');
  return {scene, clip, mixer, action, nodes, duration: clip.duration};
}

function pose(bundle, time) {
  bundle.action.time = Math.min(bundle.duration, Math.max(0, time));
  bundle.mixer.update(0);
  bundle.scene.updateMatrixWorld(true);
  const p = {};
  for (const j of JOINTS) p[j] = bundle.nodes[j].getWorldPosition(new Vector3());
  p.socket = bundle.nodes.socket.getWorldPosition(new Vector3());
  p.blade = new Vector3(0, 0, 1).transformDirection(bundle.nodes.socket.matrixWorld).normalize();
  p.tip = p.socket.clone().addScaledVector(p.blade, 1.2);
  // Emulate the runtime's facingYawDegrees (visual root yaw about world Y through the origin).
  if (bundle.yaw) { const rot = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), bundle.yaw); for (const k of [...JOINTS, 'socket', 'tip']) p[k].applyQuaternion(rot); p.blade.applyQuaternion(rot); }
  // Hips facing: the lateral hip axis is the Hips bone's local X in this rig family; yaw of the
  // forward axis derived from it, measured in the horizontal plane.
  const q = bundle.nodes.Hips.getWorldQuaternion(new Quaternion());
  const lateral = new Vector3(1, 0, 0).applyQuaternion(q); lateral.y = 0; lateral.normalize();
  if (bundle.yaw) lateral.applyQuaternion(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), bundle.yaw));
  p.hipsYaw = MathUtils.radToDeg(Math.atan2(lateral.x, lateral.z));
  return p;
}

function compare(a, b) {
  const d = (j) => a[j].distanceTo(b[j]);
  const blade = MathUtils.radToDeg(Math.acos(MathUtils.clamp(a.blade.dot(b.blade), -1, 1)));
  let yaw = a.hipsYaw - b.hipsYaw; yaw = ((yaw + 540) % 360) - 180;
  const row = {
    hand: d('RightHand'), elbow: d('RightForeArm'), shoulder: d('RightArm'), tip: d('tip'), bladeDeg: blade,
    hips: d('Hips'), hipsYawDeg: yaw, chest: d('Spine2'), leftHand: d('LeftHand'),
    feet: Math.max(d('LeftFoot'), d('RightFoot'), d('LeftToeBase'), d('RightToeBase')),
  };
  // What the eye sees in a 0.1 s cross-fade: the sword tip and the hand first, then the body.
  row.score = row.tip + row.hand + .5 * row.elbow + .5 * row.hips + .5 * row.feet + .3 * row.leftHand + Math.abs(yaw) / 90 * .3;
  return row;
}

const A = await open(E.VESPER_A_RIG, E.VESPER_A_CLIP || 'light');
const B = await open(E.VESPER_B_RIG, E.VESPER_B_CLIP || 'light');
// VESPER_A_YAW_DEG / VESPER_B_YAW_DEG: the clip's facingYawDegrees (or a retarget heading offset).
A.yaw = MathUtils.degToRad(+(E.VESPER_A_YAW_DEG || 0)); B.yaw = MathUtils.degToRad(+(E.VESPER_B_YAW_DEG || 0));
const fmt = row => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, +v.toFixed(3)]));
const rows = [];
if (E.VESPER_PAIRS) {
  for (const pair of E.VESPER_PAIRS.split(',')) { const [tA, tB] = pair.split(':').map(Number); rows.push({tA, tB, ...fmt(compare(pose(A, tA), pose(B, tB)))}); }
  for (const r of rows) console.log(JSON.stringify(r));
} else {
  const tas = range(E.VESPER_A_RANGE || `0,${A.duration},0.0333`), tbs = range(E.VESPER_B_RANGE || `0,${B.duration},0.0333`);
  const posesB = tbs.map(t => pose(B, t));
  for (const tA of tas) { const pa = pose(A, tA); tbs.forEach((tB, i) => rows.push({tA, tB, ...fmt(compare(pa, posesB[i]))})); }
  rows.sort((x, y) => x.score - y.score);
  const top = +(E.VESPER_TOP || 12);
  console.log(`A ${E.VESPER_A_RIG}:${A.clip.name} (${A.duration.toFixed(3)} s) vs B ${E.VESPER_B_RIG}:${B.clip.name} (${B.duration.toFixed(3)} s); ${rows.length} pairs; best ${top}:`);
  for (const r of rows.slice(0, top)) console.log(JSON.stringify(r));
  // Best B time for each A time, so a chain point can be read off as a curve.
  console.log('best tB per tA:');
  for (const tA of tas) { const best = rows.filter(r => r.tA === tA)[0]; console.log(`  tA ${tA.toFixed(3)} -> tB ${best.tB.toFixed(3)} score ${best.score.toFixed(3)} tip ${best.tip.toFixed(2)} hand ${best.hand.toFixed(2)} hips ${best.hips.toFixed(2)} feet ${best.feet.toFixed(2)} yaw ${best.hipsYawDeg.toFixed(0)}`); }
}

// VESPER_DUMP=A|B prints that clip's curves (hips yaw and position, both feet with height, right
// hand, blade tip) over its range, for choosing a trim start and a yaw offset by hand.
if (E.VESPER_DUMP) {
  const which = E.VESPER_DUMP === 'B' ? B : A, times = range(E.VESPER_DUMP === 'B' ? (E.VESPER_B_RANGE || `0,${B.duration},0.0333`) : (E.VESPER_A_RANGE || `0,${A.duration},0.0333`));
  const v = p => `${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}`;
  console.log(`dump ${E.VESPER_DUMP}: t | hipsYaw | hips | Lfoot | Rfoot | Ltoe.y Rtoe.y | Rhand | tip | blade | Lshoulder | Lelbow | Lhand`);
  for (const t of times) { const p = pose(which, t); console.log(`${t.toFixed(3)} | ${p.hipsYaw.toFixed(0).padStart(4)} | ${v(p.Hips)} | ${v(p.LeftFoot)} | ${v(p.RightFoot)} | ${p.LeftToeBase.y.toFixed(2)} ${p.RightToeBase.y.toFixed(2)} | ${v(p.RightHand)} | ${v(p.tip)} | ${v(p.blade)} | ${v(p.LeftArm)} | ${v(p.LeftForeArm)} | ${v(p.LeftHand)}`); }
}
