# Fast review renders of a retargeted attack candidate, straight out of the candidate .blend.
# The studio page is the authority on how a clip looks in the game, but it reloads an 8 MB GLB
# through SwiftShader for every still; this renders the same skeleton with the real sword and
# shield in a couple of seconds a frame, which is what makes iterating on a retarget practical.
#
#   blender -b --python scripts/blender/player_render_attack_review.py -- <blend> <clip> <out-dir>
#       [times, e.g. 0,.3,.5,.65,.8,1.2] [views, e.g. quarter,side,front,arm]
import bpy, os, sys, math, statistics
from mathutils import Vector, Matrix

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
blend, clip, out = args[0], args[1], args[2]
times = [float(x) for x in args[3].split(',')] if len(args) > 3 else [0, .3, .5, .65, .8, 1.2]
views = args[4].split(',') if len(args) > 4 else ['quarter', 'side', 'front', 'arm']
FPS = 30

bpy.ops.wm.open_mainfile(filepath=ROOT + '/' + blend)
scene = bpy.context.scene
rig = next(o for o in scene.objects if o.type == 'ARMATURE')
rig.animation_data.action = None
for t in rig.animation_data.nla_tracks:
    t.mute = t.name != clip

def prop(path, height, sword=False):
    before = set(scene.objects)
    bpy.ops.import_scene.gltf(filepath=ROOT + '/' + path)
    meshes = [o for o in scene.objects if o not in before and o.type == 'MESH']
    verts = []
    mat = Matrix.Rotation(-math.pi / 2, 4, 'Z') @ (Matrix.Rotation(math.pi, 4, 'Y') if sword else Matrix.Identity(4))
    for o in meshes:
        m = mat @ o.matrix_world
        for v in o.data.vertices:
            v.co = m @ v.co
        o.parent = None
        o.matrix_world.identity()
        verts.extend(v.co.copy() for v in o.data.vertices)
    lo = Vector([min(v[i] for v in verts) for i in range(3)])
    hi = Vector([max(v[i] for v in verts) for i in range(3)])
    center = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
    scale = height / (hi.z - lo.z)
    for o in meshes:
        for v in o.data.vertices:
            v.co = (v.co - center) * scale
    if sword:
        handle = [v.co for o in meshes for v in o.data.vertices if .08 < v.co.z < .25]
        c = Vector((statistics.median(v.x for v in handle), statistics.median(v.y for v in handle), 0))
        for o in meshes:
            for v in o.data.vertices:
                v.co -= c
    return meshes

sword = prop('assets/create-the-exact-isolated-player-sword-s-cmu12ngf.glb', 1.28, True)
# The 1.545 m shield is seated here only by the legacy along-forearm transform, not by the
# manifest's shieldMount, so it would hide the whole torso and tell us nothing: the left arm is
# frozen at the V15 guard pose anyway, so the shield is verified in the studio stills instead.
shield = prop('assets/create-the-exact-isolated-player-shield-cmu12nf3.glb', 1.545) if (len(args) > 5 and args[5] == 'shield') else []
def seat_props():
    sw = rig.matrix_world @ rig.pose.bones['WeaponSocket'].matrix
    sh = rig.matrix_world @ rig.pose.bones['ShieldSocket'].matrix @ Matrix.Rotation(math.pi / 2, 4, 'Z')
    for o in sword:
        o.matrix_world = sw
    for o in shield:
        o.matrix_world = sh

scene.world = bpy.data.worlds.new('review world')
scene.world.use_nodes = True
scene.world.node_tree.nodes['Background'].inputs[0].default_value = (.13, .15, .18, 1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value = .6
bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 0, 0))
floor = bpy.context.object
m = bpy.data.materials.new('Floor'); m.diffuse_color = (.12, .14, .16, 1)
floor.data.materials.append(m)
for loc, energy, size in [((-3, -4, 6), 900, 5), ((4, -2, 3), 600, 4), ((2, 3, 5), 900, 3)]:
    d = bpy.data.lights.new('rev', 'AREA'); d.energy = energy; d.shape = 'DISK'; d.size = size
    o = bpy.data.objects.new('rev', d); scene.collection.objects.link(o)
    o.location = loc
    o.rotation_euler = (Vector((0, 0, 1)) - o.location).to_track_quat('-Z', 'Y').to_euler()

bpy.ops.object.camera_add()
cam = bpy.context.object
scene.camera = cam
cam.data.type = 'ORTHO'
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x, scene.render.resolution_y = 760, 760
scene.view_settings.view_transform = 'AgX'
os.makedirs(ROOT + '/' + out, exist_ok=True)

# The rig faces -Y in this blend (see docs/player-motion-revision-3/README.md), so "front" looks
# from -Y, "side" from +X, "quarter" from front-right.
VIEWS = {
    'quarter': (Vector((3.2, -4.2, 2.4)), Vector((0, 0, .95)), 2.7),
    'side':    (Vector((5.0, 0, 1.4)), Vector((0, 0, .95)), 2.6),
    'front':   (Vector((0, -5.0, 1.5)), Vector((0, 0, .95)), 2.6),
    'back':    (Vector((0, 5.0, 1.5)), Vector((0, 0, .95)), 2.6),
    'feet':    (Vector((2.6, -3.4, 1.1)), Vector((0, 0, .25)), 1.5),
    'arm':     (Vector((2.6, -3.4, 2.0)), Vector((-.35, -.2, 1.25)), 1.1),
    'top':     (Vector((0, -.01, 6)), Vector((0, 0, 1)), 2.8),
}

for view in views:
    loc0, look0, ortho = VIEWS[view]
    for t in times:
        loc, look = loc0.copy(), look0.copy()
        f = t * FPS
        scene.frame_set(int(f), subframe=f - int(f))
        bpy.context.view_layer.update()
        seat_props()
        # keep a lunging clip in frame: the camera tracks the body's horizontal position
        hips = (rig.matrix_world @ rig.pose.bones['mixamorig:Hips'].matrix).translation
        pan = Vector((hips.x, hips.y, 0))
        loc += pan; look += pan
        if view == 'arm':
            # follow the sword hand, so the elbow and wrist stay in frame through the swing
            hand = rig.matrix_world @ rig.pose.bones['mixamorig:RightHand'].matrix
            look = hand.translation.copy()
            loc = look + Vector((2.3, -2.9, .9))
        cam.location = loc
        cam.rotation_euler = (look - loc).to_track_quat('-Z', 'Y').to_euler()
        cam.data.ortho_scale = ortho
        scene.render.filepath = '%s/%s/%s-%s-%03d.png' % (ROOT, out, clip, view, round(t * 100))
        bpy.ops.render.render(write_still=True)
        print('RENDERED', scene.render.filepath, flush=True)
