import * as THREE from 'three';

// Detachable garments, simulated as real cloth sheets rather than flat cards.
//
// Every panel is a grid of particles integrated in WORLD space, so turning and
// running pull the fabric's weight around naturally. Only the two top rows are
// pinned; they are driven by a socket whose transform comes straight from a
// skeleton bone, and whose rest positions were measured off the skinned mesh
// (scripts/measure-cloth-anchors.mjs) so the roots sit ON the belt/armour edge
// instead of floating in front of it.
//
// The solver is Verlet + distance constraints + capsule body collision. The
// capsules are fitted to the same measured mesh, which is what keeps the cloth
// outside the thighs and back during a run or a roll.

const clamp = THREE.MathUtils.clamp;
const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const _v = new THREE.Vector3(), _p = new THREE.Vector3();
const _matrix = new THREE.Matrix4();

// ---------------------------------------------------------------------------
// Fabric. A woven height field drives colour, a real tangent-space normal map
// and a roughness break-up, so the cloth catches the cathedral's candle light
// with a crisp weave instead of reading as a painted plane.
// ---------------------------------------------------------------------------

const fabricCache = new Map();

const TAU = Math.PI * 2;

// THE RULE FOR THIS FUNCTION: nothing here may have a period longer than a few
// threads, and everything here must be a whole number of cycles across the tile.
//
// The map repeats 2-11 times across a garment. A term at the tile's own scale is
// therefore not a wrinkle, it is a MOTIF, printed over and over at a fixed
// spacing: the old `wrinkle * .17 * sin(u*PI*3 + …)` was the largest term in the
// height field and tiled both characters with a regular nested chevron — about
// 8 cm across on the cape, unmistakable diagonal banding down the player's
// tassets. Slack wrinkles are GEOMETRY here (the cut folds, the buckling the
// solver does and the baked crease tint); the texture carries thread and fibre
// and nothing else. `twill` must divide `size`, or the over/under does not wrap
// and the tile edge draws a grid of its own.
function weaveHeight(x, y, size, {twill = 4, wrinkle = 1, seed = 0, weave = 1}) {
  const u = x / size, v = y / size;
  // Over/under twill: the diagonal offset is what makes it read as woven wool.
  const warp = Math.sin(TAU * x / twill);
  const weft = Math.sin(TAU * y / twill);
  const diagonal = ((x + y) % (twill * 2)) < twill ? 1 : -1;
  // `weave` scales the over/under relief. At full strength on a coarse twill the
  // diagonal reads as machine knitwear rather than as felted wool, so heavy cloth
  // turns it down and lets the fibre noise below carry the surface.
  let h = .5 + .28 * weave * diagonal * (warp * .5 + weft * .5);
  // Slubs: the yarn wanders and thickens along its length. Phase-modulated so
  // the threads do not line up into a lattice, every frequency a whole number of
  // cycles per tile so the map still wraps seamlessly.
  h += .07 * Math.sin(TAU * (11 * u + .20 * Math.sin(TAU * (7 * v + seed))) + seed * 2.1);
  h += .05 * Math.sin(TAU * (17 * v + .16 * Math.sin(TAU * (13 * u + seed * .7))) + seed * 1.3);
  // Broken fibres, at the limit of what the 128-pixel tile can carry.
  h += wrinkle * .06 * Math.sin(TAU * (23 * u + 6 * v) + seed) * Math.sin(TAU * (19 * v - 4 * u) + seed * 2);
  h += wrinkle * .035 * Math.sin(TAU * (31 * u - 13 * v) + seed * 3.7);
  return h;
}

export function fabricMaterial(colour, options = {}) {
  const key = colour + '|' + JSON.stringify(options);
  if (fabricCache.has(key)) return fabricCache.get(key);
  const {
    twill = 4, wrinkle = 1, seed = 0, weave = 1, repeat = [3, 9],
    roughness = .93, sheen = .26, sheenColour = 0x8a8b83, sheenRoughness = .88,
    normalScale = .85, size = 128,
  } = options;
  const albedo = new Uint8Array(size * size * 4);
  const normal = new Uint8Array(size * size * 4);
  const rough = new Uint8Array(size * size * 4);
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++)
    height[y * size + x] = weaveHeight(x, y, size, {twill, wrinkle, seed, weave});
  const at = (x, y) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4, h = height[y * size + x];
    // Threads in shadow read darker; the map stays low contrast so the cloth
    // keeps its dyed colour instead of turning into a checkerboard.
    const shade = clamp(210 + (h - .5) * 78, 0, 255);
    albedo[i] = shade; albedo[i + 1] = shade; albedo[i + 2] = shade; albedo[i + 3] = 255;
    const dx = (at(x + 1, y) - at(x - 1, y)) * 3.2, dy = (at(x, y + 1) - at(x, y - 1)) * 3.2;
    const length = Math.hypot(dx, dy, 1);
    normal[i] = clamp((-dx / length * .5 + .5) * 255, 0, 255);
    normal[i + 1] = clamp((dy / length * .5 + .5) * 255, 0, 255);
    normal[i + 2] = clamp((1 / length * .5 + .5) * 255, 0, 255);
    normal[i + 3] = 255;
    // Raised threads are polished by wear; the valleys stay dusty and matte.
    const r = clamp(248 - (h - .5) * 120, 0, 255);
    rough[i] = r; rough[i + 1] = r; rough[i + 2] = r; rough[i + 3] = 255;
  }
  function texture(data, srgb) {
    const map = new THREE.DataTexture(data, size, size);
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.repeat.set(repeat[0], repeat[1]);
    map.magFilter = THREE.LinearFilter; map.minFilter = THREE.LinearMipmapLinearFilter;
    map.anisotropy = 8; map.generateMipmaps = true;
    if (srgb) map.colorSpace = THREE.SRGBColorSpace;
    map.needsUpdate = true;
    return map;
  }
  const material = new THREE.MeshPhysicalMaterial({
    color: colour, roughness, metalness: 0, side: THREE.DoubleSide, vertexColors: true,
    sheen, sheenColor: new THREE.Color(sheenColour), sheenRoughness,
    map: texture(albedo, true),
    normalMap: texture(normal, false),
    roughnessMap: texture(rough, false),
  });
  material.normalScale.set(normalScale, normalScale);
  fabricCache.set(key, material);
  return material;
}

