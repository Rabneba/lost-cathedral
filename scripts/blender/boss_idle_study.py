"""A separate boss idle study: supported stance, breathing, carried scythe.

The production file is read only. This writes a review copy with the previous
idle and one new loop. The delivered Uthana body motion is corrected for the stance; equipment follows
the chest and the arms are solved last. No combat animations are replaced.
"""
import bpy, os, json, math, sys
from mathutils import Vector, Matrix, Quaternion

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
OUT = os.path.join(ROOT, 'assets/idle-trial')
os.makedirs(OUT, exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=os.path.join(ROOT, 'assets/production/boss-combat.blend'))
rig = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
body = next(o for o in bpy.context.scene.objects if o.type == 'MESH' and not o.hide_render)
for track in rig.animation_data.nla_tracks:
    track.mute = True
rig.animation_data.action = None
for bone in rig.pose.bones:
    bone.matrix_basis.identity()
bpy.context.view_layer.update()
bones = rig.pose.bones
inverse = rig.matrix_world.inverted()
rest = {p.name: p.matrix_basis.copy() for p in bones}
def B(name): return bones['mixamorig:' + name]
def update(): bpy.context.view_layer.update()
def world(pb): return rig.matrix_world @ pb.matrix
def pos(pb): return world(pb).translation.copy()
rest_positions = {p.name: pos(p) for p in bones}
rest_matrices = {p.name: world(p).copy() for p in bones}
def setworld(pb, matrix):
    pb.matrix = inverse @ matrix
    update()
def rotate(pb, q):
    m = world(pb); p = m.translation.copy()
    setworld(pb, Matrix.Translation(p) @ q.to_matrix().to_4x4() @ Matrix.Translation(-p) @ m)
def aim(pb, child, target):
    before, after = pos(child) - pos(pb), target - pos(pb)
    rotate(pb, before.normalized().rotation_difference(after.normalized()))
def solve(side, target, pole, leg=False):
    names = ('UpLeg', 'Leg', 'Foot') if leg else ('Arm', 'ForeArm', 'Hand')
    a, b, c = (B(side + name) for name in names)
    s, e, w = pos(a), pos(b), pos(c)
    l1, l2 = (e-s).length, (w-e).length
    delta = target-s; axis = delta.normalized()
    d = max(abs(l1-l2)+.001, min(delta.length, l1+l2-.001))
    along = (l1*l1-l2*l2+d*d)/(2*d)
    h = math.sqrt(max(0, l1*l1-along*along))
    bend = pole-s; bend -= axis*bend.dot(axis); bend.normalize()
    aim(a,b,s+axis*along+bend*h); aim(b,c,target)
    return (pos(c)-target).length

feet = {'Right': Vector((-.255,.185,.2132)), 'Left': Vector((.235,-.225,.2078))}
hand_bases = {}
for side in ['Right','Left']:
    h = B(side+'Hand')
    forward = (rest_positions[B(side+'HandMiddle1').name]-rest_positions[h.name]).normalized()
    across = (rest_positions[B(side+'HandIndex1').name]-rest_positions[B(side+'HandPinky1').name]).normalized()
    normal = across.cross(forward).normalized(); across = forward.cross(normal).normalized()
    hand_bases[side] = (Matrix((across,forward,normal)).transposed().to_quaternion(), rest_matrices[h.name].to_quaternion())

# Read the delivered Uthana motion on the same skeleton. Preserve full-body
# rotations, then correct foot contact and the two-handed equipment in Blender.
scene = bpy.context.scene
scene.render.fps = 60
before = set(scene.objects)
bpy.ops.import_scene.gltf(filepath=os.path.join(OUT,'boss-uthana-source.glb'))
source_objects = [o for o in scene.objects if o not in before]
source_rig = next(o for o in source_objects if o.type=='ARMATURE')
source_track = source_rig.animation_data.nla_tracks[0]
source_end = round(source_track.strips[0].frame_end)
source_samples=[]
for f in range(source_end+1):
    scene.frame_set(f);update()
    source_samples.append({p.name:p.matrix_basis.copy() for p in source_rig.pose.bones if p.name.startswith('mixamorig:')})
for o in source_objects: bpy.data.objects.remove(o,do_unlink=True)
FPS, DURATION = 60, 6.4
source_period = source_end-36

def source_pose(t):
    f=(t/DURATION*source_period)%source_period
    a=int(f); alpha=f-a
    sample={n:source_samples[a][n].lerp(source_samples[min(a+1,source_end)][n],alpha)for n in source_samples[0]}
    # Crossfade the final 0.6 s into the start; make the idle a continuous loop.
    if f<36:
        w=f/36;w=w*w*(3-2*w)
        tail=int(source_period+f)
        sample={n:source_samples[min(tail,source_end)][n].lerp(m,w)for n,m in sample.items()}
    return sample

scene.render.fps = FPS
scene.frame_start, scene.frame_end = 0, round(FPS*DURATION)
samples, metrics = [], []

