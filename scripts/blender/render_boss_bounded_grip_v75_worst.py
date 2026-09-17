"""Single actual-material upper-body pose for skinning review."""
import sys,os
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'));sys.argv=['diagnostic','--','assets/combat-revision/boss/v75-slam-bounded-grip-review/boss-combat-candidate.blend','slam','docs/combat-revision/fk-baseline-v67','assets/idle-video-motion/scythe-fitted.glb','2.85','1']
setup=open(os.path.join(ROOT,'scripts/blender/render_boss_combat_contactsheet.py')).read().split('destination=')[0];exec(compile(setup,'render_boss_combat_contactsheet.py','exec'))
scene.render.resolution_x=800;scene.render.resolution_y=800;scene.cycles.samples=12;scene.render.threads_mode='FIXED';scene.render.threads=2
for f in [86]:
 scene.frame_set(f);bpy.context.view_layer.update();wm=rig.matrix_world@rig.pose.bones['WeaponSocket'].matrix
 for o in props:o.matrix_world=wm
 for label,location in [('front',(2,-5,2.6)),('side',(5,.2,2.6))]:
  camera.location=location;target=Vector((0,-.1,1.65));camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.ortho_scale=2.8;scene.render.filepath=os.path.join(ROOT,'docs/combat-revision/boss-bounded-grip-v75-%s-%s.png'%(f,label));bpy.ops.render.render(write_still=True)
print('TURNOVER_CLOSEUPS_DONE',flush=True)
