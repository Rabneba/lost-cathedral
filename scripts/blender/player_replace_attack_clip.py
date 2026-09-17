# Replace one player clip with an animation authored on a different humanoid skeleton (the sword library)
# (the user's "Sword 4" FBX pack: pelvis / spine_01..05 / neck_01..02 / head / clavicle_* /
# upperarm_* / lowerarm_* / hand_* / thigh_* / calf_* / foot_* / ball_*, 0.01 scale, 30 or 60 fps).
#
# Why this is not player_replace_from_library_clip.py
# --------------------------------------------------
# That script assumes the source armature's REST pose is the same physical pose as ours (both
# Mixamo A-poses), so a rotation delta from rest transfers cleanly. These FBX files carry no
# bind pose at all: Blender falls back to each file's node defaults, which are whatever pose the
# take happened to hold at time 0 — a bent-kneed combat stance that differs per file (measured:
# 68 deg of knee flexion in hit1/hit3, 39 in Idle, 62 in hard_hit). Transferring a delta from
# that rest hyperextends the legs and rolls the arms.
#
# The fix, as derived in docs/player-motion-revision-3/README.md: work from a source REFERENCE
# FRAME instead of a rest pose, and fold a per-bone rest alignment into the delta. For every
# mapped bone we build an orthonormal frame PHI out of JOINT POSITIONS ONLY (bone direction plus
# an anatomically meaningful secondary axis: the elbow plane, the knee hinge, the hand's
# index-to-pinky lateral, the shoulder lateral). Joint positions are physical, so PHI means the
# same thing on both skeletons regardless of bone roll, tail or rest convention. Then
#
#     Q_b            = PHI_src(b, t_ref) @ PHI_ours(b, rest)^-1        (constant per bone)
#     R_ours(b, t)   = G @ [ W_src(b, t) @ W_src(b, t_ref)^-1 ] @ Q_b @ W_ours(b, rest)
#
# with every rotation in WORLD space (so the source's Z-up/Y-up and 0.01 scale drop out) and G a
# yaw about world Z that points the clip's cut at the opponent. At t = t_ref this reproduces the
# source pose exactly; away from it the delta is exact and only the constant Q carries recipe
# error. Bone lengths and proportions are always ours: we copy rotations, never positions.
#
# The left arm carries a shield in this game and nothing in the source pack, so by default the
# whole left chain (and the fingers of both hands, which grip the sword and the shield strap) is
# held at the V15 guard pose instead of being transferred. The hand-relative WeaponSocket and
# ShieldSocket offsets are preserved exactly as player_replace_action_clip.py does them, with an
# optional constant per-clip roll of the sword in the fist so the edge leads the cut without
# twisting the forearm.
#
# Environment
#   VESPER_SRC              FBX path, relative to the repo root
#   VESPER_SRC_CLIP         action name (default: the source armature's own action)
#   VESPER_TARGET           clip to replace (default light)
#   VESPER_BASE_BLEND       bundle to derive from   VESPER_BASE_MANIFEST  its manifest
#   VESPER_OUT              output stem (no extension)   VESPER_SOURCE  provenance text
#   VESPER_TRIM=f0,f1       source frames to keep (default: the action's own range)
#   VESPER_REF_FRAME        the reference frame t_ref (default: the first trimmed frame)
#   VESPER_SKIP=k0,k1[,keep] compress a held pose, exactly as player_replace_action_clip.py
#   VESPER_DURATION         output seconds; the trimmed take is resampled to it (retiming lives
#                           here, never in the runtime)
#   VESPER_EASE             0..1, extra slow-in/slow-out applied to the resample (0 = uniform)
#   VESPER_HEADING          cut | start | guard | fixed — which frames define the forward direction
#                           (fixed: no measured correction, VESPER_YAW_DEG is the whole yaw, so a
#                           follow-up clip can share the heading frame of the clip it chains from)
#   VESPER_YAW_DEG          extra global yaw on top of the heading correction
#   VESPER_FACING_YAW_DEG   facingYawDegrees written into the manifest entry (the runtime turns the
#                           visual root by it, blended by clip weight); default: the replaced clip's
#   VESPER_SOCKET_CLIP      clip whose hand-relative WeaponSocket/ShieldSocket offsets are copied
#                           (default: the target clip; a NEW target falls back to light)
#   VESPER_PIVOT_DEG        a yaw of the whole pose about the root, ramped in over the clip (a
#                           chained cut authored 52 deg from the cut before it pivots into the
#                           opponent during its own wind-up instead of popping at the blend)
#   VESPER_PIVOT_END_DEG    the yaw the pivot settles back to by the end of the clip (default 0)
#   VESPER_ARM_OUT_DEG      enveloped rotation of the whole sword arm about the body's forward axis,
#                           pivoting at the shoulder (+ lifts the hand and carries it across), for a
#                           wind-up whose blade would otherwise pass through the character's own
#                           flank because our torso is wider than the source's
#   VESPER_ARM_YAW_DEG      the same envelope about the vertical axis (+ swings the sword arm wider
#                           to the character's left and back, so a blade drawn behind the body
#                           crosses further out from the flank without rising into the neck)
#   VESPER_ARM_OUT_SPAN=u0,u1,u2,u3  smoothstep in over u0..u1, hold to u2, out over u2..u3
#   VESPER_PIVOT_SPAN=u0,u1,u2,u3  smoothstep 0 -> PIVOT over u0..u1, hold to u2, smoothstep to
#                           PIVOT_END over u2..u3 (fractions of the output clip; default 0,0.3,0.55,1)
#   VESPER_LEFT_ARM         guard (default) | source
#   VESPER_FINGERS          guard (default) | source
#   VESPER_SOCKET_ROLL_DEG  constant roll of the sword about the forearm axis (grip correction)
#   VESPER_BLADE_ROLL_DEG   constant roll of the sword about its own blade axis (edge direction)
#   VESPER_GUARD_CLIP/_FRAME  where the kept left arm and fingers come from (default idle, 20)
#   VESPER_SHIELD_PULL_DEG  peak retraction of the shield arm about the body's vertical axis
#                           (+ pulls the shield back, away from the opponent) — see below
#   VESPER_SHIELD_DROP_DEG  peak drop of the shield arm about the body's forward axis (+ lowers it)
#   VESPER_SHIELD_SPAN=t0,tp,t1  when that brace happens, as fractions of the output clip
#                           (smoothstep in over t0..tp, out over tp..t1; 0 outside); four values
#                           t0,t1,t2,t3 hold the peak from t1 to t2 (in over t0..t1, out over t2..t3)
#   VESPER_LOOP=1           locomotion loop mode (drift removal + belt speed); default 0 = action
#   VESPER_KEEP_TRAVEL=1    keep the source's horizontal body travel in the hips (a lunge)
#   VESPER_FPS_OUT          output fps (default 30)
import bpy, os, json, math, hashlib
from mathutils import Matrix, Vector, Quaternion

R = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
E = os.environ.get
SRC = os.environ['VESPER_SRC']; SRC_CLIP = E('VESPER_SRC_CLIP')
TARGET = E('VESPER_TARGET', 'light')
BASE = os.environ['VESPER_BASE_BLEND']; BASE_MANIFEST = os.environ['VESPER_BASE_MANIFEST']
OUT = os.environ['VESPER_OUT']; SOURCE = E('VESPER_SOURCE', 'sword library clip')
TRIM = E('VESPER_TRIM'); REF_FRAME = E('VESPER_REF_FRAME'); SKIP = E('VESPER_SKIP')
DURATION_ENV = E('VESPER_DURATION'); EASE = float(E('VESPER_EASE', '0'))
HEADING = E('VESPER_HEADING', 'cut'); YAW_DEG = float(E('VESPER_YAW_DEG', '0'))
LEFT_ARM = E('VESPER_LEFT_ARM', 'guard'); FINGERS = E('VESPER_FINGERS', 'guard')
SOCKET_ROLL = math.radians(float(E('VESPER_SOCKET_ROLL_DEG', '0')))
BLADE_ROLL = math.radians(float(E('VESPER_BLADE_ROLL_DEG', '0')))
GUARD_CLIP = E('VESPER_GUARD_CLIP', 'idle'); GUARD_FRAME = int(E('VESPER_GUARD_FRAME', '20'))
FACING_YAW = E('VESPER_FACING_YAW_DEG')
PIVOT = math.radians(float(E('VESPER_PIVOT_DEG', '0'))); PIVOT_END = math.radians(float(E('VESPER_PIVOT_END_DEG', '0')))
PIVOT_SPAN = [float(v) for v in E('VESPER_PIVOT_SPAN', '0,0.3,0.55,1').split(',')]
ARM_OUT = math.radians(float(E('VESPER_ARM_OUT_DEG', '0')))
ARM_YAW = math.radians(float(E('VESPER_ARM_YAW_DEG', '0')))
ARM_OUT_SPAN = [float(v) for v in E('VESPER_ARM_OUT_SPAN', '0.03,0.2,0.36,0.43').split(',')]

def hold_envelope(u, span):
    u0, u1, u2, u3 = span
    if u <= u0 or u >= u3:
        return 0.0
    if u < u1:
        x = (u - u0) / (u1 - u0); return x * x * (3 - 2 * x)
    if u <= u2:
        return 1.0
    x = (u3 - u) / (u3 - u2); return x * x * (3 - 2 * x)
arm_out_log = []

def pivot_yaw(u):
    """Baked yaw of the pose about the root at clip fraction u (see VESPER_PIVOT_DEG)."""
    if not (PIVOT or PIVOT_END):
        return 0.0
    u0, u1, u2, u3 = PIVOT_SPAN
    if u <= u0:
        return 0.0
    if u < u1:
        x = (u - u0) / (u1 - u0); return PIVOT * x * x * (3 - 2 * x)
    if u <= u2:
        return PIVOT
    if u < u3:
        x = (u - u2) / (u3 - u2); return PIVOT + (PIVOT_END - PIVOT) * x * x * (3 - 2 * x)
    return PIVOT_END
# A frozen shield arm is both lifeless and a collider: the source pack is sword-only, so the kept
# left chain stands exactly still while the sword sweeps through the space the shield occupies
# (measured on the first V16: the light blade crossed the left forearm for 67 ms, the heavy blade
# crossed the shield for 33 ms). Bracing the shield -- pulling it back and down out of the cut and
# returning it to guard -- is what a sword-and-board fighter actually does, and it is applied to
# the LeftShoulder only, so the whole arm, the hand and the hand-relative ShieldSocket follow.
SHIELD_PULL = math.radians(float(E('VESPER_SHIELD_PULL_DEG', '0')))
SHIELD_DROP = math.radians(float(E('VESPER_SHIELD_DROP_DEG', '0')))
SHIELD_SPAN = [float(v) for v in E('VESPER_SHIELD_SPAN', '0,0.5,1').split(',')]
LOOP = E('VESPER_LOOP', '0') == '1'; KEEP_TRAVEL = E('VESPER_KEEP_TRAVEL', '0') == '1'
FPS = int(E('VESPER_FPS_OUT', '30'))
M = 'mixamorig:'