def pose(t):
    for pb in bones: pb.matrix_basis = rest[pb.name].copy()
    update()
    cycle = 2*math.pi*t/DURATION
    breath = math.sin(2*cycle)
    settle = math.sin(cycle)
    for n,m in source_pose(t).items(): bones[n].matrix_basis=m
    update()
    hip=B('Hips');m=world(hip)
    foot_height=sum(pos(B(s+'Foot')).z for s in ['Right','Left'])/2
    m.translation.z-=foot_height-.21-.075
    # The generated crouch pulses by 11 cm. Reduce that to a supported
    # breathing shift, retaining its timing without a repeated squat.
    m.translation.z=1.37+(m.translation.z-1.37)*.3
    m.translation.x+=.012*settle-.025
    m.translation.y+=.006*math.sin(cycle+.3)
    setworld(hip,m)
    rotate(B('Spine'),Quaternion((1,0,0),-.035-.01*breath))
    rotate(B('Spine2'),Quaternion((1,0,0),-.009*breath))
    for side,sign in [('Right',-1),('Left',1)]:
        shoulder=B(side+'Shoulder');sm=world(shoulder);sm.translation.z+=.003*breath;setworld(shoulder,sm)
        target=feet[side]
        solve(side,target,Vector((sign*.34,-1.4,.7)),True)
        fm=world(B(side+'Foot'))
        q=Quaternion((0,0,1),math.radians(sign*-9))@rest_matrices[B(side+'Foot').name].to_quaternion()
        setworld(B(side+'Foot'),Matrix.LocRotScale(target,q,fm.to_scale()))
        for pb in bones:
            if side+'Arm' in pb.name or side+'ForeArm' in pb.name or side+'Hand' in pb.name:pb.matrix_basis=rest[pb.name].copy()
    update()
    # Follow chest motion, with a small breathing lag in the supported prop.
    chest = world(B('Spine2'))
    carry_delta = chest @ rest_matrices[B('Spine2').name].inverted()
    center = carry_delta @ Vector((.02,-.45,1.81))
    center += Vector((.003*math.sin(cycle-.2),-.003*breath,.003*math.sin(2*cycle-.2)))
    axis = carry_delta.to_quaternion() @ Vector((.65,.015,.760))
    axis.normalize()
    blade = Vector((1,0,0)); blade -= axis*blade.dot(axis); blade.normalize()
    depth = axis.cross(blade).normalized()
    wm = Matrix((blade,depth,axis)).transposed().to_4x4()
    wm.translation = center-axis*.88
    setworld(bones['WeaponSocket'],wm)
    errors=[]
    for side, sign, height in [('Right',-1,.6),('Left',1,1.16)]:
        hand=B(side+'Hand'); grip=wm@Vector((0,0,height))
        forward = Vector((0,-1,0)); forward -= axis*forward.dot(axis); forward.normalize()
        across = axis*(-sign); normal=across.cross(forward).normalized()
        target_basis=Matrix((across,forward,normal)).transposed().to_quaternion()
        base, restq=hand_bases[side]
        hq=target_basis@base.inverted()@restq
        palm_length=(rest_positions[B(side+'HandMiddle1').name]-rest_positions[hand.name]).length*.62
        # Palm sits on the near side of the shaft, not through its center.
        wrist=grip-forward*(palm_length+.035)
        pole=Vector((sign*.63,-.04,1.47 if side=='Right' else 1.69))
        errors.append(solve(side,wrist,pole))
        m=world(hand);setworld(hand,Matrix.LocRotScale(m.translation,hq,m.to_scale()))
        for digit in ['Index','Middle','Ring','Pinky']:
            for j, angle in [(1,.55),(2,.85),(3,.7)]:
                rotate(B(side+'Hand'+digit+str(j)),Quaternion(axis*(-sign),angle))
        for j, angle in [(1,.22),(2,.5),(3,.4)]:
            rotate(B(side+'HandThumb'+str(j)),Quaternion(forward,sign*angle))
    update()
    metrics.append({'time':t,'wristError':max(errors),'hips':list(pos(hip)),'chest':list(pos(B('Spine2'))),'grips':[list(wm@Vector((0,0,h)))for h in [.6,1.16]],'feet':[list(pos(B(s+'Foot')))for s in ['Left','Right']]})

for frame in range(scene.frame_end+1):
    scene.frame_set(frame)
    pose(frame/FPS)
    samples.append({p.name:(p.location.copy(),p.rotation_quaternion.copy(),p.scale.copy())for p in bones})

action=bpy.data.actions.new('idle-study');rig.animation_data.action=action
for frame,sample in enumerate(samples):
    for name,(location,rotation,scale) in sample.items():
        p=bones[name];p.location=location;p.rotation_quaternion=rotation;p.scale=scale
        for channel in ['location','rotation_quaternion','scale']:p.keyframe_insert(channel,frame=frame)
rig.animation_data.action=None
for track in list(rig.animation_data.nla_tracks):
    # Retain the old idle as a direct visual comparison in this copy.
    if track.name != 'idle': rig.animation_data.nla_tracks.remove(track)
    else: track.mute=False
track=rig.animation_data.nla_tracks.new();track.name='idle-study'
track.strips.new('idle-study',0,action)
for pb in bones:pb.matrix_basis=rest[pb.name].copy()
scene.frame_set(0);update()
bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);body.select_set(True);bpy.context.view_layer.objects.active=rig
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT,'boss-idle-study.blend'))
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT,'boss-idle-study.glb'),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='NLA_TRACKS',export_nla_strips=True,export_frame_range=False,export_force_sampling=True,export_def_bones=False)
with open(os.path.join(ROOT,'docs/boss-idle-study-measurements.json'),'w')as f:json.dump({'duration':DURATION,'fps':FPS,'maxWristError':max(s['wristError']for s in metrics),'authoring':'Uthana text-to-motion cmu1obgke004j2wp6knq143sw; Blender contact, stance, breathing and loop corrections','samples':metrics},f)
print('IDLE_STUDY_EXPORTED',OUT,flush=True)
