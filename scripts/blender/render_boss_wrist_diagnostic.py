"""Separate close skin review using existing model/materials, no saved blend."""
import os,sys
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'))
tag=os.environ.get('VESPER_WRIST_TAG','v2')
blend=os.environ.get('VESPER_WRIST_BLEND','/tmp/vesper-boss-candidate-v2.blend')
sys.argv=['blender','--',blend,'slam','docs/combat-revision/wrist-'+tag,'assets/idle-video-motion/scythe-fitted.glb','2.85']
setup=open(os.path.join(ROOT,'scripts/blender/render_boss_combat_contactsheet.py')).read().split('frames=[round(end*i/11) for i in range(12)]')[0]
exec(compile(setup,'render_boss_combat_contactsheet.py','exec'))
for t in rig.animation_data.nla_tracks:t.mute=True
track=next(t for t in rig.animation_data.nla_tracks if t.name=='slam');strip=track.strips[0]
rig.animation_data.action=strip.action;rig.animation_data.action_slot=strip.action_slot
scene.frame_set(32);bpy.context.view_layer.update()
wm=rig.matrix_world@rig.pose.bones['WeaponSocket'].matrix
for o in props:o.matrix_world=wm
hand=(rig.matrix_world@rig.pose.bones['mixamorig:LeftHand'].matrix).translation
elbow=(rig.matrix_world@rig.pose.bones['mixamorig:LeftForeArm'].matrix).translation
target=(hand+elbow)*.5
camera.data.ortho_scale=1.05;scene.render.resolution_x=640;scene.render.resolution_y=640
for name,offset in [('front',Vector((1.6,-2,1.0))),('side',Vector((-2,-.8,.65)))]:
 camera.location=target+offset;camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler()
 scene.render.filepath=os.path.join(render_dir,'slam-left-worst-'+name+'.png')
 bpy.ops.render.render(write_still=True)
print('WRIST_DIAGNOSTICS_RENDERED',render_dir)