# ---------------------------------------------------------------- bone map and frame recipes
# Our three-bone spine is driven by the source spine joints nearest the same normalised height
# between pelvis and neck (spine_02 at .20 vs our Spine at .20, spine_04 at .49 vs Spine1 at .43,
# spine_05 at .73 vs Spine2 at .70), and because the transfer works on WORLD orientations the
# skipped spine_01/spine_03 rotations are already inside them: the total bend is preserved.
BONE_MAP = {
    M+'Hips': 'pelvis',
    M+'Spine': 'spine_02', M+'Spine1': 'spine_04', M+'Spine2': 'spine_05',
    M+'Neck': 'neck_01', M+'Head': 'head',
    M+'LeftShoulder': 'clavicle_l', M+'LeftArm': 'upperarm_l', M+'LeftForeArm': 'lowerarm_l', M+'LeftHand': 'hand_l',
    M+'RightShoulder': 'clavicle_r', M+'RightArm': 'upperarm_r', M+'RightForeArm': 'lowerarm_r', M+'RightHand': 'hand_r',
    M+'LeftUpLeg': 'thigh_l', M+'LeftLeg': 'calf_l', M+'LeftFoot': 'foot_l', M+'LeftToeBase': 'ball_l',
    M+'RightUpLeg': 'thigh_r', M+'RightLeg': 'calf_r', M+'RightFoot': 'foot_r', M+'RightToeBase': 'ball_r',
}
FINGER_MAP = {}
for side, s in (('Left', 'l'), ('Right', 'r')):
    for ours, theirs in (('Thumb', 'thumb'), ('Index', 'index'), ('Middle', 'middle'), ('Ring', 'ring'), ('Pinky', 'pinky')):
        FINGER_MAP[M+side+'Hand'+ours+'1'] = (theirs+'_01_'+s, theirs+'_02_'+s)
        FINGER_MAP[M+side+'Hand'+ours+'2'] = (theirs+'_02_'+s, theirs+'_03_'+s)
LEFT_CHAIN = [M+'LeftShoulder', M+'LeftArm', M+'LeftForeArm', M+'LeftHand']

# Each recipe is (u_from, u_to, secondary) named with OUR bones; the source points come from
# BONE_MAP, so exactly the same anatomy is measured on both skeletons.
def recipes():
    r = {}
    r[M+'Hips'] = (M+'Hips', M+'Spine', ('lat', 0.0))
    r[M+'Spine'] = (M+'Spine', M+'Spine1', ('lat', .35))
    r[M+'Spine1'] = (M+'Spine1', M+'Spine2', ('lat', .7))
    r[M+'Spine2'] = (M+'Spine2', M+'Neck', ('lat', 1.0))
    r[M+'Neck'] = (M+'Neck', M+'Head', ('lat', 1.0))
    r[M+'Head'] = (M+'Neck', M+'Head', ('lat', 1.0))
    for side in ('Left', 'Right'):
        p = M + side
        r[p+'Shoulder'] = (p+'Shoulder', p+'Arm', ('seg', M+'Spine2', M+'Neck'))
        r[p+'Arm'] = (p+'Arm', p+'ForeArm', ('seg', p+'ForeArm', p+'Hand'))          # elbow plane
        r[p+'ForeArm'] = (p+'ForeArm', p+'Hand', ('seg', p+'HandPinky1', p+'HandIndex1'))
        r[p+'Hand'] = (p+'Hand', p+'HandMiddle1', ('seg', p+'HandPinky1', p+'HandIndex1'))
        r[p+'UpLeg'] = (p+'UpLeg', p+'Leg', ('hinge', p+'UpLeg', p+'Leg', p+'Foot'))  # knee axis
        r[p+'Leg'] = (p+'Leg', p+'Foot', ('seg', p+'Foot', p+'ToeBase'))
        r[p+'Foot'] = (p+'Foot', p+'ToeBase', ('seg', p+'Foot', p+'Leg'))
        r[p+'ToeBase'] = (p+'Foot', p+'ToeBase', ('seg', p+'Foot', p+'Leg'))
        for ours in ('Thumb', 'Index', 'Middle', 'Ring', 'Pinky'):
            r[p+'Hand'+ours+'1'] = (p+'Hand'+ours+'1', p+'Hand'+ours+'2', ('seg', p+'HandPinky1', p+'HandIndex1'))
            r[p+'Hand'+ours+'2'] = (p+'Hand'+ours+'2', p+'Hand'+ours+'3', ('seg', p+'HandPinky1', p+'HandIndex1'))
    return r
RECIPE = recipes()

def ortho(u, v):
    e1 = u.normalized()
    w = v - e1 * v.dot(e1)
    if w.length < 1e-6:
        return None
    e2 = w.normalized()
    return Matrix((e1, e2, e1.cross(e2))).transposed()   # columns e1,e2,e3

