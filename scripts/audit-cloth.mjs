// Cloth attachment / stability audit.
//
// Loads the real player and boss rigs, binds the code cloth exactly the way
// src/game/actors.js does, plays the real clips through an AnimationMixer and
// measures what actually matters for "properly attached, moves naturally":
//
//   rootAttachment   distance between a sewn row vertex and the socket target
//   maxStretch       worst vertical edge extension over its rest length
//   bodyPenetration  deepest excursion inside the fitted body capsules
//   floorPenetration deepest excursion below the arena floor
//   resets           discontinuity resets (a teleport must cause exactly one)
//   hemSpeed         fastest a hem particle moves RELATIVE TO ITS SEAM — the jitter
//                    / energy-pump check
//   drapeGap         how far the sheet stands off the nearest body capsule
//   skinInside       share of the free cloth inside the REAL skinned mesh, and how deep
//   seamSkin         how far the sewn rows sit off the skinned armour they hang on
//   cost             wall-clock cost of the 60 Hz cloth step
//
// Usage: node scripts/audit-cloth.mjs [--json docs/cloth-simulation-audit.json]
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import * as T from 'three';
import {loadGLB} from './load-glb-node.mjs';
import {ASSETS} from '../src/game/asset-paths.js';
import {actorDimensions} from '../src/game/actor-scale.js';
import {createPlayerCloth, updatePlayerCloth, bindCloth} from '../src/game/player-cloth.js';
import {createBossCloth} from '../src/game/boss-cloth.js';

const FLOOR_Y = .02;
const localPath = href => decodeURIComponent(new URL(href).pathname);
const argument = (name, fallback) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : fallback; };

async function makeActor(kind) {
  const isBoss = kind === 'boss';
  const gltf = await loadGLB(localPath(isBoss ? ASSETS.bossRig : ASSETS.playerRig));
  const metadata = ASSETS.motion[kind];
  const {scale} = actorDimensions(isBoss, metadata);
  const root = new T.Group(); root.scale.setScalar(scale);
  const visualRoot = new T.Group(); root.add(visualRoot); visualRoot.add(gltf.scene);
  const cloth = isBoss ? createBossCloth(2.5) : createPlayerCloth(1.85);
  cloth.clothSimulation.profile = true;
  root.add(cloth);
  root.updateMatrixWorld(true);
  const bindings = bindCloth(cloth, gltf.scene);
  assert(bindings.length === cloth.userData.bindings.length, `${kind}: a garment socket found no bone`);
  const mixer = new T.AnimationMixer(gltf.scene);
  const clips = new Map(gltf.animations.map(clip => [clip.name, clip]));
  const inverse = new T.Matrix4(), matrix = new T.Matrix4();
  return {
    kind, root, cloth, mixer, clips, scale, bindings, action: null,
    play(name) {
      this.mixer.stopAllAction();
      const clip = this.clips.get(name);
      assert(clip, `${kind}: missing clip ${name}`);
      this.action = this.mixer.clipAction(clip); this.action.reset().play();
    },
    pose(dt) {
      this.mixer.update(dt);
      this.root.updateMatrixWorld(true);
      inverse.copy(this.root.matrixWorld).invert();
      for (const {garment, bone, offset} of this.bindings) {
        matrix.copy(inverse).multiply(bone.matrixWorld).multiply(offset);
        matrix.decompose(garment.position, garment.quaternion, garment.scale);
      }
      this.root.updateMatrixWorld(true);
    },
  };
}

// ---------------------------------------------------------------------------
// Cloth against the REAL skinned mesh.
//
// Every other metric here measures the cloth against the fitted capsules, and a
// capsule is a guess: the boss's fauld and its silver fringe stand 5 cm further
// back than the capsule that stood in for them, so 10 % of his cape sat inside
// the armour — the belt drew straight across the middle of the cape on screen —
// while this file printed `body 0.0 mm · in contact 0.00%` for the same frame.
// This samples the actual skinned vertices and asks two questions the capsules
// cannot answer: is any cloth inside the character, and are the sewn rows
// actually ON the armour (daylight above a tasset is what makes it read as a
// hard cut edge floating in mid air)?
// ---------------------------------------------------------------------------

const SKIN_EVERY = 20;      // frames between samples — this is the expensive one
// Every vertex. Decimating to every second one moved the nearest vertex up to a
// centimetre away, and on a concave crease that flipped the sign: the audit read
// 49 mm of penetration on a boss idle that a full-resolution probe says is clean.
const SKIN_STRIDE = 1;
// Vertical-seam extension histogram, 0.1 % per bin up to 20 %.
const STRETCH_BINS = 200;

/** Closest point on a triangle to p, as barycentric weights. */
function barycentric(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz) {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) return [1, 0, 0];
  const bpx = px - bx, bpy = py - by, bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return [0, 1, 0];
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return [1 - v, v, 0]; }
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return [0, 0, 1];
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return [1 - w, 0, w]; }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return [0, 1 - w, w]; }
  const denom = 1 / (va + vb + vc), v = vb * denom, w = vc * denom;
  return [1 - v - w, v, w];
}