// ---------------------------------------------------------------------------
// Panel construction
// ---------------------------------------------------------------------------

/** Build one cloth sheet. `shape(u,v)` returns the bind position in the
 *  socket's frame (metres at the reference height); `tint(u,v,p)` returns the
 *  baked dirt / crease vertex colour. */
export function buildPanel({name, rows, cols, material, shape, tint, socket, seed = 0, drag = 1, stiffness = 1, collide = null, bend = .72, holdTo = .53, gather = 0, span = 0}) {
  const stride = cols + 1, count = (rows + 1) * stride;
  const rest = new Float32Array(count * 3);
  const positions = new Float32Array(count * 3), uvs = new Float32Array(count * 2);
  const colours = new Float32Array(count * 3);
  const indices = [];
  for (let j = 0; j <= rows; j++) {
    const v = j / rows;
    for (let i = 0; i <= cols; i++) {
      const u = i / cols, k = (j * stride + i) * 3;
      const p = shape(u, v);
      rest[k] = positions[k] = p.x; rest[k + 1] = positions[k + 1] = p.y; rest[k + 2] = positions[k + 2] = p.z;
      uvs[(j * stride + i) * 2] = u; uvs[(j * stride + i) * 2 + 1] = v;
      const c = tint(u, v, p);
      colours[k] = c[0]; colours[k + 1] = c[1]; colours[k + 2] = c[2];
      if (i < cols && j < rows) {
        const a = j * stride + i;
        indices.push(a, a + stride, a + 1, a + 1, a + stride, a + stride + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name; mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
  // Rest lengths of the structural springs, in reference-height metres.
  const lengthV = new Float32Array(rows * stride), lengthH = new Float32Array((rows + 1) * cols);
  for (let j = 0; j < rows; j++) for (let i = 0; i <= cols; i++) {
    const a = (j * stride + i) * 3, b = ((j + 1) * stride + i) * 3;
    lengthV[j * stride + i] = Math.hypot(rest[b] - rest[a], rest[b + 1] - rest[a + 1], rest[b + 2] - rest[a + 2]);
  }
  // …and their PLANAR rest length: the same neighbours projected onto the
  // ground plane. This is the one the compression floor uses, and the
  // difference is not a detail. A torn hem's neighbouring columns are metres
  // apart mostly in Y (a 40 % tear drops one column half a metre below the
  // next), so a floor on the 3D length is satisfied by that vertical gap alone
  // and lets the columns slide together in X until the cape is a strap: the
  // boss's hem measured 0.96 m of horizontal arc against a 3.28 m 3D rest
  // length, and the 1.85x cut flare arrived on screen as +3 %.
  const lengthHP = new Float32Array((rows + 1) * cols);
  for (let j = 0; j <= rows; j++) for (let i = 0; i < cols; i++) {
    const a = (j * stride + i) * 3, b = (j * stride + i + 1) * 3;
    lengthH[j * cols + i] = Math.hypot(rest[b] - rest[a], rest[b + 1] - rest[a + 1], rest[b + 2] - rest[a + 2]);
    lengthHP[j * cols + i] = Math.hypot(rest[b] - rest[a], rest[b + 2] - rest[a + 2]);
  }
  // Planar rest span across TWO columns. Enforced as a minimum it is the cross
  // grain of the cloth: it does not stop the sheet folding, it stops it folding
  // so tightly that the fold costs no width. Without it the cape spent its whole
  // flare on a one-column zig-zag and the silhouette never grew.
  const lengthS = new Float32Array((rows + 1) * Math.max(0, cols - 1));
  for (let j = 0; j <= rows; j++) for (let i = 0; i + 2 <= cols; i++) {
    const a = (j * stride + i) * 3, b = (j * stride + i + 2) * 3;
    lengthS[j * (cols - 1) + i] = Math.hypot(rest[b] - rest[a], rest[b + 2] - rest[a + 2]);
  }
  // Bend rest lengths: the straight-line distance across two rows. Enforced as a
  // MINIMUM, this is what stops a hanging panel curling up on itself — without it
  // every link tilts under the wind and the tilts accumulate into a hook.
  const lengthB = new Float32Array(Math.max(0, rows - 1) * stride);
  for (let j = 0; j + 2 <= rows; j++) for (let i = 0; i <= cols; i++) {
    const a = (j * stride + i) * 3, b = ((j + 2) * stride + i) * 3;
    lengthB[j * stride + i] = Math.hypot(rest[b] - rest[a], rest[b + 1] - rest[a + 1], rest[b + 2] - rest[a + 2]);
  }
  return {
    mesh, socket, rows, cols, stride, count, seed, drag, stiffness, bend, holdTo, gather, span, rest, lengthV, lengthH, lengthHP, lengthS, lengthB, collide,
    position: new Float32Array(count * 3), previous: new Float32Array(count * 3), target: new Float32Array(count * 3),
    solved: new Float32Array(count * 3),
    anchor: new Float32Array(3), anchorDelta: new Float32Array(3), initialized: false, resets: 0,
  };
}

// ---------------------------------------------------------------------------
// Solver
// ---------------------------------------------------------------------------

const PINNED_ROWS = 2;      // the rows sewn to the belt / mantle edge
const ITERATIONS = 4;
const SEAM_LIMIT = 1.1;  // the hardest a seam may ever be drawn past its rest length
const CONSTRAINT_KEEP = .25; // share of a constraint correction that becomes velocity
const FLOOR_Y = .02;        // world metres; the arena floor is y = 0

/** Push a world point out of a capsule given in world space. Returns the
 *  penetration depth it removed (0 when the point was already outside). */
function resolveCapsule(out, capsule) {
  const {ax, ay, az, bx, by, bz, r} = capsule;
  // Cheap bounding-sphere reject first: most particles are nowhere near most
  // capsules, and contact is the hot loop of the whole solver.
  const ox = out.x - capsule.cx, oy = out.y - capsule.cy, oz = out.z - capsule.cz;
  if (ox * ox + oy * oy + oz * oz > capsule.rejectSq) return 0;
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const lengthSq = dx * dx + dy * dy + dz * dz;
  let t = lengthSq > 1e-9 ? ((out.x - ax) * dx + (out.y - ay) * dy + (out.z - az) * dz) / lengthSq : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + dx * t, cy = ay + dy * t, cz = az + dz * t;
  // The body is wider across than it is deep, so the test runs in a space
  // squashed along x; a round capsule would otherwise shove the hem off a hip.
  const sx = capsule.sx || 1;
  let px = (out.x - cx) / sx, py = out.y - cy, pz = out.z - cz;
  let distance = Math.hypot(px, py, pz);
  if (distance >= r) return 0;
  if (distance < 1e-5) { px = 0; py = 0; pz = -1; distance = 1; }
  const push = (r - distance) / distance;
  out.x += px * push * sx; out.y += py * push; out.z += pz * push;
  return r - distance;
}

/** Push every free particle of a panel out of the body capsules and the floor.
 *  Keeps a little over half of the push as velocity, so a thigh sweeping through
 *  the panel still shoves it clear while cloth RESTING on a capsule does not
 *  buzz. Verlet reads velocity off the last position, so a push that is left
 *  whole becomes next frame's speed: a hem lying on the shoulder was flung off
 *  its own contact and pulled back by gravity 60 times a second, and measured
 *  1.9 m/s while the character stood still. Absorbing part of the push into the
 *  previous position is the standard inelastic contact. */
const CONTACT_KEEP = .30;
function contact(panel, context) {
  const {rows, cols, stride, position, previous, collide} = panel;
  const colliders = context.colliders;
  const absorb = 1 - CONTACT_KEEP;
  for (let j = PINNED_ROWS; j <= rows; j++) for (let i = 0; i <= cols; i++) {
    const k = (j * stride + i) * 3;
    _p.set(position[k], position[k + 1], position[k + 2]);
    let moved = 0;
    for (let c = 0; c < collide.length; c++) {
      const capsule = colliders[collide[c]];
      if (capsule.live) moved += resolveCapsule(_p, capsule);
    }
    if (_p.y < FLOOR_Y) { _p.y = FLOOR_Y; moved += 1e-4; }
    if (moved > 0) {
      previous[k] += (_p.x - position[k]) * absorb;
      previous[k + 1] += (_p.y - position[k + 1]) * absorb;
      previous[k + 2] += (_p.z - position[k + 2]) * absorb;
      position[k] = _p.x; position[k + 1] = _p.y; position[k + 2] = _p.z;
    }
  }
}

function stepPanel(panel, context) {
  const {rows, cols, stride, count, rest, position, previous, target, lengthV, lengthH, lengthHP, lengthS, lengthB} = panel;
  const world = panel.socket.matrixWorld, element = world.elements;
  const scale = Math.hypot(element[0], element[1], element[2]) || 1;
  for (let k = 0; k < count * 3; k += 3) {
    const x = rest[k], y = rest[k + 1], z = rest[k + 2];
    target[k] = element[0] * x + element[4] * y + element[8] * z + element[12];
    target[k + 1] = element[1] * x + element[5] * y + element[9] * z + element[13];
    target[k + 2] = element[2] * x + element[6] * y + element[10] * z + element[14];
  }
  const centre = Math.floor(cols / 2) * 3;
  const jump = Math.hypot(target[centre] - panel.anchor[0], target[centre + 1] - panel.anchor[1], target[centre + 2] - panel.anchor[2]);
  if (!panel.initialized || jump > context.resetDistance) {
    position.set(target); previous.set(target);
    if (panel.initialized) panel.resets++;
    panel.initialized = true;
    panel.anchorDelta[0] = panel.anchorDelta[1] = panel.anchorDelta[2] = 0;
  } else for (let a = 0; a < 3; a++) panel.anchorDelta[a] = target[centre + a] - panel.anchor[a];
  panel.anchor[0] = target[centre]; panel.anchor[1] = target[centre + 1]; panel.anchor[2] = target[centre + 2];

  const step = context.step, stepSq = step * step;
  // Damp movement relative to the moving attachment. Damping all world velocity
  // treats a running wearer as hurricane wind and streams the panels out flat.
  const damping = Math.exp(-step * 5.2 * panel.drag);
  const transportKeep = clamp(.97 - .12 * panel.drag, .6, .99);
  const gravity = -9.1;
  const {windX, windZ, gust} = context;
  const maxSpeed = context.maxSpeed;
  for (let j = PINNED_ROWS; j <= rows; j++) {
    const weight = j / rows;
    // The cut rest shape governs the gathers just under the seam and nothing
    // else: below the top third the drape is gravity, tension and contact. A
    // restore force that reached the hem dragged the whole panel along with a
    // pitching pelvis, which is what used to swing the tassets out in a crouch.
    // The cut rest shape governs the fabric down to `holdTo` and nothing below:
    // a short tasset keeps only its gathers under the belt, a structured cape
    // keeps its fold pattern and the curve that lays it on the back, and in both
    // cases the hem is left to gravity, tension and contact.
    const hold = Math.max(0, 1 - weight / panel.holdTo), restore = 6.2 * panel.stiffness * hold * hold;
    for (let i = 0; i <= cols; i++) {
      const k = (j * stride + i) * 3;
      // A per-column phase makes the draught ripple across the sheet rather
      // than shoving the whole panel in one direction. The profile is linear in
      // depth: a load concentrated at the hem curls a hanging sheet into a hook,
      // while a load spread along it just tilts the whole panel a few degrees.
      const ripple = Math.sin(context.time * 2.3 + i * .9 + panel.seed) * .5 + .5;
      const breeze = weight * (.35 + .65 * ripple) * gust;
      for (let a = 0; a < 3; a++) {
        const old = position[k + a];
        const transport = panel.anchorDelta[a] * transportKeep;
        let velocity = (old - previous[k + a] - transport) * damping + transport;
        if (velocity > maxSpeed) velocity = maxSpeed; else if (velocity < -maxSpeed) velocity = -maxSpeed;
        const force = a === 1 ? gravity : (a === 0 ? windX * breeze : windZ * breeze);
        position[k + a] = old + velocity + (force + (target[k + a] - old) * restore) * stepSq;
        previous[k + a] = old;
      }
    }
  }
  // The free-flight prediction, kept so the constraint solver's corrections can
  // be damped as a whole below.
  panel.solved.set(position);

  const restV = scale;
  for (let iteration = 0; iteration < ITERATIONS; iteration++) {
    for (let k = 0; k < PINNED_ROWS * stride * 3; k++) position[k] = target[k];
    // Structural springs. Vertical first (they carry the weight), then the
    // horizontal ones, which are what stop a panel collapsing into a ribbon.
    for (let j = PINNED_ROWS - 1; j < rows; j++) {
      for (let i = 0; i <= cols; i++) {
        const a = (j * stride + i) * 3, b = a + stride * 3;
        const dx = position[b] - position[a], dy = position[b + 1] - position[a + 1], dz = position[b + 2] - position[a + 2];
        const distance = Math.hypot(dx, dy, dz) || 1e-6;
        // Resolved strictly top-down: the panel hangs from a pinned seam, so
        // only the lower point moves and one sweep satisfies the whole column.
        // Sharing the correction both ways needed far more iterations and still
        // let a running panel draw itself out like chewing gum.
        const correction = (distance - lengthV[j * stride + i] * restV) / distance;
        position[b] -= dx * correction; position[b + 1] -= dy * correction; position[b + 2] -= dz * correction;
      }
    }
    // In-plane compression floor. Real cloth cannot squeeze along the weft: when
    // a hanging sheet is pushed together it buckles OUT of plane into folds. With
    // a pull-only seam the sheet just gathered flat instead — the boss's cape
    // settled 0.74 m wide at the yoke and 0.76 m at the hem although it was cut
    // with an 1.85x flare: an extruded card, not fabric.
    //
    // The floor is measured and applied IN THE GROUND PLANE (`lengthHP`), and
    // that is the whole of it. Against the 3D rest length — which is what this
    // did first — a torn hem satisfies the floor with its own tears, because
    // neighbouring columns at a 40 cm tear are already far apart in Y. Measured
    // on the cape, planar arc against 3D rest length per row: 99 % at the yoke,
    // 72 % a third of the way down, 29 % at the hem. The constraint was holding
    // in a direction nobody was looking at while the cape narrowed to a strap.
    const gatherMin = panel.gather;
    for (let j = PINNED_ROWS; j <= rows; j++) for (let i = 0; i < cols; i++) {
      const a = (j * stride + i) * 3, b = a + 3;
      const dx = position[b] - position[a], dy = position[b + 1] - position[a + 1], dz = position[b + 2] - position[a + 2];
      const distance = Math.hypot(dx, dy, dz) || 1e-6;
      // Only pull in; letting the sheet compress freely is what creates folds.
      const slack = lengthH[j * cols + i] * restV;
      if (distance > slack) {
        const correction = (distance - slack) / distance * .38;
        position[a] += dx * correction; position[a + 1] += dy * correction; position[a + 2] += dz * correction;
        position[b] -= dx * correction; position[b + 1] -= dy * correction; position[b + 2] -= dz * correction;
      } else if (gatherMin > 0) {
        // The floor is on the PLANAR separation and pushes in the ground plane
        // only, so the material a squeeze has nowhere else to put goes into
        // out-of-plane folds — never into a column sliding up behind its
        // neighbour, which is how a torn hem satisfied a 3D floor while the
        // cape narrowed to a strap.
        const floor = lengthHP[j * cols + i] * restV * gatherMin;
        if (floor < 1e-5) continue;
        const planar = Math.hypot(dx, dz);
        if (planar >= floor) continue;
        const correction = planar > 1e-5 ? (planar - floor) / planar * .44 : 0;   // negative: pushes apart
        if (correction === 0) { position[a] -= floor * .22; position[b] += floor * .22; continue; }
        position[a] += dx * correction; position[a + 2] += dz * correction;
        position[b] -= dx * correction; position[b + 2] -= dz * correction;
      }
    }
    // Cross-grain span. The same planar floor across TWO columns: a fold may be
    // deep, but it may not be a crease one column wide, because a crease that
    // tight puts the whole flare into a zig-zag that costs the silhouette
    // nothing. With the pair floor alone the boss's hem held 1.56 m of cloth in
    // 0.93 m of width; broadening the folds is what turns that arc into a cape.
    const spanMin = panel.span;
    if (spanMin > 0) for (let j = PINNED_ROWS; j <= rows; j++) for (let i = 0; i + 2 <= cols; i++) {
      const a = (j * stride + i) * 3, b = a + 6;
      const floor = lengthS[j * (cols - 1) + i] * restV * spanMin;
      if (floor < 1e-5) continue;
      const dx = position[b] - position[a], dz = position[b + 2] - position[a + 2];
      const planar = Math.hypot(dx, dz);
      if (planar >= floor) continue;
      if (planar < 1e-5) { position[a] -= floor * .18; position[b] += floor * .18; continue; }
      const correction = (planar - floor) / planar * .30;
      position[a] += dx * correction; position[a + 2] += dz * correction;
      position[b] -= dx * correction; position[b + 2] -= dz * correction;
    }
    // Bend limit. Two rows apart may fold, but not double back: pushed as a
    // minimum distance and, like the seams, resolved top-down so it can never
    // drag the sewn rows off the armour. This is what keeps a hanging panel
    // hanging instead of slowly rolling itself into a hook under a side load.
    const bendMin = iteration < ITERATIONS - 1 ? panel.bend : 0;
    if (bendMin > 0) for (let j = PINNED_ROWS - 1; j + 2 <= rows; j++) for (let i = 0; i <= cols; i++) {
      const a = (j * stride + i) * 3, b = a + stride * 6;
      const dx = position[b] - position[a], dy = position[b + 1] - position[a + 1], dz = position[b + 2] - position[a + 2];
      const distance = Math.hypot(dx, dy, dz) || 1e-6;
      const floor = lengthB[j * stride + i] * restV * bendMin;
      if (distance >= floor) continue;
      const correction = (floor - distance) / distance * .5;
      position[b] += dx * correction; position[b + 1] += dy * correction; position[b + 2] += dz * correction;
    }
  }
  // Constraint damping — the difference between a garment and a whipping rag.
  // The structural sweep above is one-sided (only the lower particle moves,
  // because the row above hangs from the armour), so it does not conserve
  // momentum: letting the whole correction become next frame's velocity pumps
  // energy in, and a 1 cm wobble of the pelvis grew into a 25 cm orbit of the
  // hem during a *standing* idle. Keep a quarter of it — enough for tension and
  // swing, not enough to feed itself. Contact runs after this line, undamped,
  // so a thigh sweeping through the panel still shoves it clear at full force.
  {
    const {solved} = panel, absorb = 1 - CONSTRAINT_KEEP;
    for (let k = PINNED_ROWS * stride * 3; k < count * 3; k++) previous[k] += (position[k] - solved[k]) * absorb;
  }
  // Contact and the seam limit fight each other when the body curls fast (a
  // shoulder roll sweeps a thigh straight through the panel), so alternate
  // them: each pass leaves less of both, and the seam has the last word.
  for (let pass = 0; pass < 3; pass++) {
    for (let k = 0; k < PINNED_ROWS * stride * 3; k++) position[k] = target[k];
    contact(panel, context);
    // Seam limit and the floor, resolved together, strictly top-down from the
    // sewn rows. Resolving them separately made a hem that had just been lifted
    // off the flagstones tear the short segment it hangs from.
    for (let j = PINNED_ROWS - 1; j < rows; j++) for (let i = 0; i <= cols; i++) {
      const a = (j * stride + i) * 3, b = a + stride * 3;
      const limit = lengthV[j * stride + i] * restV * SEAM_LIMIT;
      let dx = position[b] - position[a], dz = position[b + 2] - position[a + 2];
      const ay = position[a + 1];
      let dy = Math.max(position[b + 1], FLOOR_Y) - ay;
      if (Math.hypot(dx, dy, dz) > limit) {
        if (Math.abs(dy) <= limit) {
          const reach = Math.sqrt(limit * limit - dy * dy), horizontal = Math.hypot(dx, dz);
          if (horizontal > reach) { const f = reach / (horizontal || 1e-6); dx *= f; dz *= f; }
        } else {
          // Even straight down is too far: the seam wins over the floor.
          const f = limit / Math.hypot(dx, dy, dz); dx *= f; dy *= f; dz *= f;
        }
      }
      const nx = position[a] + dx, ny = ay + dy, nz = position[a + 2] + dz;
      position[b] = nx; position[b + 1] = ny; position[b + 2] = nz;
    }
  }

}

function writePanel(panel, inverse) {
  const array = panel.mesh.geometry.attributes.position.array, position = panel.position;
  const e = inverse.elements;
  for (let k = 0; k < panel.count * 3; k += 3) {
    const x = position[k], y = position[k + 1], z = position[k + 2];
    array[k] = e[0] * x + e[4] * y + e[8] * z + e[12];
    array[k + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
    array[k + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
  }
  panel.mesh.geometry.attributes.position.needsUpdate = true;
  panel.mesh.geometry.computeVertexNormals();
}

// A paused frame has to relax all the way, or the reviewer — and the user
// scrubbing the studio — judges a shape the running game never draws. 34 steps
// was half a second of fall: the boss cloak's hem measured 1.06 m wide at step
// 34, 0.85 at 60 and 0.76 from 120 on, so every held still showed a cape up to
// 29 cm wider than the game's, caught mid-fall. The loop now runs until the
// fabric stops moving and only then stops, with a hard ceiling so a garment that
// will never settle (a hem resting on a moving foot) cannot hang the page.
const SETTLE_STEPS_MIN = 40, SETTLE_STEPS_MAX = 260, SETTLE_CHECK = 10;
// Mean, not worst: a settled cape still has a few hem particles rocking a
// couple of millimetres for ever (measured: the worst one plateaus at 6 mm per
// 10 steps and never goes below it), while the mean decays cleanly — 63 mm at
// step 20, 5 mm at 100, 0.4 mm at 200, by which point the hem width has stopped
// moving to within 1 %.
const SETTLE_TOLERANCE = 3e-4;   // mean metres of drift per particle per 10 steps

/** Relax a held pose into its hanging drape. Used when the caller has no time
 *  step of its own (a paused studio frame); a fingerprint of the socket poses
 *  keeps a redrawn identical frame free. */
function settleCloth(root, simulation, time, speed) {
  root.updateMatrixWorld(true);
  let key = 0;
  for (const panel of simulation.panels) {
    const e = panel.socket.matrixWorld.elements;
    for (let i = 0; i < 16; i += 3) key = (key * 31 + Math.round(e[i] * 8192)) % 2147483647;
  }
  if (simulation.settledAt === key) return;
  simulation.settledAt = key;
  simulation.accumulator = 0;
  const scale = Math.hypot(root.matrixWorld.elements[0], root.matrixWorld.elements[1], root.matrixWorld.elements[2]) || 1;
  const snapshots = simulation.panels.map(panel => new Float32Array(panel.count * 3));
  let steps = 0;
  for (let i = 0; i < SETTLE_STEPS_MAX; i++) {
    // The same instant every step: the draught's phase comes from `time`, and
    // advancing it kept blowing the cape about, so the drape never converged —
    // the loop just ran to its ceiling. A held frame gets a held breeze.
    updatePlayerCloth(root, 1 / 60, time, {speed});
    steps = i + 1;
    if (steps < SETTLE_STEPS_MIN || steps % SETTLE_CHECK !== 0) continue;
    let drift = 0, particles = 0;
    simulation.panels.forEach((panel, index) => {
      const was = snapshots[index], now = panel.position;
      for (let k = 0; k < panel.count * 3; k += 3) {
        drift += Math.hypot(now[k] - was[k], now[k + 1] - was[k + 1], now[k + 2] - was[k + 2]);
        particles++;
      }
      was.set(now);
    });
    if (steps > SETTLE_STEPS_MIN && drift / Math.max(1, particles) < SETTLE_TOLERANCE * scale) break;
  }
  simulation.settleSteps = steps;
  simulation.settledAt = key;
}

/** Drive every panel of a cloth root. Called by the actor after it has posed
 *  the skeleton and refreshed the garment sockets. Safe for both characters. */
export function updatePlayerCloth(root, dt, time, {speed = 0} = {}) {
  const simulation = root?.clothSimulation;
  if (!simulation) return;
  // A paused reviewer (the animation studio scrubs with dt = 0) would otherwise
  // see the fabric frozen in its cut shape, rigidly bolted to whatever angle the
  // held pose puts the bone at. Settle it instead, so a scrubbed frame shows the
  // drape the game would show — but only when the pose actually changed, so
  // holding one frame costs nothing.
  if (!(dt > 0)) { settleCloth(root, simulation, time, speed); return; }
  simulation.settledAt = 0;
  root.updateMatrixWorld(true);
  // Cloth has its own 60 Hz step; the gameplay simulation runs at 120 Hz.
  simulation.accumulator = Math.min(simulation.accumulator + dt, 1 / 20);
  if (simulation.accumulator < 1 / 60) return;
  const step = Math.min(simulation.accumulator, 1 / 30);
  simulation.accumulator = 0;
  const started = simulation.profile ? performance.now() : 0;

  const worldMatrix = root.matrixWorld, e = worldMatrix.elements;
  const scale = Math.hypot(e[0], e[1], e[2]) || 1;
  // The body colliders ride the skeleton: a capsule per bone segment, placed
  // from the live bone positions so a swinging thigh or a curled spine really
  // pushes the fabric. Radii were fitted to the skinned mesh's rear surface.
  const colliders = simulation.colliders;
  for (const capsule of colliders) {
    capsule.live = !!(capsule.boneA && capsule.boneB);
    if (!capsule.live) continue;
    capsule.boneA.getWorldPosition(_v); capsule.boneB.getWorldPosition(_p);
    let dx = _p.x - _v.x, dy = _p.y - _v.y, dz = _p.z - _v.z;
    const length = Math.hypot(dx, dy, dz) || 1;
    dx /= length; dy /= length; dz /= length;
    const back = (capsule.extend?.[0] || 0) * scale, front = (capsule.extend?.[1] || 0) * scale;
    capsule.ax = _v.x - dx * back; capsule.ay = _v.y - dy * back; capsule.az = _v.z - dz * back;
    capsule.bx = _p.x + dx * front; capsule.by = _p.y + dy * front; capsule.bz = _p.z + dz * front;
    capsule.r = capsule.radius * scale;
    capsule.cx = (capsule.ax + capsule.bx) * .5; capsule.cy = (capsule.ay + capsule.by) * .5; capsule.cz = (capsule.az + capsule.bz) * .5;
    const reach = Math.hypot(capsule.bx - capsule.ax, capsule.by - capsule.ay, capsule.bz - capsule.az) * .5 + capsule.r * Math.max(1, capsule.sx || 1);
    capsule.rejectSq = reach * reach;
  }
  // A slow draught through the ruin, lifted a little when the wearer runs.
  const gust = (.55 + .45 * Math.sin(time * .41)) * (1.6 + Math.min(speed, 6) * .5);
  const heading = time * .19;
  const context = {
    step, time, colliders, gust,
    windX: Math.sin(heading) * .5 + Math.sin(time * 1.7) * .16,
    windZ: Math.cos(heading) * .5 + Math.cos(time * 1.3) * .16,
    resetDistance: simulation.resetDistance * scale,
    maxSpeed: .6 * scale,
  };
  for (const panel of simulation.panels) {
    if (!panel.mesh.visible || !panel.mesh.parent?.visible) continue;
    stepPanel(panel, context);
  }
  _matrix.copy(worldMatrix).invert();
  for (const panel of simulation.panels) {
    if (!panel.mesh.visible || !panel.mesh.parent?.visible) continue;
    writePanel(panel, _matrix);
  }
  if (simulation.profile) {
    (simulation.timings ??= []).push(performance.now() - started);
    simulation.steps = (simulation.steps || 0) + 1;
  }
  simulation.lastTime = time;
}

/** Attach the socket empties of a cloth root to the skeleton. The offset is
 *  captured in the bind pose, so the root rows stay welded to the garment. */
export function bindCloth(root, body) {
  root.updateMatrixWorld(true);
  const bindings = [];
  for (const {node, bone: name} of root.userData.bindings || []) {
    const bone = body.getObjectByName(name);
    if (!bone) continue;
    bindings.push({garment: node, bone, offset: bone.matrixWorld.clone().invert().multiply(node.matrixWorld)});
  }
  for (const capsule of root.clothSimulation?.colliders || []) {
    capsule.boneA = body.getObjectByName(capsule.from) || null;
    capsule.boneB = body.getObjectByName(capsule.to) || null;
  }
  return bindings;
}

// ---------------------------------------------------------------------------
// Thorn Exile: two belt tassets, a sash tail and a short helm crest.
// Constants are metres on the 1.85 m reference mesh, measured with
// scripts/measure-cloth-anchors.mjs:
//   hips bone   (0.007, 1.050, -0.050)      rear belt surface  z = -0.142 @ y 1.00..1.08
//   head bone   (0.007, 1.623, -0.045)      rear helm surface  z = -0.130 @ y 1.63
//   thigh axis  (±0.095, 1.011) → (±0.095, 0.570)   knee y = 0.570
// ---------------------------------------------------------------------------

const PLAYER_REFERENCE = 1.85;
// Which body capsules each garment can possibly touch. Testing a helm ribbon
// against a shin is pure cost, and contact is the solver's hot loop. The helm
// pennant gets its own two slim capsules (8, 9) rather than the wide torso ones:
// pushed out by a collar capsule 1.7x wider than the neck, the old crest ribbons
// splayed over both shoulders and merged into one crimson hoop across the nape.
const BELT_COLLIDERS = [0, 1, 4, 5, 6, 7], CREST_COLLIDERS = [8];

// Rear surface of the hip armour at belt height, reference metres, measured off
// the skinned rest pose (min z per 4 cm column, y 1.02–1.06):
//   |x| ≤ .115  z ≈ -.150      .140 → -.136      .160 → -.107      .190 → -.065
// A tasset cut at a constant z hangs on that curve only near the spine: at the
// outer corner it stood 5 cm behind the hip with daylight above it, which is the
// "hard horizontal cut edge starting in mid air" the panels used to read as.
const hipBack = x => -.150 + 7.6 * Math.max(0, Math.abs(x) - .115) ** 1.7;
const WAIST_Z = -.142;          // the waist socket's own z, so `hipBack` can be
const CREST_Z = -.140;          // used as an absolute measurement in `shape()`

export function createPlayerCloth(height = PLAYER_REFERENCE) {
  const k = height / PLAYER_REFERENCE;
  const root = new THREE.Group(); root.name = 'player-code-cloth';
  const waist = new THREE.Group(); waist.name = 'waist-cloth-socket';
  waist.position.set(0, 1.028 * k, WAIST_Z * k); root.add(waist);
  const crest = new THREE.Group(); crest.name = 'head-plume-socket';
  // 1.2 cm behind the rear of the helm (measured -.128 at y 1.66), not 1.6 cm
  // inside it, so the pennant starts on the outside of the armour.
  crest.position.set(0, 1.648 * k, CREST_Z * k); root.add(crest);

  // `wrinkle` no longer prints a chevron (see `weaveHeight`), so it can carry
  // fibre without patterning the panel; `twill` divides the 128-pixel tile.
  const wool = fabricMaterial(0x232f38, {twill: 4, wrinkle: 1, seed: .7, repeat: [2.4, 7], sheen: .3, roughness: .95, normalScale: .95});
  // The sash and the neck-cloth used to render as flat untextured planes: a
  // 3-pixel twill does not wrap a 128-pixel tile, and at normalScale .6 with
  // `weave` left at its default the only relief they had was the chevron term
  // that has now gone. Finer thread, a tighter repeat and a real normal instead.
  const silk = fabricMaterial(0x5d262c, {twill: 4, weave: 1.05, wrinkle: .9, seed: 2.3, repeat: [2.6, 11], sheen: .42, sheenColour: 0x9a6a62, roughness: .8, normalScale: 1});
  const panels = [];

  // --- belt tassets -------------------------------------------------------
  // The sewn rows follow `hipBack`, so the top edge is pressed onto the fauld
  // across its whole width and the armour covers the cut; the panel then leaves
  // the armour over the first quarter and hangs. Cut flat it floated: measured
  // against the skinned mesh the sewn row stood 21 mm off the body on average
  // and 37–58 mm by the third row, with the background visible above the outer
  // corner of each tasset.
  function tasset(centreX, halfWidth, length, seed, pleats) {
    const hem = u => 1 - .3 * Math.max(0, Math.sin(u * Math.PI * 2.7 + seed * 2.1)) ** 2
      - .17 * Math.max(0, Math.sin(u * Math.PI * 5.3 + seed)) ** 3;
    const side = Math.sign(centreX) || 1;
    return buildPanel({
      name: 'detachable-torn-tail', rows: 18, cols: 11, material: wool, socket: waist, seed, drag: .95, stiffness: 1,
      // `span` broadens the gathers: without a floor across two columns the
      // tasset spent its slack on a crease one column wide, which is invisible
      // on a 12 cm panel at fighting distance (measured 5-7 mm of fold relief).
      collide: BELT_COLLIDERS, gather: .88, span: .84,
      shape(u, v) {
        // Cut WIDER than it hangs. A panel cut to its hanging width has no
        // slack to fold with, which is why the tassets measured 5-7 mm of fold
        // relief and read as two flat straps; the extra material has to go
        // somewhere, and with the planar compression floor it goes into
        // gathers rather than into a narrower panel.
        const taper = 1 + .26 * v ** 1.2;
        // A gathered top: the sheet is pleated where it passes under the belt
        // and opens out as it falls, exactly like a leather-backed tasset.
        const gathered = 1 - .22 * Math.exp(-v * 8);
        const x = centreX + side * (u - .5) * 2 * halfWidth * taper * gathered;
        // The seam wraps the hip; a quarter of the way down the panel has left
        // the armour and hangs in a plane a centimetre behind the deepest fauld.
        const onArmour = smoothstep(0, .26, v);
        const seamZ = hipBack(x) - .007 - WAIST_Z;
        const hangZ = -.012 - .020 * v * v;
        const pleat = Math.cos(u * Math.PI * pleats + seed) * .015 * (1 - .4 * v) * (v < .06 ? v / .06 : 1);
        return {
          x: x * k,
          y: (-v * length * hem(u) - .010 * Math.max(0, Math.abs(x) - .115)) * k,
          z: (seamZ + (hangZ - seamZ) * onArmour + pleat) * k,
        };
      },
      tint(u, v) {
        const crease = .74 + .26 * (.5 + .5 * Math.cos(u * Math.PI * pleats + seed));
        const grime = 1 - .2 * v ** 2.4 - .07 * Math.max(0, Math.sin(u * 7.3 + seed * 3));
        const d = crease * grime;
        return [d, d * .985, d * .955];
      },
    });
  }
  panels.push(tasset(-.112, .078, .535, 1.1, 3), tasset(.112, .075, .505, 2.7, 3));

  // --- crimson sash tail, hung over the tassets ---------------------------
  panels.push(buildPanel({
    name: 'detachable-torn-tail', rows: 18, cols: 6, material: silk, socket: waist, seed: 4.2, drag: 1.15, stiffness: .8,
    collide: BELT_COLLIDERS, gather: .9, span: .86,
    shape(u, v) {
      const w = .040 * (1 - .30 * v);
      const x = (u - .5) * 2 * w;
      const hem = 1 - .24 * Math.max(0, Math.sin(u * Math.PI * 1.9 + 1.1)) ** 2
        - .30 * Math.exp(-(((u - .58) / .12) ** 2)) * smoothstep(.4, 1, v);
      const seamZ = hipBack(x) - .005 - WAIST_Z;
      const hangZ = -.016 - .016 * v * v;
      return {
        x: x * k, y: (-v * .46 * hem) * k,
        z: (seamZ + (hangZ - seamZ) * smoothstep(0, .22, v) + Math.cos(u * Math.PI * 2) * .006) * k,
      };
    },
    tint(u, v) { const d = .82 + .18 * (.5 + .5 * Math.cos(u * Math.PI * 2)) - .16 * v ** 3; return [d, d * .93, d * .9]; },
  }));

  // --- helm lambrequin: a short torn neck-cloth off the back of the helm ----
  // Three 2.9 cm ribbons spaced 2.0 cm apart OVERLAPPED each other, and the cut
  // put their sewn rows 1.6 cm INSIDE the helm (measured rear helm surface
  // z = -.128 at y 1.66), so they emerged around the gorget and merged into one
  // solid crimson hoop arching over both shoulders — the single worst-looking
  // thing on the player from behind.
  //
  // The reason nothing longer works here is geometric, not a tuning miss: the
  // player's fighting idle leans the spine hard forward (hips z -.050 → head
  // z +.150 in the posed clip), so the nape OVERHANGS the shoulder caps. Any
  // tail long enough to leave the helm falls onto a shoulder and lies there,
  // which is what produced the hoop in the first place. Measured: the old
  // ribbons settled at x -.12, z +.13 — on top of the left trapezius, 7 mm off
  // the skin. So this is a wide, short neck-cloth that STOPS at the gorget: it
  // covers the nape, is held near its cut shape (holdTo 1) so the helm carries
  // it and the head swings it, and its torn hem breaks into three tongues.
  panels.push(buildPanel({
    // Held in its cut shell (`holdTo` 1) on purpose, and the crease has to be
    // baked rather than simulated: letting the hem go measured 0.70 m/s at
    // `holdTo` .78 and 0.58 at .88, against a 0.55 m/s bound on a STANDING idle.
    // The nape is the one place a capsule cannot describe the body — the collar
    // capsule has to reach up inside the helm, and a hem balanced on its end cap
    // chatters. So the tongues are shaded in, not dropped.
    name: 'detachable-crimson-plume', rows: 8, cols: 8, material: silk, socket: crest, seed: 1.7, drag: 3.4, stiffness: 2.6,
    collide: CREST_COLLIDERS, bend: .74, holdTo: 1, gather: 0,
    shape(u, v) {
      const across = (u - .5) * 2;
      // Wraps the back of the helm rather than hanging as a flat card.
      const w = .074 * (1 - .16 * v);
      const tongues = 1 - .30 * Math.max(0, Math.sin(u * Math.PI * 3.1 + .6)) ** 2
        - .22 * Math.exp(-(((u - .78) / .10) ** 2));
      return {
        x: (across * w) * k,
        // The corners fall away at the sides, so the top edge is not a band.
        y: (-.030 * across * across - v * .130 * tongues) * k,
        // Leaves the helm as it falls, so the gorget passes in front of it.
        z: (-.004 + .030 * across * across - .058 * v - .010 * Math.sin(v * Math.PI * .9)) * k,
      };
    },
    // Creases baked along the cut's own tongues, so the dome reads as folded
    // cloth at the distance the camera actually sits behind the head.
    tint(u, v) {
      const tongue = Math.cos(u * Math.PI * 6.2 + .6);
      const d = .70 + .16 * (.5 + .5 * Math.cos(u * Math.PI * 2.4)) - .16 * v ** 3
        - .13 * Math.max(0, tongue) ** 2 * smoothstep(.15, .9, v)
        + .07 * Math.max(0, -tongue) * smoothstep(.1, .6, v);
      return [d, d * .9, d * .88];
    },
  }));

  for (const panel of panels) root.add(panel.mesh);
  root.userData = {
    bindings: [{node: waist, bone: 'mixamorigHips'}, {node: crest, bone: 'mixamorigHead'}],
    boneTargets: ['waist-cloth-socket', 'head-plume-socket'],
    bakedIntoBody: false, clothModel: 'world-space particle grid, capsule body collision',
  };
  root.clothSimulation = {
    panels, height, accumulator: 0, lastTime: -1, profile: false,
    // Only a teleport moves a socket this far in a single 1/60 s step; a dodge
    // or a clip restart must never be mistaken for one and reset the fabric.
    resetDistance: .9 * PLAYER_REFERENCE,
    // One capsule per bone segment. `radius` is the measured depth from the
    // bone to the mesh's rear surface; `sx` widens it across, because the body
    // is far broader than it is deep and a round capsule would shove the hem
    // off the hip. `extend` lengthens the segment past its end joints.
    colliders: [
      // Fitted to the measured fauld: bone z -.050, rear surface -.150 at the
      // spine and -.111 at |x| = .150, which is r = .097 squashed by sx 1.82.
      {from: 'mixamorigHips', to: 'mixamorigSpine1', radius: .097 * k, sx: 1.82, extend: [.10 * k, 0]},
      {from: 'mixamorigSpine1', to: 'mixamorigSpine2', radius: .110 * k, sx: 1.6},
      {from: 'mixamorigSpine2', to: 'mixamorigNeck', radius: .100 * k, sx: 1.7},
      {from: 'mixamorigNeck', to: 'mixamorigHead', radius: .070 * k, sx: 1.5, extend: [0, .05 * k]},
      {from: 'mixamorigLeftUpLeg', to: 'mixamorigLeftLeg', radius: .075 * k, sx: 1.7, extend: [-.09 * k, 0]},
      {from: 'mixamorigRightUpLeg', to: 'mixamorigRightLeg', radius: .075 * k, sx: 1.7, extend: [-.09 * k, 0]},
      {from: 'mixamorigLeftLeg', to: 'mixamorigLeftFoot', radius: .058 * k, sx: 1.5},
      {from: 'mixamorigRightLeg', to: 'mixamorigRightFoot', radius: .058 * k, sx: 1.5},
      // 8: the neck-cloth's own collider — one column from the upper spine to
      // the helm, barely wider than it is deep (the wide torso capsules are
      // what used to fan the crest out over the shoulders). Its end caps are
      // deliberately buried, .09 below Spine2 and .07 up inside the helm: a cap
      // the cloth GRAZES flips its push direction frame to frame, and a hem
      // balanced on one chattered at 1.9 m/s while the character stood still.
      // Measured depth from this axis to the skinned back: .115-.117 m over
      // y 1.42-1.50, and .098 at the helm.
      {from: 'mixamorigSpine2', to: 'mixamorigHead', radius: .112 * k, sx: 1.45, extend: [.09 * k, .07 * k]},
    ],
  };
  return root;
}