def build_frame(name, P, lat_hips, lat_chest):
    """PHI for one of our bone names, from a position lookup P(our_bone_name)."""
    spec = RECIPE.get(name)
    if spec is None:
        return None
    a, b, sec = spec
    if P(a) is None or P(b) is None:
        return None
    u = P(b) - P(a)
    if u.length < 1e-6:
        return None
    if sec[0] == 'lat':
        f = sec[1]
        v = (lat_hips * (1 - f) + lat_chest * f)
    elif sec[0] == 'seg':
        if P(sec[1]) is None or P(sec[2]) is None:
            return None
        v = P(sec[2]) - P(sec[1])
    else:   # knee hinge: the axis the knee turns about, which for a straight neutral leg is the
            # body's own lateral axis, and for a bent leg the normal of the hip-knee-ankle plane
        hip, knee, ankle = (P(sec[1]), P(sec[2]), P(sec[3]))
        if hip is None or knee is None or ankle is None:
            return None
        a1 = (knee - hip).normalized(); a2 = (ankle - knee).normalized()
        axis = a1.cross(a2)
        lat = lat_hips
        v = (axis.normalized() * (1 if axis.dot(lat) >= 0 else -1)) if axis.length > math.sin(math.radians(8)) else lat
    frame = ortho(u, v)
    return frame

# ---------------------------------------------------------------- open the bundle
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.open_mainfile(filepath=R + '/' + BASE)
scene = bpy.context.scene
rig = next(o for o in scene.objects if o.type == 'ARMATURE')
bones = rig.pose.bones
inv = rig.matrix_world.inverted()
Ra = rig.matrix_world.to_3x3().normalized()
body = next(o for o in scene.objects if o.type == 'MESH' and not o.hide_render)
tracks = list(rig.animation_data.nla_tracks)
for t in tracks:
    t.mute = True

def update():
    bpy.context.view_layer.update()

def wm(n):
    return rig.matrix_world @ bones[n].matrix

def snapshot():
    return {b.name: (b.location.copy(), b.rotation_quaternion.copy(), b.scale.copy()) for b in bones}

def restore(p):
    for n, (l, q, s) in p.items():
        b = bones[n]; b.location = l; b.rotation_quaternion = q; b.scale = s
    update()

# The guard pose that the untransferred bones keep (shield arm, both grips).
guard_action = next(t for t in tracks if t.name == GUARD_CLIP).strips[0].action
rig.animation_data.action = guard_action
rig.animation_data.action_slot = guard_action.slots[0]
scene.frame_set(GUARD_FRAME); update()
guard_basis = {b.name: b.matrix_basis.copy() for b in bones}

# Hand-relative sockets, read off the clip being replaced exactly as the action script does. A
# target that does not exist yet (the combo's second hit, light2) takes them from the light.
SOCKET_CLIP = E('VESPER_SOCKET_CLIP', TARGET if any(t.name == TARGET for t in tracks) else 'light')
old = next(t for t in tracks if t.name == SOCKET_CLIP).strips[0].action
rig.animation_data.action = old
rig.animation_data.action_slot = old.slots[0]
scene.frame_set(0); update()
sw = wm(M+'RightHand').inverted() @ wm('WeaponSocket')
sh = wm(M+'LeftHand').inverted() @ wm('ShieldSocket')
rig.animation_data.action = None
for b in bones:
    b.matrix_basis.identity()
update()

# our rest, in world space
rest_world_rot = {b.name: (Ra @ b.matrix_local.to_3x3().normalized()) for b in rig.data.bones}
rest_world_pos = {b.name: (rig.matrix_world @ b.matrix_local.translation) for b in rig.data.bones}
def P_ours(n):
    return rest_world_pos.get(n)
lat_hips_o = (P_ours(M+'LeftUpLeg') - P_ours(M+'RightUpLeg')).normalized()
lat_chest_o = (P_ours(M+'LeftShoulder') - P_ours(M+'RightShoulder')).normalized()
UP = Vector((0, 0, 1))
our_forward = lat_hips_o.cross(UP); our_forward.z = 0; our_forward.normalize()

# ---------------------------------------------------------------- import the source clip
before = set(bpy.data.objects)
bpy.ops.import_scene.fbx(filepath=R + '/' + SRC, automatic_bone_orientation=False, ignore_leaf_bones=False)
imported = [o for o in bpy.data.objects if o not in before]
src = next(o for o in imported if o.type == 'ARMATURE')
src_bones = src.pose.bones
src_fps = scene.render.fps / (scene.render.fps_base or 1)
raw = next((a for a in bpy.data.actions if a.name == SRC_CLIP), None) if SRC_CLIP else (src.animation_data.action if src.animation_data else None)
if raw is None:
    raise SystemExit('no source action; actions: ' + ', '.join(a.name for a in bpy.data.actions)[:400])
src.animation_data.action = raw
if hasattr(raw, 'slots') and len(raw.slots):
    src.animation_data.action_slot = raw.slots[0]
missing = [v for v in BONE_MAP.values() if v not in src.data.bones]
if missing:
    raise SystemExit('source is missing bones: ' + ', '.join(missing))

# POS_MAP always resolves fingers, because the forearm and hand frames are built from the
# index-to-pinky lateral even when the fingers themselves keep the guard grip.
POS_MAP = {**BONE_MAP, **{k: v[0] for k, v in FINGER_MAP.items()}}
full = BONE_MAP if FINGERS != 'source' else POS_MAP
driven = {k: v for k, v in full.items() if k in rig.data.bones}
if LEFT_ARM == 'guard':
    driven = {k: v for k, v in driven.items() if k not in LEFT_CHAIN}
kept = [b.name for b in rig.data.bones if b.name not in driven and b.name not in ('WeaponSocket', 'ShieldSocket')]

def src_world(name):
    return (src.matrix_world.to_3x3().normalized() @ src_bones[name].matrix.to_3x3().normalized())

def src_pos(name):
    return src.matrix_world @ src_bones[name].head

def P_src(our_name):
    """Position lookup in OUR bone vocabulary, resolved through the source-bone map."""
    s = POS_MAP.get(our_name)
    if s is None or s not in src_bones:
        return None
    return src_pos(s)