function skinSampler(actor) {
  const meshes = [];
  actor.root.traverse(node => { if (node.isSkinnedMesh) meshes.push(node); });
  let count = 0;
  for (const mesh of meshes) count += Math.ceil(mesh.geometry.attributes.position.count / SKIN_STRIDE);
  const cloud = new Float64Array(count * 6);       // x y z nx ny nz, world space
  const point = new T.Vector3(), offset = new T.Vector3(), normal = new T.Vector3();
  const cell = .06 * actor.scale, buckets = new Map();
  const hash = (a, b, c) => (a * 73856093 ^ b * 19349663 ^ c * 83492791);
  // Triangle topology, and for every vertex the triangles that meet at it.
  // Fixed for the life of the rig, so it is built once. The nearest VERTEX and
  // its own normal are not enough to say "inside": on a crease, or beside a
  // greave in free space, that dot product carries no information and prints
  // penetrations that are not there.
  const corners = [];
  {
    let base = 0;
    for (const mesh of meshes) {
      const positions = mesh.geometry.attributes.position, index = mesh.geometry.index;
      const n = index ? index.count : positions.count;
      for (let i = 0; i < n; i += 3) corners.push(
        base + (index ? index.getX(i) : i), base + (index ? index.getX(i + 1) : i + 1), base + (index ? index.getX(i + 2) : i + 2));
      base += positions.count;
    }
  }
  const triangles = Int32Array.from(corners);
  const offsets = new Int32Array(count + 1);
  for (let t = 0; t < triangles.length; t++) offsets[triangles[t] + 1]++;
  for (let i = 0; i < count; i++) offsets[i + 1] += offsets[i];
  const incident = new Int32Array(triangles.length);
  {
    const cursor = offsets.slice();
    for (let t = 0; t < triangles.length; t++) incident[cursor[triangles[t]]++] = (t / 3) | 0;
  }
  return {
    /** Re-evaluate the skin for the current pose and rebuild the lookup grid. */
    sample() {
      let k = 0;
      for (const mesh of meshes) {
        mesh.updateMatrixWorld(true);
        const positions = mesh.geometry.attributes.position, normals = mesh.geometry.attributes.normal;
        for (let i = 0; i < positions.count; i += SKIN_STRIDE) {
          point.fromBufferAttribute(positions, i);
          mesh.applyBoneTransform(i, point); point.applyMatrix4(mesh.matrixWorld);
          // The skinned normal, taken as the image of a short offset along it so
          // it follows the same bone blend as the vertex itself.
          normal.fromBufferAttribute(normals, i);
          offset.fromBufferAttribute(positions, i).addScaledVector(normal, .01);
          mesh.applyBoneTransform(i, offset); offset.applyMatrix4(mesh.matrixWorld).sub(point).normalize();
          cloud[k] = point.x; cloud[k + 1] = point.y; cloud[k + 2] = point.z;
          cloud[k + 3] = offset.x; cloud[k + 4] = offset.y; cloud[k + 5] = offset.z;
          k += 6;
        }
      }
      buckets.clear();
      for (let i = 0; i < k; i += 6) {
        const key = hash(Math.floor(cloud[i] / cell), Math.floor(cloud[i + 1] / cell), Math.floor(cloud[i + 2] / cell));
        let bucket = buckets.get(key); if (!bucket) buckets.set(key, bucket = []);
        bucket.push(i);
      }
    },
    /** {distance, signed} to the nearest skinned vertex; signed < 0 is inside. */
    nearest(x, y, z) {
      const a0 = Math.floor(x / cell), b0 = Math.floor(y / cell), c0 = Math.floor(z / cell);
      let best = Infinity, at = -1;
      for (let r = 1; r <= 4; r++) {
        for (let a = a0 - r; a <= a0 + r; a++) for (let b = b0 - r; b <= b0 + r; b++) for (let c = c0 - r; c <= c0 + r; c++) {
          if (r > 1 && Math.abs(a - a0) < r && Math.abs(b - b0) < r && Math.abs(c - c0) < r) continue;
          const bucket = buckets.get(hash(a, b, c)); if (!bucket) continue;
          for (const i of bucket) {
            const d = (cloud[i] - x) ** 2 + (cloud[i + 1] - y) ** 2 + (cloud[i + 2] - z) ** 2;
            if (d < best) { best = d; at = i; }
          }
        }
        if (at >= 0 && Math.sqrt(best) < r * cell) break;
      }
      if (at < 0) return {distance: Infinity, signed: Infinity};
      // Refine onto the SURFACE: the closest point of the mesh is on a triangle
      // meeting the closest vertex, and the sign comes from the normal
      // interpolated across that triangle, not from one vertex's own normal.
      const vertex = at / 6;
      let bestSq = Infinity, sx = 0, sy = 0, sz = 0, nx = 0, ny = 0, nz = 0;
      for (let e = offsets[vertex]; e < offsets[vertex + 1]; e++) {
        const t = incident[e] * 3;
        const i0 = triangles[t] * 6, i1 = triangles[t + 1] * 6, i2 = triangles[t + 2] * 6;
        const w = barycentric(x, y, z,
          cloud[i0], cloud[i0 + 1], cloud[i0 + 2], cloud[i1], cloud[i1 + 1], cloud[i1 + 2], cloud[i2], cloud[i2 + 1], cloud[i2 + 2]);
        const px = cloud[i0] * w[0] + cloud[i1] * w[1] + cloud[i2] * w[2];
        const py = cloud[i0 + 1] * w[0] + cloud[i1 + 1] * w[1] + cloud[i2 + 1] * w[2];
        const pz = cloud[i0 + 2] * w[0] + cloud[i1 + 2] * w[1] + cloud[i2 + 2] * w[2];
        const d = (px - x) ** 2 + (py - y) ** 2 + (pz - z) ** 2;
        if (d >= bestSq) continue;
        bestSq = d; sx = px; sy = py; sz = pz;
        nx = cloud[i0 + 3] * w[0] + cloud[i1 + 3] * w[1] + cloud[i2 + 3] * w[2];
        ny = cloud[i0 + 4] * w[0] + cloud[i1 + 4] * w[1] + cloud[i2 + 4] * w[2];
        nz = cloud[i0 + 5] * w[0] + cloud[i1 + 5] * w[1] + cloud[i2 + 5] * w[2];
      }
      if (bestSq === Infinity) return {
        distance: Math.sqrt(best),
        signed: (x - cloud[at]) * cloud[at + 3] + (y - cloud[at + 1]) * cloud[at + 4] + (z - cloud[at + 2]) * cloud[at + 5],
      };
      const length = Math.hypot(nx, ny, nz) || 1;
      return {distance: Math.sqrt(bestSq), signed: ((x - sx) * nx + (y - sy) * ny + (z - sz) * nz) / length};
    },
  };
}

