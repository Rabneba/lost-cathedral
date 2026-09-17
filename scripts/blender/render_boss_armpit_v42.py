"""Single actual-material upper-body pose for skinning review."""
import sys,os
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'));sys.argv=['diagnostic','--','assets/combat-revision/boss/v42-slam-relaxed-regrip/boss-combat-candidate.blend','slam','docs/combat-revision/armpit-v42','assets/idle-video-motion/scythe-fitted.glb','2.85','1']
setup=open(os.path.join(ROOT,'scripts/blender/render_boss_combat_contactsheet.py')).read().split('destination=')[0];exec(compile(setup,'render_boss_combat_contactsheet.py','exec'))
scene.frame_set(140);bpy.context.view_layer.update();wm=rig.matrix_world@rig.pose.bones['WeaponSocket'].matrix
for o in props:o.matrix_world=wm
camera.location=(2,-5,2.6);target=Vector((.0,-.1,1.65));camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.ortho_scale=2.15;scene.render.resolution_x=1000;scene.render.resolution_y=900;scene.cycles.samples=16;scene.render.threads_mode='FIXED';scene.render.threads=2;scene.render.filepath=os.path.join(ROOT,'docs/combat-revision/boss-armpit-v42-140.png');bpy.ops.render.render(write_still=True);print('ARMPIT_DIAGNOSTIC_READY',flush=True)