# frame range
f0, f1 = (int(v) for v in TRIM.split(',')) if TRIM else (int(raw.frame_range[0]), int(raw.frame_range[1]))
t_ref = int(REF_FRAME) if REF_FRAME else f0

# ---------------------------------------------------------------- pass 1: hand speed, heading
scene.frame_set(f0); update()
rel = {}; lat_src_by_frame = {}; pelvis_world = {}
for f in range(f0, f1 + 1):
    scene.frame_set(f); update()
    rel[f] = (src_pos('hand_r') - src_pos('pelvis'))
    lat_src_by_frame[f] = (src_pos('thigh_l') - src_pos('thigh_r')).normalized()
    pelvis_world[f] = src_pos('pelvis')
speed = {f0: 0.0}
for f in range(f0 + 1, f1 + 1):
    speed[f] = (rel[f] - rel[f - 1]).length * src_fps
peak = max(speed.values()); pk = max(speed, key=lambda f: speed[f])
a0 = pk
while a0 > f0 and speed[a0 - 1] > .5 * peak:
    a0 -= 1
a1 = pk
while a1 < f1 and speed[a1 + 1] > .5 * peak:
    a1 += 1
still = [f for f in range(f0, a0) if speed[f] < .12 * peak][:12] or [f0]
heading_frames = list(range(a0, a1 + 1)) if HEADING == 'cut' else (still if HEADING == 'guard' else [t_ref])
lat_sum = Vector((0, 0, 0))
for f in heading_frames:
    lat_sum += lat_src_by_frame[f]
src_forward = lat_sum.normalized().cross(UP); src_forward.z = 0; src_forward.normalize()
yaw_fix = math.atan2(our_forward.cross(src_forward).z, our_forward.dot(src_forward))
if HEADING == 'fixed':
    # The whole yaw is given: the caller wants this clip in another clip's heading frame (a chained
    # hit whose first frame must be continuous with the clip it follows), and the cut is turned
    # toward the opponent at runtime through the manifest's facingYawDegrees instead.
    yaw_fix = 0.0
G = Matrix.Rotation(-yaw_fix + math.radians(YAW_DEG), 3, 'Z')

# ---------------------------------------------------------------- per-bone rest alignment Q
scene.frame_set(t_ref); update()
lat_hips_s = (src_pos('thigh_l') - src_pos('thigh_r')).normalized()
lat_chest_s = (src_pos('clavicle_l') - src_pos('clavicle_r')).normalized()
Q = {}; align_report = {}
for n in driven:
    phi_s = build_frame(n, P_src, lat_hips_s, lat_chest_s)
    phi_o = build_frame(n, P_ours, lat_hips_o, lat_chest_o)
    if phi_s is None or phi_o is None:
        # A degenerate frame would silently leave a bone rotated by a constant offset.
        raise SystemExit('rest alignment frame is degenerate for ' + n)
    Q[n] = phi_s @ phi_o.inverted()
    align_report[n] = round(math.degrees(Q[n].to_quaternion().angle), 1)
ref_world = {n: src_world(driven[n]) for n in driven}
ref_pelvis = src_pos('pelvis').copy()
leg_src = (src_pos('thigh_l') - src_pos('foot_l')).length
leg_ours = (P_ours(M+'LeftUpLeg') - P_ours(M+'LeftFoot')).length
leg_ratio = leg_ours / leg_src if leg_src > 1e-6 else 1.0
hips_rest_world = P_ours(M+'Hips').copy()

# ---------------------------------------------------------------- sampling plan
skip = [int(v) for v in SKIP.split(',')] if SKIP else [f1, f1, 0]
skip0, skip1 = skip[0], skip[1]; keep_frames = skip[2] if len(skip) > 2 else 0
if not (f0 <= skip0 <= skip1 <= f1):
    raise SystemExit('skip %d,%d outside trim %d,%d' % (skip0, skip1, f0, f1))
L = (f1 - f0) - (skip1 - skip0) + keep_frames

def src_frame(u):
    a = skip0 - f0
    if u <= a:
        return f0 + u
    if u <= a + keep_frames:
        return skip0 + (u - a) * (skip1 - skip0) / max(1, keep_frames)
    return f0 + u - keep_frames + (skip1 - skip0)

DURATION = float(DURATION_ENV) if DURATION_ENV else L / src_fps
N = max(2, round(DURATION * FPS)); DURATION = N / FPS
stretch = (L / src_fps) / DURATION   # >1 means the take is played faster than recorded

def ease(u):
    if EASE <= 0:
        return u
    s = u * u * (3 - 2 * u)
    return u + (s - u) * EASE

order = sorted([b.name for b in rig.data.bones if b.name not in ('WeaponSocket', 'ShieldSocket')],
               key=lambda n: len(rig.data.bones[n].parent_recursive))
body.hide_viewport = True

# The source skeleton spreads forearm pronation over lowerarm_twist_01/02, which our rig does not
# have, so a straight bone-for-bone copy leaves the whole roll of a cut (up to 148 degrees on
# hit1) between the hand and the forearm: the wrist reads as turned inside out, the very thing
# the user rejected in V10. Rolling the FOREARM about its own axis and leaving the hand's world
# orientation untouched moves that roll to where a forearm actually pronates. It is a pure
# deformation fix: the hand, the socket and therefore the blade do not move at all.
WRIST_MAX = math.radians(float(E('VESPER_WRIST_TWIST_MAX', '25')))
FORE_MAX = math.radians(float(E('VESPER_FOREARM_TWIST_MAX', '120')))
TWIST_PAIRS = [(M+'RightForeArm', M+'RightHand')] + ([(M+'LeftForeArm', M+'LeftHand')] if LEFT_ARM == 'source' else [])
twist_log = []