// How close a cloth particle has to be to the skin before the sign of its
// distance means anything. A particle a hand's breadth from any surface is in
// free space beside a limb, and whichever triangle happens to be nearest says
// nothing about inside or outside: that is how the walk take printed a 234 mm
// "greave penetration" whose sample was 151 mm away from the nearest skin
// vertex. Beyond the gate a sample counts as outside.
const SKIN_GATE = .045;      // reference metres, scaled by the actor

function measureSkin(actor, accumulator) {
  const skin = actor.skin; skin.sample();
  const gate = SKIN_GATE * actor.scale;
  for (const panel of actor.cloth.clothSimulation.panels) {
    if (!panel.initialized) continue;
    const {rows, cols, stride, position} = panel;
    // Keyed by index too: the player wears three panels called
    // `detachable-torn-tail`, and pooling them is exactly the mistake this
    // block exists to undo.
    const name = `${actor.cloth.clothSimulation.panels.indexOf(panel)}:${panel.mesh.name}`;
    const perPanel = (accumulator.panels ??= {})[name] ??= {seamSum: 0, seamSamples: 0, seamMax: 0, inside: 0, samples: 0, depth: 0};
    // The sewn rows: how far the top edge of the garment is off the armour.
    for (let i = 0; i <= cols; i++) {
      const k = i * 3;
      const {distance} = skin.nearest(position[k], position[k + 1], position[k + 2]);
      if (distance < Infinity) {
        accumulator.seamSkinSum += distance; accumulator.seamSkinSamples++;
        accumulator.seamSkinMax = Math.max(accumulator.seamSkinMax, distance);
        perPanel.seamSum += distance; perPanel.seamSamples++;
        perPanel.seamMax = Math.max(perPanel.seamMax, distance);
      }
    }
    for (let j = 2; j <= rows; j++) for (let i = 0; i <= cols; i++) {
      const k = (j * stride + i) * 3;
      const {signed, distance} = skin.nearest(position[k], position[k + 1], position[k + 2]);
      if (signed === Infinity) continue;
      accumulator.skinSamples++; perPanel.samples++;
      if (signed < 0 && distance <= gate) {
        accumulator.skinInside++; perPanel.inside++;
        accumulator.skinDepth = Math.max(accumulator.skinDepth, -signed);
        perPanel.depth = Math.max(perPanel.depth, -signed);
      } else if (signed < 0) {
        // Counted separately rather than silently dropped: the gate is a
        // statement that the sign is unreliable out there, not a licence to
        // hide a garment that really has gone through a limb, and a take where
        // this number climbs is worth looking at by eye.
        accumulator.skinUnsure++;
      }
    }
  }
}

/** Signed distance to a capsule surface: negative inside, positive outside. */
function capsuleGap(x, y, z, capsule) { return -capsuleDepth(x, y, z, capsule); }

function capsuleDepth(x, y, z, capsule) {
  const dx = capsule.bx - capsule.ax, dy = capsule.by - capsule.ay, dz = capsule.bz - capsule.az;
  const lengthSq = dx * dx + dy * dy + dz * dz;
  let t = lengthSq > 1e-9 ? ((x - capsule.ax) * dx + (y - capsule.ay) * dy + (z - capsule.az) * dz) / lengthSq : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const sx = capsule.sx || 1;
  const px = (x - (capsule.ax + dx * t)) / sx, py = y - (capsule.ay + dy * t), pz = z - (capsule.az + dz * t);
  return capsule.r - Math.hypot(px, py, pz);
}

