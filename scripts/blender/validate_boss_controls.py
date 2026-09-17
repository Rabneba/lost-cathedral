"""Reopen the saved rig and exercise every limb control without saving poses."""
import bpy, json, math, os
from mathutils import Matrix, Quaternion, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
OUT = os.path.join(ROOT, 'assets/rigs/reliquary-saint')
bpy.ops.wm.open_mainfile(filepath=os.path.join(OUT, 'reliquary-saint-rig.blend'))
rig = bpy.data.objects['ReliquarySaint_Rig']
chains = json.load(open(os.path.join(OUT, 'rig-anatomy.json')))['chains']

def update():
    rig.update_tag()
    bpy.context.view_layer.update()

def reset():
    for p in rig.pose.bones:
        p.matrix_basis = Matrix.Identity(4)
        if 'IK' in p:
            p['IK'] = 0.0
    update()

results = []
for chain in chains:
    reset()
    end = rig.pose.bones[chain['endBone']]
    before = end.head.copy()
    opposite = chain['key'][:-1] + ('R' if chain['side'] == 'L' else 'L')
    other = next(c for c in chains if c['key'] == opposite)
    other_before = rig.pose.bones[other['endBone']].head.copy()
    lower = rig.pose.bones[chain['ikEnd']]
    lower.rotation_quaternion = Quaternion(Vector((1, 0, 0)), math.radians(20))
    update()
    fk_travel = (end.head - before).length
    opposite_travel = (rig.pose.bones[other['endBone']].head - other_before).length
    reset()
    ctrl = rig.pose.bones[chain['contactControl']]
    target = ctrl.matrix.copy()
    target.translation = lower.parent.head.lerp(end.head, .92)
    ctrl.matrix = target
    ctrl['IK'] = 1.0
    update()
    ik_error = (end.head - ctrl.head).length
    results.append(dict(limb=chain['key'], fkTravelMetres=fk_travel,
                        oppositeTravelMetres=opposite_travel, ikErrorMetres=ik_error))

reset()
feet = [rig.pose.bones['DEF_leg_02.' + side] for side in ['L', 'R']]
foot_before = [p.matrix.copy() for p in feet]
for side in ['L', 'R']:
    rig.pose.bones['CTRL_contact_leg.' + side]['IK'] = 1.0
update()
body = rig.pose.bones['CTRL_body']
lowered = body.matrix.copy()
lowered.translation.z -= .52
body.matrix = lowered
update()
foot_errors = [(p.head - before.translation).length for p, before in zip(feet, foot_before)]
reset()
assert len(chains) == 10
assert len(bpy.data.actions) == 0
assert all(r['fkTravelMetres'] > .01 and r['oppositeTravelMetres'] < 1e-5
           and r['ikErrorMetres'] < .01 for r in results), results
assert max(foot_errors) < .01, foot_errors
assert bpy.data.objects['ReliquarySaint_Blade'].vertex_groups[0].name == 'DEF_weapon_socket.R'
report = dict(passed=True, reopenedSavedBlend=True, limbs=results,
              plantedFootErrorMetres=foot_errors, animationActions=len(bpy.data.actions))
with open(os.path.join(OUT, 'control-validation.json'), 'w') as f:
    json.dump(report, f, indent=2)
print('CONTROL_VALIDATION', json.dumps(report), flush=True)