def swing_twist(q, axis):
    """Signed rotation of q about `axis` (the twist half of a swing-twist split), in (-pi, pi]."""
    if q.w < 0:
        q = Quaternion((-q.w, -q.x, -q.y, -q.z))
    a = 2 * math.atan2(Vector((q.x, q.y, q.z)).dot(axis), q.w)
    return (a + math.pi) % (2 * math.pi) - math.pi

def redistribute_twist(world_rot):
    for fore, hand in TWIST_PAIRS:
        if fore not in world_rot or hand not in world_rot:
            continue
        # the forearm's own long axis, expressed in the forearm's bone frame
        d = (rest_world_rot[fore].inverted() @ (rest_world_pos[hand] - rest_world_pos[fore])).normalized()
        bind_rel = (rest_world_rot[fore].inverted() @ rest_world_rot[hand]).to_quaternion()
        rel = (world_rot[fore].inverted() @ world_rot[hand]).to_quaternion()
        theta = swing_twist((bind_rel.inverted() @ rel).normalized(), d)
        excess = abs(theta) - WRIST_MAX
        phi = math.copysign(min(max(0.0, excess), FORE_MAX), theta)
        twist_log.append((round(math.degrees(theta), 1), round(math.degrees(phi), 1)))
        if abs(phi) > 1e-6:
            axis = (world_rot[fore] @ d).normalized()
            world_rot[fore] = Matrix.Rotation(phi, 3, axis) @ world_rot[fore]
    return world_rot

def shield_weight(u):
    """Smooth 0 -> 1 -> 0 brace envelope over VESPER_SHIELD_SPAN (fractions of the output clip)."""
    if len(SHIELD_SPAN) == 4:
        return hold_envelope(u, SHIELD_SPAN)
    t0, tp, t1 = SHIELD_SPAN
    if u <= t0 or u >= t1:
        return 0.0
    x = (u - t0) / (tp - t0) if u < tp and tp > t0 else ((t1 - u) / (t1 - tp) if t1 > tp else 1.0)
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)

# The brace axes, in ARMATURE space: world up (yaw the arm back) and our forward (drop the arm).
brace_up = (Ra.inverted() @ Vector((0, 0, 1))).normalized()
brace_fwd = (Ra.inverted() @ our_forward).normalized()
brace_log = []

def retarget(u=0.0):
    # Every driven bone's world rotation is absolute, so it is computed before the FK sweep and
    # the twist redistribution can see both ends of the forearm. The heading G may carry a baked
    # pivot that ramps over the clip (VESPER_PIVOT_DEG); it turns orientations and the hips travel
    # alike, i.e. the whole pose about the root's vertical axis.
    Gu = Matrix.Rotation(pivot_yaw(u), 3, 'Z') @ G
    brace_fwd_u = (Ra.inverted() @ (Matrix.Rotation(pivot_yaw(u), 3, 'Z') @ our_forward)).normalized()
    world_rot = {n: Gu @ (src_world(driven[n]) @ ref_world[n].inverted()) @ Q[n] @ rest_world_rot[n] for n in driven}
    if ARM_OUT or ARM_YAW:
        w = hold_envelope(u, ARM_OUT_SPAN)
        if w > 1e-6:
            # The body's forward axis at this frame (pelvis lateral x up), after the heading and pivot.
            lat = (Gu @ (src_pos('thigh_l') - src_pos('thigh_r'))).normalized()
            fwd = lat.cross(UP).normalized()
            turn = Matrix.Rotation(ARM_YAW * w, 3, UP) @ Matrix.Rotation(ARM_OUT * w, 3, fwd)
            for n in (M+'RightArm', M+'RightForeArm', M+'RightHand'):
                if n in world_rot:
                    world_rot[n] = turn @ world_rot[n]
            arm_out_log.append(round(math.degrees(ARM_OUT * w), 1))
    redistribute_twist(world_rot)
    posed = {}
    for n in order:
        bone = rig.data.bones[n]; parent = bone.parent
        base = (posed[parent.name] @ parent.matrix_local.inverted() @ bone.matrix_local) if parent and parent.name in posed else bone.matrix_local.copy()
        if n in driven:
            rot = (Ra.inverted() @ world_rot[n]).to_4x4()
            if n == M+'Hips':
                d = Gu @ ((src_pos('pelvis') - ref_pelvis) * leg_ratio)
                target_world = Vector((hips_rest_world.x + (d.x if KEEP_TRAVEL else 0),
                                       hips_rest_world.y + (d.y if KEEP_TRAVEL else 0),
                                       hips_rest_world.z + d.z))
                t = (inv @ target_world)
            else:
                t = base.translation.copy()
            desired = Matrix.Translation(t) @ rot
        else:
            desired = base @ guard_basis[n]
            if n == M+'LeftShoulder' and (SHIELD_PULL or SHIELD_DROP):
                w = shield_weight(u)
                if w > 1e-6:
                    pivot = desired.translation.copy()
                    turn = Matrix.Rotation(SHIELD_PULL * w, 4, brace_up) @ Matrix.Rotation(SHIELD_DROP * w, 4, brace_fwd_u)
                    desired = Matrix.Translation(pivot) @ turn @ Matrix.Translation(-pivot) @ desired
                    brace_log.append(round(math.degrees(SHIELD_PULL * w), 1))
        basis = base.inverted() @ desired
        pb = bones[n]
        pb.location, pb.rotation_quaternion, pb.scale = basis.decompose()
        pb.scale = Vector((1, 1, 1))
        posed[n] = desired
    update()