function measure(actor, accumulator, frame, measureHem) {
  const simulation = actor.cloth.clothSimulation;
  const worldScale = actor.scale;
  for (let index = 0; index < simulation.panels.length; index++) {
    const panel = simulation.panels[index];
    if (!panel.initialized) continue;
    // Hem speed. A hanging garment on a walking body moves at well under a metre
    // a second; a solver that feeds itself through its own constraint corrections
    // spins the hem at several. This is the assertion that the fabric is calm.
    // Measured only after the first two seconds: seating the panel from its cut
    // shape into its drape is a real, and legitimately quick, fall.
    if (frame > 120 && measureHem) {
      const {rows, stride, cols, position} = panel;
      // Relative to the seam it hangs from, so carrying the garment across the
      // room at 4.6 m/s does not read as the fabric whipping about.
      const e = panel.socket.matrixWorld.elements, sx = e[12], sy = e[13], sz = e[14];
      const store = (accumulator.hems ??= [])[index] ??= {at: -9, xs: new Float32Array((cols + 1) * 3 + 3)};
      const consecutive = store.at === frame - 1;
      store.at = frame;
      const xs = store.xs, s0 = (cols + 1) * 3, dsx = xs[s0] - sx, dsy = xs[s0 + 1] - sy, dsz = xs[s0 + 2] - sz;
      for (let i = 0; i <= cols; i++) {
        const k = (rows * stride + i) * 3, h = i * 3;
        if (consecutive) accumulator.hemSpeed = Math.max(accumulator.hemSpeed,
          Math.hypot(position[k] - xs[h] + dsx, position[k + 1] - xs[h + 1] + dsy, position[k + 2] - xs[h + 2] + dsz) * 60);
        xs[h] = position[k]; xs[h + 1] = position[k + 1]; xs[h + 2] = position[k + 2];
      }
      xs[s0] = sx; xs[s0 + 1] = sy; xs[s0 + 2] = sz;
    }
    const {rows, cols, stride, position, target, lengthV, count} = panel;
    for (let k = 0; k < count * 3; k++) assert(Number.isFinite(position[k]), `${actor.kind}: non-finite cloth point`);
    for (let i = 0; i <= cols; i++) {
      const k = i * 3;
      accumulator.rootAttachment = Math.max(accumulator.rootAttachment,
        Math.hypot(position[k] - target[k], position[k + 1] - target[k + 1], position[k + 2] - target[k + 2]));
      // How far the sewn seam itself dips under the flagstones. A hem can never
      // be lifted above the belt it hangs from, so this bounds the next metric.
      accumulator.seamLowest = Math.min(accumulator.seamLowest, target[k + 1], target[(stride + i) * 3 + 1]);
    }
    for (let j = 0; j < rows; j++) for (let i = 0; i <= cols; i++) {
      const a = (j * stride + i) * 3, b = a + stride * 3;
      const rest = lengthV[j * stride + i] * worldScale;
      if (rest < 1e-5) continue;
      const length = Math.hypot(position[b] - position[a], position[b + 1] - position[a + 1], position[b + 2] - position[a + 2]);
      const extension = length / rest - 1;
      accumulator.maxStretch = Math.max(accumulator.maxStretch, extension);
      // The max alone is a constant: SEAM_LIMIT is the last constraint the
      // solver applies, so one particle in contact pins it to the ceiling and
      // the number stops carrying information. The distribution does not.
      accumulator.stretchSum += extension; accumulator.stretchCount++;
      const bin = Math.min(STRETCH_BINS - 1, Math.max(0, Math.round(extension * 1000)));
      accumulator.stretchBins[bin]++;
    }
    // Skip the sewn rows: they are welded to the armour and are meant to touch.
    for (let j = 2; j <= rows; j++) for (let i = 0; i <= cols; i++) {
      const k = (j * stride + i) * 3, x = position[k], y = position[k + 1], z = position[k + 2];
      let deepest = 0;
      for (const index of panel.collide) {
        const capsule = simulation.colliders[index];
        if (capsule.live) deepest = Math.max(deepest, capsuleDepth(x, y, z, capsule));
      }
      accumulator.bodyPenetration = Math.max(accumulator.bodyPenetration, deepest);
      // …and per panel, which is the difference between "the cloth is in the
      // body" and "the neck-cloth rests inside a collar capsule that is
      // deliberately bigger than the armour it stands in for". The player's
      // idle reads 27.5 mm here and 0 mm against the skinned mesh.
      if (deepest > 0) {
        const key = `${index}:${panel.mesh.name}`;
        const capsules = (accumulator.capsulePanels ??= {});
        capsules[key] = Math.max(capsules[key] || 0, deepest);
      }
      // Standoff from the body. A garment lives within a hand's breadth of the
      // armour it hangs on; a plank bolted to the back sits much further out.
      let nearest = Infinity;
      for (const i of panel.collide) { const c = simulation.colliders[i]; if (c.live) nearest = Math.min(nearest, capsuleGap(x, y, z, c)); }
      if (nearest < Infinity) {
        accumulator.gapSum += Math.max(0, nearest); accumulator.gapMax = Math.max(accumulator.gapMax, nearest);
        // The maximum over the WHOLE panel is not a defect signal: the hem of a
        // knee-length cape is legitimately most of a metre from the thigh
        // capsule that governs it, and mid-panel it can swing half a metre out
        // on a hard turn. Over the top QUARTER it is: that is the yoke, which
        // has to stay on the armour, so a panel breaking away shows up here.
        if (j * 4 <= rows) accumulator.gapUpperMax = Math.max(accumulator.gapUpperMax, nearest);
      }
      accumulator.samples++;
      if (deepest > .003 * worldScale) accumulator.touching++;
      if (y < FLOOR_Y) accumulator.floorPenetration = Math.max(accumulator.floorPenetration, FLOOR_Y - y);
      accumulator.lowest = Math.min(accumulator.lowest, y);
    }
  }
}

