import * as THREE from 'three';
import {buildPanel, fabricMaterial} from './player-cloth.js';

// Armored Death's cloak. A wide, heavy, torn wool cape hung from the mantle
// across his shoulder blades — not the player's waist strips with a new colour.
//
// Every constant below is metres on the 2.5 m authored mesh, measured with
// scripts/measure-cloth-anchors.mjs:
//   Spine2 bone            (0.001, 1.965, -0.071)
//   mantle rear surface    z(x) = -0.331 + 1.05 x²  at y ≈ 2.11, out to x = ±0.33
//   hips / thighs          hips y 1.52, thigh axis (±0.145, 1.45) → (±0.145, 0.83)
//   torso rear surface     z = -0.26 @ y 1.5 · -0.28 @ y 1.75 · -0.33 @ y 2.10
// The cape is pinned to that arc, so its top edge lies on the armour instead of
// hovering behind it, and it swings from the spine rather than from the pelvis.

const BOSS_REFERENCE = 2.5;
const SOCKET = [0, 2.108, -.285];          // the mantle arc's centre
// Half the seam width across the back. The cape is clasped across the PAULDRONS,
// not between the shoulder blades: measured in the cloak socket's own frame at a
// settled idle, the armour reaches x = ±.42 at seam height (world 1.089 m across,
// y 2.60-2.80), and a .30 yoke covered 70 % of that — from behind it read as a
// tabard hung on his back rather than a cape over his shoulders.
const HALF_SPAN = .420;
const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Rear surface of the armour on the spine, measured off the skinned rest pose
// (min z per 4 cm column, authored metres):
//   y 2.10 -.331 · 2.05 -.327 · 1.95 -.313 · 1.85 -.244 · 1.75 -.215 · 1.65 -.220
//   y 1.55 -.253 · 1.45 -.273 · 1.35 -.279
// The back is DEEPEST at the shoulder blades, tucks in at the waist and flares
// out again at the fauld. A cape bridges that tuck — it hangs from the shoulders
// and clears the belt. The previous cut instead walked a +9.2 cm `hug` forward
// into the waist, which put the cape at z ≈ -.21 where the fauld's ornate silver
// fringe sits at -.273: 10.2 % of the free particles ended up INSIDE the body and
// the belt drew straight across the middle of the cape on screen.

/** Rear surface of the shoulder mantle, relative to the cape socket. The yoke's
 *  top edge is not a ruled line: it rides up over each shoulder blade and dips
 *  between them, so the cape does not read as a rectangle cut straight across. */
function seam(u) {
  const x = (u - .5) * 2 * HALF_SPAN;
  const a = Math.abs(x) / HALF_SPAN;
  const shoulder = .034 * smoothstep(.30, .95, a) - .022 * (1 - smoothstep(0, .42, a));
  // Measured rear surface in this frame, min z per 4 cm column at the seam row:
  //   x 0 -.046 · .12 -.004 · .20 .044 · .28 .064 · .32 .081 · .40 .123-.162
  //   · .44 .156-.175.  The quadratic follows it to x ≈ .32 and then falls
  //   behind the pauldron, so the last hand's breadth gets its own term: past
  //   the shoulder blades the armour turns forward much faster than x².
  return {
    x,
    y: -.20 * x * x - .002 + shoulder,
    z: -.046 + 1.05 * x * x + .40 * Math.max(0, Math.abs(x) - .30) ** 1.5,
  };
}

/** A torn hem. Four tears at irregular spacings and very different depths, one
 *  surviving tongue between two of them, and a fine unravelled fringe along the
 *  whole edge. Cut as evenly spaced nibbles of one depth (which is what the
 *  previous four-point zig-zag was) it reads as a decorative pinked edge. */
function hemFactor(u) {
  let f = 1 - .040 * Math.max(0, Math.sin(u * Math.PI * 13.3 + .7)) ** 2
            - .028 * Math.max(0, Math.sin(u * Math.PI * 20.1 + 2.9)) ** 2;
  f -= .30 * Math.exp(-(((u - .17) / .090) ** 2));
  f -= .15 * Math.exp(-(((u - .43) / .062) ** 2));
  f -= .40 * Math.exp(-(((u - .71) / .105) ** 2));
  f -= .11 * Math.exp(-(((u - .94) / .070) ** 2));
  f += .07 * Math.exp(-(((u - .58) / .065) ** 2));
  return f;
}