samples = []; travel = []
for i in range(N + 1):
    sf = src_frame(L * ease(i / N))
    scene.frame_set(int(sf), subframe=sf - int(sf))
    retarget(i / N)
    samples.append(snapshot())
    d = (Matrix.Rotation(pivot_yaw(i / N), 3, 'Z') @ G) @ ((src_pos('pelvis') - ref_pelvis) * leg_ratio)
    travel.append(Vector((d.x, d.y, 0)))
src.animation_data.action = None
body.hide_viewport = False

# ---------------------------------------------------------------- grounding (skinned soles)
footgroups = {g.index for g in body.vertex_groups if any(k in g.name for k in ('Foot', 'ToeBase'))}
footverts = [v.index for v in body.data.vertices if sum(g.weight for g in v.groups if g.group in footgroups) > .5]

def lowest_foot():
    ev = body.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = ev.to_mesh()
    zs = sorted((ev.matrix_world @ mesh.vertices[i].co).z for i in footverts)
    ev.to_mesh_clear()
    return zs[int(len(zs) * .008)]

poses = []; lows = []
start, last = samples[0], samples[N]
for i in range(N + 1):
    u = i / N if LOOP else 0
    p = samples[i]
    for n, (loc, q, scl) in p.items():
        b = bones[n]
        if LOOP:
            l0, q0, s0 = start[n]; le, qe, se = last[n]
            fix = Quaternion().slerp(q0 @ qe.inverted(), u)
            b.location = loc + (l0 - le) * u; b.rotation_quaternion = fix @ q; b.scale = scl
        else:
            b.location = loc; b.rotation_quaternion = q; b.scale = scl
    update()
    poses.append(snapshot()); lows.append(lowest_foot())
floor_z = min(lows)
support = [z < floor_z + .025 for z in lows]
# The runtime samples these 30 fps keys at 60 fps and blends in and out of neighbouring clips, so
# a sole baked exactly on the floor dips a few millimetres under it in play (audit-runtime-soles
# fails below -3 mm). VESPER_SOLE_CLEARANCE is the margin baked in; 10 mm on a 1.85 m body.
CLEARANCE = float(E('VESPER_SOLE_CLEARANCE', '.010'))
planted = [-(z - CLEARANCE) for z in lows]
fix = [None] * (N + 1)
idx = [i for i in range(N + 1) if support[i]] or [0]
for i in range(N + 1):
    if support[i]:
        fix[i] = planted[i]; continue
    prev = max((j for j in idx if j < i), default=None)
    nxt = min((j for j in idx if j > i), default=None)
    if prev is None:
        fix[i] = planted[nxt]
    elif nxt is None:
        fix[i] = planted[prev]
    else:
        t = (i - prev) / (nxt - prev); fix[i] = planted[prev] * (1 - t) + planted[nxt] * t
    fix[i] = max(fix[i], planted[i])

corrected = []; foot_track = []
for i in range(N + 1):
    restore(poses[i])
    hmz = wm(M+'Hips'); hmz.translation.z += fix[i]
    bones[M+'Hips'].matrix = inv @ hmz
    update()
    hand_m = wm(M+'RightHand')
    seated = hand_m @ sw
    if SOCKET_ROLL or BLADE_ROLL:
        if SOCKET_ROLL:
            axis = (hand_m.translation - wm(M+'RightForeArm').translation).normalized()
            o = hand_m.translation.copy()
            seated = Matrix.Translation(o) @ Matrix.Rotation(SOCKET_ROLL, 4, axis) @ Matrix.Translation(-o) @ seated
        if BLADE_ROLL:
            axis = seated.to_3x3().col[2].normalized()
            o = seated.translation.copy()
            seated = Matrix.Translation(o) @ Matrix.Rotation(BLADE_ROLL, 4, axis) @ Matrix.Translation(-o) @ seated
    bones['WeaponSocket'].matrix = inv @ seated
    bones['ShieldSocket'].matrix = inv @ (wm(M+'LeftHand') @ sh)
    update()
    corrected.append(snapshot())
    foot_track.append({s: (wm(M+s+'ToeBase').translation.copy(), wm(M+s+'Foot').translation.copy()) for s in ('Left', 'Right')})

# foot slip: horizontal travel of a toe while it is on the floor
slip = 0.0
for i in range(1, N + 1):
    for s in ('Left', 'Right'):
        # Planted only when the toe is down in BOTH frames; a swing foot skimming the floor
        # during a lunge is not a slip.
        if max(min(foot_track[i][s][0].z, foot_track[i][s][1].z),
               min(foot_track[i - 1][s][0].z, foot_track[i - 1][s][1].z)) < floor_z + .04:
            d = foot_track[i][s][0] - foot_track[i - 1][s][0]
            slip = max(slip, math.hypot(d.x, d.y) * FPS)

# ---------------------------------------------------------------- bake and export
new = bpy.data.actions.new('library-' + TARGET)
rig.animation_data.action = new
rig.animation_data.action_slot = new.slots[0] if len(new.slots) else None
for i, p in enumerate(corrected):
    for n, (loc, q, scl) in p.items():
        b = bones[n]
        b.location = loc; b.rotation_quaternion = q; b.scale = scl
        b.keyframe_insert('location', frame=i)
        b.keyframe_insert('rotation_quaternion', frame=i)
        b.keyframe_insert('scale', frame=i)