/** One scripted take. `drive(frame, actor)` moves the actor's root. */
async function run(actor, {clip, frames, drive, name, restarts = 0}) {
  actor.play(clip);
  const accumulator = {name, rootAttachment: 0, maxStretch: 0, bodyPenetration: 0, floorPenetration: 0, hemSpeed: 0, gapSum: 0, gapMax: 0, lowest: Infinity, seamLowest: Infinity, samples: 0, touching: 0,
    skinSamples: 0, skinInside: 0, skinDepth: 0, skinUnsure: 0, seamSkinSum: 0, seamSkinMax: 0, seamSkinSamples: 0, gapUpperMax: 0,
    stretchSum: 0, stretchCount: 0, stretchBins: new Int32Array(STRETCH_BINS)};
  const before = actor.cloth.clothSimulation.panels.reduce((sum, p) => sum + p.resets, 0);
  for (let frame = 0; frame < frames; frame++) {
    drive?.(frame, actor);
    actor.pose(1 / 60);
    updatePlayerCloth(actor.cloth, 1 / 60, frame / 60, {speed: actor.speed || 0});
    // A scripted clip restart snaps the whole skeleton in one frame; the fabric
    // following that is not jitter, so the hem is not sampled across the seam.
    if (frame > 6) measure(actor, accumulator, frame, !restarts || frame % restarts > 10);
    // The skinned mesh is expensive to evaluate, so it is sampled, not polled.
    if (frame > 120 && frame % SKIN_EVERY === 0) measureSkin(actor, accumulator);
  }
  accumulator.resets = actor.cloth.clothSimulation.panels.reduce((sum, p) => sum + p.resets, 0) - before;
  accumulator.lowestWorldY = accumulator.lowest === Infinity ? null : Number(accumulator.lowest.toFixed(4));
  accumulator.seamLowestWorldY = accumulator.seamLowest === Infinity ? null : Number(accumulator.seamLowest.toFixed(4));
  // A seam driven under the floor by the clip (a shoulder roll puts the belt on
  // the stones) is allowed to take its first rows with it; nothing more.
  accumulator.floorAllowance = Number(Math.max(0, FLOOR_Y - accumulator.seamLowest).toFixed(5));
  // How often anything was inside a capsule at all, not just the worst frame.
  accumulator.contactShare = Number((accumulator.touching / Math.max(1, accumulator.samples)).toFixed(5));
  accumulator.drapeGapMean = Number((accumulator.gapSum / Math.max(1, accumulator.samples)).toFixed(4));
  accumulator.drapeGapMax = Number(accumulator.gapMax.toFixed(4));
  accumulator.drapeGapUpperMax = Number(accumulator.gapUpperMax.toFixed(4));
  // Stretch as a distribution: mean and 95th percentile of the vertical seam
  // extension, alongside the max that pins to the limit.
  {
    const bins = accumulator.stretchBins, total = accumulator.stretchCount;
    let seen = 0, p95 = 0;
    for (let i = 0; i < bins.length; i++) { seen += bins[i]; if (seen >= total * .95) { p95 = i / 1000; break; } }
    accumulator.stretchP95 = Number(p95.toFixed(5));
    accumulator.stretchMean = Number((accumulator.stretchSum / Math.max(1, total)).toFixed(5));
    delete accumulator.stretchBins; delete accumulator.stretchSum; delete accumulator.stretchCount;
  }
  // Per panel, so a loose garment cannot hide behind a tight one in the pooled
  // figure: the boss's mantle averaged 56 mm off the armour while the pooled
  // number read 44 mm, because the cloak's own 35 mm averaged it down.
  accumulator.perPanel = Object.fromEntries(Object.entries(accumulator.panels || {}).map(([panelName, p]) => [panelName, {
    seamSkinMean: Number((p.seamSum / Math.max(1, p.seamSamples)).toFixed(4)),
    seamSkinMax: Number(p.seamMax.toFixed(4)),
    skinInsideShare: Number((p.inside / Math.max(1, p.samples)).toFixed(5)),
    skinDepth: Number(p.depth.toFixed(5)),
  }]));
  delete accumulator.panels;
  accumulator.bodyPenetrationByPanel = Object.fromEntries(
    Object.entries(accumulator.capsulePanels || {}).map(([panelName, d]) => [panelName, Number(d.toFixed(4))]));
  delete accumulator.capsulePanels;
  // Against the real skin, not the capsules.
  accumulator.skinInsideShare = Number((accumulator.skinInside / Math.max(1, accumulator.skinSamples)).toFixed(5));
  accumulator.skinUnsureShare = Number((accumulator.skinUnsure / Math.max(1, accumulator.skinSamples)).toFixed(5));
  accumulator.skinDepth = Number(accumulator.skinDepth.toFixed(5));
  accumulator.seamSkinMean = Number((accumulator.seamSkinSum / Math.max(1, accumulator.seamSkinSamples)).toFixed(4));
  accumulator.seamSkinMax = Number(accumulator.seamSkinMax.toFixed(4));
  delete accumulator.skinSamples; delete accumulator.skinInside; delete accumulator.skinUnsure;
  delete accumulator.seamSkinSum; delete accumulator.seamSkinSamples;
  delete accumulator.lowest; delete accumulator.seamLowest; delete accumulator.samples; delete accumulator.touching;
  delete accumulator.gapSum; delete accumulator.gapMax; delete accumulator.gapUpperMax; delete accumulator.hems;
  for (const key of ['rootAttachment', 'maxStretch', 'bodyPenetration', 'floorPenetration', 'hemSpeed'])
    accumulator[key] = Number(accumulator[key].toFixed(5));
  return accumulator;
}