/** Ragged vertical edges — the cape has lost its selvedge down both sides. */
function edgeWear(u, v) {
  const toEdge = Math.min(u, 1 - u);
  if (toEdge > .17) return 0;
  // Different phase and reach on each side: cut symmetrically, both vertical
  // edges came out as ruled lines with the same nibbles mirrored down them.
  const right = u > .5;
  const bite = right
    ? (.070 * Math.sin(v * 9.7 + 2.6) + .045 * Math.sin(v * 23.1 + 1.1)) ** 2
    : (.055 * Math.sin(v * 14.3 + 1.2) + .040 * Math.sin(v * 31.7)) ** 2;
  return (1 - toEdge / .17) * bite * smoothstep(.18, .8, v) * (right ? 16 : 14);
}

export function createBossCloth(height = BOSS_REFERENCE) {
  const k = height / BOSS_REFERENCE;
  const root = new THREE.Group(); root.name = 'boss-code-cloth';
  const mantle = new THREE.Group(); mantle.name = 'cloak-shoulder-socket';
  mantle.position.set(SOCKET[0] * k, SOCKET[1] * k, SOCKET[2] * k);
  root.add(mantle);

  // Soot-stained, felted wool: near black, with the weave and a trace of sheen
  // to keep it from collapsing into one silhouette shape in the candle light.
  // (An earlier round read 0x232a2f as "crushed" and answered with base value
  // and sheen — measured in the studio. See the integration note below: in the
  // cathedral that answer was the defect, and the relief has to come from the
  // baked crease tint and the normal, not from lifting the albedo.)
  // The twill repeat is a real length, not a taste: at repeat [2.2, 4.2] one tile
  // covered 35 cm of a 0.8 m cape and the 9-pixel diagonal came out as 5 cm
  // chevrons — a printed herringbone pattern, not cloth. [6.5, 11] on an 8-pixel
  // twill puts the diagonal at 12 mm, which reads as weave at fighting distance.
  // The chevron itself was never the twill: it was the tile-scale wrinkle term
  // in `weaveHeight`, which is gone (see the rule at the top of that function).
  // With the motif out of the map the thread can afford to be deeper — the folds
  // are geometry here, and a near-black cape needs every bit of relief it has.
  // Integration fix (16 Sep, round 3): 0x272d33 / sheen .3 was judged under the
  // STUDIO's neutral key, where it measured 35.6 against 69.5 of armour. Under
  // stream A's cathedral grade (AGX_GAIN 2.55, a cold ambient the cape's whole
  // rear surface sees) the SAME numbers invert: the cape measured 35.3 mean over
  // the shoulder-blade region against 37.9 for the armour beside it, with a p95
  // of 46 against 93 — a flat pale membrane over the best-looking asset in the
  // game. Measured in the game, at the same camera, one dial at a time:
  //   sheen .3 -> 0                                cape 35.3 -> 33.5
  //   colour 0x272d33 -> 0x14181c, roughness 1     cape 33.5 -> 26.1
  // so the base value carried it, not the sheen; both are dialled here and the
  // cut (pauldron clasp, flare, torn hem) is untouched. The weave repeat goes up
  // 1.38x because the tile read as knitting at the lock-on distance — the twill
  // diagonal drops from ~12 mm to ~8.7 mm — with the normal softened to match so
  // the sheet does not go rubber-smooth (repeat x2 / normalScale .45 did).
  const wool = fabricMaterial(0x15191d, {
    twill: 8, weave: .42, wrinkle: .9, seed: 5.1, repeat: [9, 15],
    roughness: 1, sheen: .10, sheenColour: 0x5a5347, sheenRoughness: .96, normalScale: .78,
  });
  // The mantle is the same bolt of cloth, only dirtier and a shade warmer from
  // the tallow it has soaked up: a contrasting brown lining read as a patch
  // glued between the shoulder blades.
  const lining = fabricMaterial(0x181a16, {
    twill: 8, weave: .40, wrinkle: .85, seed: 9.4, repeat: [7.5, 7],
    roughness: .99, sheen: .08, sheenColour: 0x514a3c, sheenRoughness: .95, normalScale: .78,
  });
  const panels = [];

  // --- the cloak ----------------------------------------------------------
  // The yoke is sewn to the mantle arc and the sheet then hangs: the shoulder
  // capsules carry it, so every shift of his weight moves it, and it bridges the
  // waist tuck the way a heavy cape does instead of being pulled into the belt.
  const LENGTH = 1.32;
  panels.push(buildPanel({
    name: 'boss-torn-cloak', rows: 22, cols: 16, material: wool, socket: mantle, seed: 1.3, drag: 1.45, stiffness: 1.05,
    bend: .78, holdTo: .78, gather: .93, span: .80,
    collide: [0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    shape(u, v) {
      const top = seam(u);
      // 0.84 m at the yoke (pauldron to pauldron) to 1.22 m at the hem. The
      // previous 1.85x flare was bigger on paper and arrived on screen as +3 %:
      // the compression floor it was meant to survive was measured on the 3D
      // seam length, which a torn hem satisfies with its tears. Now that the
      // floor is planar (player-cloth.js `lengthHP`) a modest cut flare is the
      // one that actually reaches the eye.
      const flare = 1 + .62 * v ** 1.15;
      const curve = 1 - .62 * smoothstep(0, .40, v);
      // The sides leave the pauldrons as they fall. Without this the cape's top
      // corners follow the seam's shoulder wrap straight down and end up inside
      // the plate: measured in the socket frame, the armour's rear surface at
      // |x| = .44 sits at z .164-.187 over the 25 cm below the seam, and the
      // corner columns were at .194.
      const flank = -.075 * (Math.abs(top.x) / HALF_SPAN) ** 2.5 * smoothstep(.02, .30, v);
      // Hangs from the shoulder blades and bridges the waist tuck: nowhere does
      // the cut come within 2 cm of the measured rear surface (see the table at
      // the top of the file). The hem drifts back as the cloth swings clear.
      const hug = .012 * smoothstep(.02, .30, v) - .052 * smoothstep(.34, 1, v);
      // Gathers under the seam. Two waves that deepen and broaden as the cloth
      // falls, plus a slow third that varies the cross-section down the drop —
      // every row used to have the same 2.8 cm depth, the signature of an
      // extruded surface rather than a hanging sheet.
      const deepen = smoothstep(.02, .55, v) * (.30 + .70 * v);
      const fold = (Math.cos(u * Math.PI * 3.4 + 1.1) * .040 + Math.cos(u * Math.PI * 6 + 2.6) * .017) * deepen
        + Math.cos(u * Math.PI * 1.6 - .5) * .030 * smoothstep(.25, 1, v) * v;
      const drop = v * LENGTH * hemFactor(u) + edgeWear(u, v);
      return {
        x: (top.x * flare - fold * .26) * k,
        y: (top.y - drop) * k,
        z: (top.z * curve + hug + flank + fold) * k,
      };
    },
    tint(u, v) {
      // Baked fold occlusion, following the SAME waves the cut folds with (3.4,
      // 6 and 1.6 cycles) so the shading sits in the creases instead of across
      // them, and deep enough to read on a near-black cape lit from one side.
      const wave = Math.cos(u * Math.PI * 3.4 + 1.1) * .62 + Math.cos(u * Math.PI * 6 + 2.6) * .20
        + Math.cos(u * Math.PI * 1.6 - .5) * .38 * smoothstep(.25, 1, v);
      // Centred on 1.0, not below it: the first attempt at a deeper crease
      // dropped the mean value with it and the cape went featureless black.
      // Widened with the value drop: a darker cape has less room above it, so the
      // creases have to take their contrast downward. .80..1.18 -> .70..1.24.
      const crease = .70 + .54 * (.5 + .5 * wave);
      const damp = 1 - .30 * v ** 3 - .05 * Math.max(0, Math.sin(u * 11.7 + 2.1));
      const shoulder = 1 + .10 * (1 - smoothstep(0, .22, v));
      const d = crease * damp * shoulder;
      return [d, d * .985, d * .96];
    },
  }));

  // --- short mantle over the seam, so the cloak reads as layered ----------
  panels.push(buildPanel({
    name: 'boss-cloak-mantle', rows: 7, cols: 10, material: lining, socket: mantle, seed: 3.9, drag: 1.7, stiffness: 1.5, holdTo: 1, bend: .86,
    collide: [1, 2, 9, 10, 11, 12],
    // Narrower than the cloak and cut with a cowl's sloping shoulder line. Cut
    // square and 4 % WIDER it read from behind as a straight-topped rectangle
    // pasted across his shoulder blades.
    shape(u, v) {
      const across = (u - .5) * 2;                  // -1 at one shoulder, +1 at the other
      const top = seam(.5 + across * .5 * .90);
      const flare = 1 + .22 * v;
      const shoulder = .055 * across * across;      // the collar falls away at the sides
      const scallop = 1 - .18 * Math.max(0, Math.sin(u * Math.PI * 4.6 + 2.4)) ** 2
        - .22 * across * across * across * across;  // and the points stop short of the arms
      return {
        x: (top.x * flare) * k,
        y: (top.y + .012 - shoulder - v * .30 * scallop) * k,
        // Sewn TIGHT and layered LOOSE. Held 2.2 cm off the cloak all the way
        // up, its own sewn row measured 53 mm off the armour — the loosest
        // attachment in the project, and the pooled figure hid it behind the
        // cloak's 30 mm. It now starts 8 mm proud of the cloak and opens to
        // 50 mm as it falls, which is both a tighter collar and a real
        // centimetre of standing separation where the two sheets overlap (they
        // used to close to 2.3 mm, with nothing keeping the two DoubleSide
        // sheets in order).
        z: (top.z * (1 - .30 * v) - (.008 + .042 * v) + Math.cos(u * Math.PI * 3.4) * .016 * v) * k,
      };
    },
    // …and it ENDS somewhere. Without a value break at the hem the mantle had no
    // edge against the cloak underneath and read as a mottled smear across the
    // shoulder blades instead of a layer.
    tint(u, v) {
      const d = (.70 + .32 * (.5 + .5 * Math.cos(u * Math.PI * 3.4))) * (1 - .10 * v)
        * (1 - .30 * smoothstep(.72, .97, v)) * (1 + .12 * smoothstep(.55, .78, v));
      return [d, d * .97, d * .93];
    },
  }));

  for (const panel of panels) root.add(panel.mesh);
  root.userData = {
    bindings: [{node: mantle, bone: 'mixamorigSpine2'}],
    boneTargets: ['cloak-shoulder-socket'],
    bakedIntoBody: false, clothModel: 'world-space particle grid, capsule body collision',
  };
  root.clothSimulation = {
    panels, height, accumulator: 0, lastTime: -1, profile: false,
    resetDistance: .9 * BOSS_REFERENCE,
    // Bone-driven body capsules; `radius` is the measured bone-to-rear-surface
    // depth, `sx` widens each one across the (much broader) body.
    colliders: [
      {from: 'mixamorigHips', to: 'mixamorigSpine1', radius: .200 * k, sx: 1.5, extend: [.20 * k, 0]},
      {from: 'mixamorigSpine1', to: 'mixamorigSpine2', radius: .243 * k, sx: 1.45},
      {from: 'mixamorigSpine2', to: 'mixamorigNeck', radius: .262 * k, sx: 1.35},
      {from: 'mixamorigNeck', to: 'mixamorigHead', radius: .150 * k, sx: 1.3, extend: [0, .09 * k]},
      {from: 'mixamorigLeftUpLeg', to: 'mixamorigLeftLeg', radius: .155 * k, sx: 1.5, extend: [-.16 * k, 0]},
      {from: 'mixamorigRightUpLeg', to: 'mixamorigRightLeg', radius: .155 * k, sx: 1.5, extend: [-.16 * k, 0]},
      {from: 'mixamorigLeftLeg', to: 'mixamorigLeftFoot', radius: .168 * k, sx: 1.3},
      {from: 'mixamorigRightLeg', to: 'mixamorigRightFoot', radius: .168 * k, sx: 1.3},
      // 8: the fauld. The armoured skirt and its silver fringe stand 25 cm
      // behind the hip bone — 5 cm further than the thin torso capsule above —
      // and the fringe is exactly what used to draw through the middle of the
      // cape. A short segment so it does not inflate the waist above it.
      {from: 'mixamorigHips', to: 'mixamorigSpine', radius: .262 * k, sx: 1.30, extend: [.20 * k, -.145 * k]},
      // 9, 10: the pauldrons. The cape is now clasped across them rather than
      // between the shoulder blades, so the plates have to carry it — without
      // them the corner columns followed the seam's wrap straight down INSIDE
      // the shell (53 mm deep, measured against the skinned mesh at idle) and
      // the cut alone could not describe the way the plate flares outward.
      {from: 'mixamorigLeftShoulder', to: 'mixamorigLeftArm', radius: .165 * k, sx: 1, extend: [0, .05 * k]},
      {from: 'mixamorigRightShoulder', to: 'mixamorigRightArm', radius: .165 * k, sx: 1, extend: [0, .05 * k]},
      // 11, 12: the upper arms. A cape clasped over the pauldrons hangs BEHIND
      // the arms, and without them the top corners hung straight through the
      // vambrace instead (40 mm inside the skinned mesh at a standing idle).
      {from: 'mixamorigLeftArm', to: 'mixamorigLeftForeArm', radius: .125 * k, sx: 1, extend: [.04 * k, 0]},
      {from: 'mixamorigRightArm', to: 'mixamorigRightForeArm', radius: .125 * k, sx: 1, extend: [.04 * k, 0]},
    ],
  };
  return root;
}