new.use_fake_user = True
rig.animation_data.action = None
for b in bones:
    b.matrix_basis.identity()
track = next((t for t in tracks if t.name == TARGET), None)
if track is None:
    # A clip the bundle never had (light2): its own NLA track, exported as a clip of that name.
    track = rig.animation_data.nla_tracks.new()
    track.name = TARGET
    tracks.append(track)
for strip in list(track.strips):
    track.strips.remove(strip)
track.strips.new(TARGET, 0, new)
for o in imported:
    bpy.data.objects.remove(o, do_unlink=True)
for t in tracks:
    t.mute = False
# The FBX importer adopted the source's frame rate (60 fps for hit4_RM); the glTF exporter uses
# the scene rate to time the baked keys, so put it back before exporting.
scene.render.fps = FPS; scene.render.fps_base = 1.0
bpy.ops.object.select_all(action='DESELECT')
rig.select_set(True); body.select_set(True)
bpy.context.view_layer.objects.active = rig
dest = R + '/' + OUT
os.makedirs(os.path.dirname(dest), exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=dest + '.blend')
bpy.ops.export_scene.gltf(filepath=dest + '.glb', use_selection=True, export_format='GLB',
                          export_animations=True, export_animation_mode='NLA_TRACKS', export_nla_strips=True,
                          export_frame_range=False, export_force_sampling=True, export_skins=True, export_materials='EXPORT')

windup = (a0 - f0) / src_fps / stretch
active = (a1 - a0 + 1) / src_fps / stretch
recovery = max(0.0, DURATION - windup - active)
forward_travel = [round(v.dot(our_forward), 4) for v in travel]
lateral_travel = [round(v.dot(our_forward.cross(UP)), 4) for v in travel]
meta = json.load(open(R + '/' + BASE_MANIFEST))
meta.update({'asset': OUT + '.glb', 'revision': 'library-candidate-2026-09-16',
             'previousCandidateSha256': meta['sha256'],
             'sha256': hashlib.sha256(open(dest + '.glb', 'rb').read()).hexdigest(),
             'reviewStatus': 'candidate: ' + TARGET + ' replaced by a sword library clip; studio review required'})
prev = meta['clips'].get(TARGET, {})
entry = {'duration': DURATION, 'blendIn': prev.get('blendIn', .1), 'sourceFrames': [f0, f1],
         'source': SOURCE, 'windup': round(windup, 4), 'active': round(active, 4),
         'recovery': round(recovery, 4),
         'hitWindows': [[round(windup, 4), round(windup + active, 4)]],
         'facingYawDegrees': float(FACING_YAW) if FACING_YAW is not None else prev.get('facingYawDegrees', 0)}
meta['clips'][TARGET] = entry
json.dump(meta, open(R + '/' + OUT + '-manifest.json', 'w'), indent=1)
json.dump({'src': SRC, 'srcClip': raw.name, 'target': TARGET, 'srcFps': src_fps,
           'trim': [f0, f1], 'refFrame': t_ref, 'skip': [skip0, skip1, keep_frames],
           'outFrames': N, 'duration': DURATION, 'stretch': stretch, 'ease': EASE,
           'drivenBones': len(driven), 'keptBones': kept, 'leftArm': LEFT_ARM, 'fingers': FINGERS,
           'restAlignmentDegrees': align_report, 'legRatio': leg_ratio,
           'headingMode': HEADING, 'headingCorrectionDegrees': round(math.degrees(-yaw_fix), 2),
           'extraYawDegrees': YAW_DEG, 'facingYawDegrees': entry['facingYawDegrees'], 'socketClip': SOCKET_CLIP,
           'pivot': {'degrees': math.degrees(PIVOT), 'endDegrees': math.degrees(PIVOT_END), 'span': PIVOT_SPAN},
           'armOut': {'degrees': math.degrees(ARM_OUT), 'yawDegrees': math.degrees(ARM_YAW), 'span': ARM_OUT_SPAN, 'peakAppliedDegrees': max(arm_out_log) if arm_out_log else 0.0}, 'socketRollDegrees': math.degrees(SOCKET_ROLL),
           'bladeRollDegrees': math.degrees(BLADE_ROLL),
           'shieldBrace': {'pullDegrees': math.degrees(SHIELD_PULL), 'dropDegrees': math.degrees(SHIELD_DROP),
                           'span': SHIELD_SPAN, 'peakAppliedDegrees': max(brace_log) if brace_log else 0.0},
           'handPeakSpeed': round(peak, 3), 'activeFrames': [a0, a1],
           'windup': windup, 'active': active, 'recovery': recovery,
           'wristTwistMaxDegrees': math.degrees(WRIST_MAX), 'forearmTwistCapDegrees': math.degrees(FORE_MAX),
           'sourceWristTwistPeakDegrees': max((abs(a) for a, b in twist_log), default=0),
           'forearmRollPeakDegrees': max((abs(b) for a, b in twist_log), default=0),
           'supportFrames': sum(support), 'maxFootSlipMetresPerSecond': round(slip, 3),
           'keepTravel': KEEP_TRAVEL, 'forwardTravel': forward_travel, 'lateralTravel': lateral_travel,
           }, open(R + '/' + OUT + '-report.json', 'w'), indent=1)
print('CLIP_REPLACED', TARGET, 'frames', f0, f1, '->', N, 'dur', round(DURATION, 3),
      'windup', round(windup, 2), 'active', round(active, 2), 'slip', round(slip, 3), flush=True)