// ---------------------------------------------------------------------------
// The SHAPE of the drape, and whether a paused frame shows it.
//
// Everything above measures where the cloth is relative to the body. None of it
// can tell a cape from a tabard: the boss's cloak passed every check in this
// file while settling to 0.739 m at the yoke and 0.764 m at the hem out of a
// 1.45 m cut — a constant-width slab with 6-19 mm of fold relief on a 3.25 m
// character. And the studio stills used to sign that off were scrubbed frames
// relaxed for 34 steps, which showed the hem up to 29 cm wider than the game
// ever draws it. Both are measured here.
// ---------------------------------------------------------------------------

function rowWidth(panel, j) {
  let min = Infinity, max = -Infinity;
  for (let i = 0; i <= panel.cols; i++) { const x = panel.position[(j * panel.stride + i) * 3]; min = Math.min(min, x); max = Math.max(max, x); }
  return max - min;
}

/** Fold relief: the rms of z(x) about a least-squares quadratic, per row, which
 *  subtracts the curve that lays the sheet on the back and leaves the folds. */
function foldRelief(panel, j) {
  const xs = [], zs = [];
  for (let i = 0; i <= panel.cols; i++) { const k = (j * panel.stride + i) * 3; xs.push(panel.position[k]); zs.push(panel.position[k + 2]); }
  const n = xs.length, sum = f => xs.reduce((s, x, i) => s + f(x, zs[i]), 0);
  const m = [[n, sum(x => x), sum(x => x * x)], [sum(x => x), sum(x => x * x), sum(x => x ** 3)], [sum(x => x * x), sum(x => x ** 3), sum(x => x ** 4)]];
  const rhs = [sum((x, z) => z), sum((x, z) => x * z), sum((x, z) => x * x * z)];
  const a = m.map((row, i) => row.concat(rhs[i]));
  for (let c = 0; c < 3; c++) {
    let p = c; for (let r = c + 1; r < 3; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    if (Math.abs(a[p][c]) < 1e-12) return 0;
    [a[c], a[p]] = [a[p], a[c]];
    for (let r = 0; r < 3; r++) { if (r === c) continue; const f = a[r][c] / a[c][c]; for (let k = c; k < 4; k++) a[r][k] -= f * a[c][k]; }
  }
  const coef = [a[0][3] / a[0][0], a[1][3] / a[1][1], a[2][3] / a[2][2]];
  let squared = 0;
  for (let i = 0; i < n; i++) squared += (zs[i] - (coef[0] + coef[1] * xs[i] + coef[2] * xs[i] * xs[i])) ** 2;
  return Math.sqrt(squared / n);
}

async function measureDrape(actor) {
  actor.root.position.set(0, 0, 0); actor.root.rotation.set(0, 0, 0);
  actor.play('idle');
  for (let frame = 0; frame < 420; frame++) { actor.pose(1 / 60); updatePlayerCloth(actor.cloth, 1 / 60, frame / 60, {speed: 0}); }
  const live = actor.cloth.clothSimulation.panels.map(panel => {
    let relief = 0;
    for (let j = Math.ceil(panel.rows / 2); j <= panel.rows; j++) relief = Math.max(relief, foldRelief(panel, j));
    return {name: panel.mesh.name, yoke: rowWidth(panel, 0), hem: rowWidth(panel, panel.rows), foldRelief: relief};
  });
  // …and the same pose judged the way the studio judges it: re-seated to the cut
  // shape, then relaxed by the dt = 0 path alone.
  for (const panel of actor.cloth.clothSimulation.panels) panel.initialized = false;
  updatePlayerCloth(actor.cloth, 0, 9, {speed: 0});
  return live.map((row, index) => {
    const panel = actor.cloth.clothSimulation.panels[index];
    return {
      ...row,
      yoke: Number(row.yoke.toFixed(4)), hem: Number(row.hem.toFixed(4)), foldRelief: Number(row.foldRelief.toFixed(4)),
      settledHem: Number(rowWidth(panel, panel.rows).toFixed(4)),
      settleSteps: actor.cloth.clothSimulation.settleSteps,
    };
  });
}

const report = {generated: new Date().toISOString(), actors: {}};
for (const kind of ['player', 'boss']) {
  const actor = await makeActor(kind);
  actor.skin = skinSampler(actor);
  const isBoss = kind === 'boss';
  const takes = [];
  // 1. Standing guard: the fabric must settle without creeping or buzzing.
  takes.push(await run(actor, {name: 'idle', clip: 'idle', frames: 420}));
  // 2. A steady run with turns: inertia, but the panels must still hang.
  actor.speed = isBoss ? 2.2 : 4.6;
  takes.push(await run(actor, {
    name: 'run', clip: isBoss ? 'walk-forward' : 'run-forward', frames: 480,
    drive(frame, a) {
      const t = frame / 60, yaw = Math.sin(t * 1.9) * .9;
      a.root.rotation.y = yaw;
      a.root.position.x += Math.sin(yaw) * (a.speed / 60);
      a.root.position.z += Math.cos(yaw) * (a.speed / 60);
    },
  }));
  // 3. Repeated rolls / lunges: the worst case for stretch and body contact.
  actor.speed = isBoss ? 3 : 6;
  takes.push(await run(actor, {
    name: isBoss ? 'sweep' : 'roll', clip: isBoss ? 'sweep' : 'dodge', frames: 480, restarts: 120,
    drive(frame, a) {
      const phase = frame % 120;
      if (phase === 0) a.action.reset().play();
      const travel = phase < 40 ? a.speed / 60 : 0;
      a.root.position.z -= travel;
      a.root.rotation.y = Math.sin(frame / 60 * 3.1) * .5;
    },
  }));
  // 4. Teleport: the reset must fire, and nothing may explode afterwards.
  const teleport = await run(actor, {
    name: 'teleport', clip: 'idle', frames: 240,
    drive(frame, a) { if (frame === 60) a.root.position.set(6, 0, -11); if (frame === 150) a.root.position.set(-4, 0, 9); },
  });
  takes.push(teleport);
  const drape = await measureDrape(actor);
  const simulation = actor.cloth.clothSimulation;
  const particles = simulation.panels.reduce((sum, p) => sum + p.count, 0);
  report.actors[kind] = {
    worldScale: actor.scale, panels: simulation.panels.length, particles,
    sockets: actor.cloth.userData.bindings.map(b => `${b.node.name} → ${b.bone}`),
    ...(() => { const t = simulation.timings.slice().sort((a, b) => a - b), at = f => Number(t[Math.floor((t.length - 1) * f)].toFixed(4));
      return {medianStepMs: at(.5), p95StepMs: at(.95), worstStepMs: at(1)}; })(),
    steps: simulation.steps,
    drape,
    takes,
  };
  // --- the contract the game has to keep ---
  for (const take of takes) {
    assert(take.rootAttachment < 1e-4, `${kind}/${take.name}: cloth root drifted off the socket (${take.rootAttachment} m)`);
    assert(take.maxStretch < .105, `${kind}/${take.name}: cloth stretched ${(take.maxStretch * 100).toFixed(1)}%`);
    assert(take.floorPenetration <= take.floorAllowance + .002, `${kind}/${take.name}: hem tunnelled the floor by ${take.floorPenetration} m (seam allowance ${take.floorAllowance} m)`);
    // Capsules are deliberately a little larger than the mesh (sx widens them
    // across the body), so a few centimetres inside one during a scripted roll
    // is still outside the armour; what matters is that it is rare and bounded.
    assert(take.bodyPenetration < .04 * actor.scale, `${kind}/${take.name}: cloth sank ${take.bodyPenetration} m into the body`);
    assert(take.contactShare < .03, `${kind}/${take.name}: ${(take.contactShare * 100).toFixed(1)}% of the cloth sits inside the body`);
    if (take.name !== 'teleport') assert(take.resets === 0, `${kind}/${take.name}: ${take.resets} discontinuity resets during normal motion`);
    // The energy pump: the one-sided seam sweep used to feed its own corrections
    // back as velocity, and a standing idle orbited the hem at over a metre a
    // second. Damped (CONSTRAINT_KEEP), a standing idle stays around 0.3 m/s.
    // Asserted where a bound is meaningful: standing still, and running with
    // turns. A scripted shoulder roll whips the pelvis through a full rotation
    // in half a second, so its hem speed is reported, not bounded.
    const calm = {idle: .55, run: 3.2}[take.name];
    if (calm) assert(take.hemSpeed < calm * actor.scale, `${kind}/${take.name}: the hem moves at ${take.hemSpeed.toFixed(2)} m/s relative to its seam`);
    // A garment hangs near the body it is sewn to. Well over a hand's breadth of
    // average standoff means a board held off the back, not cloth.
    assert(take.drapeGapMean < .13 * actor.scale, `${kind}/${take.name}: the cloth averages ${take.drapeGapMean} m off the body`);
    // `drapeGapMax` over the whole panel is reported, not bounded (a cape hem is
    // far from the thigh by design, and mid-panel it swings out on a turn). Over
    // the top quarter it IS a defect signal: a panel breaking away shows there.
    assert(take.drapeGapUpperMax < .20 * actor.scale, `${kind}/${take.name}: a panel's upper half stands ${take.drapeGapUpperMax} m off the body`);
    // --- against the real skinned mesh, which is what the capsules cannot see ---
    // A garment hangs ON the armour it is sewn to. 2-3 cm of mean standoff at the
    // sewn rows is cloth thickness and padding; 5 cm is a cut edge in mid air with
    // daylight above it, which is exactly how the waist tassets used to read.
    assert(take.seamSkinMean < .05 * actor.scale, `${kind}/${take.name}: the sewn rows average ${(take.seamSkinMean * 1000).toFixed(0)} mm off the skinned armour`);
    assert(take.seamSkinMax < .09 * actor.scale, `${kind}/${take.name}: a sewn row corner is ${(take.seamSkinMax * 1000).toFixed(0)} mm off the skinned armour`);
    // Pooled, the loosest garment hides behind the tightest: the mantle averaged
    // 56 mm off the armour while the pooled figure read 44 mm. Per panel.
    for (const [panelName, panel] of Object.entries(take.perPanel))
      assert(panel.seamSkinMean < .042 * actor.scale,
        `${kind}/${take.name}/${panelName}: this panel's sewn row averages ${(panel.seamSkinMean * 1000).toFixed(0)} mm off the skinned armour`);
    // Stretch: the max pins to SEAM_LIMIT whenever anything is in contact, so
    // the bound that can actually detect a regression is on the distribution.
    const stretchBound = {idle: .03, run: .06, teleport: .05}[take.name];
    if (stretchBound) assert(take.stretchP95 < stretchBound,
      `${kind}/${take.name}: 5% of the vertical seams are stretched past ${(take.stretchP95 * 100).toFixed(1)}%`);
    // Standing still, no part of any garment may be inside the character. This is
    // the check that would have failed the boss cape whose belt fringe drew
    // through it while `bodyPenetration` read 0.0 mm against the capsules.
    if (take.name === 'idle') {
      assert(take.skinInsideShare < .02, `${kind}/idle: ${(take.skinInsideShare * 100).toFixed(1)}% of the cloth is inside the skinned mesh`);
      assert(take.skinDepth < .03 * actor.scale, `${kind}/idle: the cloth is ${(take.skinDepth * 1000).toFixed(0)} mm inside the skinned mesh`);
    }
    // A scripted roll or scythe sweep drives a limb straight through the sheet in
    // one frame, so the action takes are bounded loosely and reported in full.
    assert(take.skinInsideShare < .10, `${kind}/${take.name}: ${(take.skinInsideShare * 100).toFixed(1)}% of the cloth is inside the skinned mesh`);
  }
  // --- the shape of the drape, and the studio's view of it ---
  for (const panel of drape) {
    // A paused review frame must show the drape the game shows. It used to show
    // a cape caught mid-fall, and every still signing off the cape's silhouette
    // was therefore measuring something the player never sees.
    assert(Math.abs(panel.settledHem - panel.hem) < .045 * actor.scale,
      `${kind}/${panel.name}: a paused frame settles to a ${panel.settledHem} m hem where the running game hangs at ${panel.hem} m`);
  }
  if (isBoss) {
    const cloak = drape.find(p => p.name === 'boss-torn-cloak');
    assert(cloak, 'the boss cloak panel is missing from the drape report');
    // A cape, not a tabard: it is clasped across the pauldrons (measured 1.089 m
    // apart) and it opens as it falls.
    assert(cloak.yoke > .77 * actor.scale, `boss cloak: the yoke is only ${cloak.yoke} m across the shoulders`);
    assert(cloak.hem > cloak.yoke * 1.12, `boss cloak: the hem (${cloak.hem} m) is not wider than the yoke (${cloak.yoke} m) — it reads as a slab`);
    // …and it has folds deep enough to shade. 6-19 mm of relief on a 3.25 m
    // character is sub-pixel at fighting distance; this is the number that was
    // wrong when the cape rendered as one flat dark shape.
    assert(cloak.foldRelief > .022 * actor.scale, `boss cloak: fold relief is only ${(cloak.foldRelief * 1000).toFixed(0)} mm`);
  }
  assert(teleport.resets >= simulation.panels.length, `${kind}: the teleport did not trigger a discontinuity reset`);
  // p95 and worst include this process's garbage collections; the median is the
  // honest per-step cost of the solver itself. The bound is loose because this
  // machine may be running other captures; 0.71 / 0.34 ms is the quiet-machine
  // reading, and a regression that matters would be several times that.
  assert(report.actors[kind].medianStepMs < 3, `${kind}: the 60 Hz cloth step costs ${report.actors[kind].medianStepMs} ms`);
}

const out = argument('--json', 'docs/cloth-simulation-audit.json');
writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
for (const [kind, data] of Object.entries(report.actors)) {
  console.log(`\n${kind}: ${data.panels} panels, ${data.particles} particles, ${data.sockets.join(', ')}`);
  console.log(`  cloth step: median ${data.medianStepMs.toFixed(3)} ms · p95 ${data.p95StepMs.toFixed(3)} ms · worst ${data.worstStepMs.toFixed(3)} ms over ${data.steps} steps`);
  for (const panel of data.drape)
    console.log(`  drape ${panel.name.padEnd(24)} yoke ${panel.yoke.toFixed(3)} m → hem ${panel.hem.toFixed(3)} m · folds ${(panel.foldRelief * 1000).toFixed(0)} mm rms · paused-frame hem ${panel.settledHem.toFixed(3)} m after ${panel.settleSteps} steps`);
  for (const take of data.takes)
    console.log(`  ${take.name.padEnd(9)} root ${take.rootAttachment.toExponential(1)} m · stretch ${(take.maxStretch * 100).toFixed(1)}%/p95 ${(take.stretchP95 * 100).toFixed(1)}% · body ${(take.bodyPenetration * 1000).toFixed(1)} mm · floor ${(take.floorPenetration * 1000).toFixed(1)}/${(take.floorAllowance * 1000).toFixed(1)} mm · hem ${take.hemSpeed.toFixed(2)} m/s rel · gap ${(take.drapeGapMean * 100).toFixed(1)}/${(take.drapeGapUpperMax * 100).toFixed(1)}/${(take.drapeGapMax * 100).toFixed(1)} cm · skin ${(take.skinInsideShare * 100).toFixed(2)}%/${(take.skinDepth * 1000).toFixed(0)} mm · seam ${(take.seamSkinMean * 1000).toFixed(0)}/${(take.seamSkinMax * 1000).toFixed(0)} mm · resets ${take.resets} · in contact ${(take.contactShare * 100).toFixed(2)}%`);
}
console.log(`\nwrote ${out}`);
