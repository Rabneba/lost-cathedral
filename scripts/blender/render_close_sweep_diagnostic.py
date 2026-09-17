import sys,os
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'));sys.argv=['diagnostic','--','assets/combat-revision/boss/v57-close-whole/boss-combat-candidate.blend','sweep','docs/combat-revision/sweep-v57','assets/idle-video-motion/scythe-fitted.glb','2.85','1'];setup=open(os.path.join(ROOT,'scripts/blender/render_boss_combat_contactsheet.py')).read().split('destination=')[0];exec(compile(setup,'render_boss_combat_contactsheet.py','exec'));camera.location=(3,-6,2.9);target=Vector((0,-.15,1.65));camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.ortho_scale=5.2;scene.render.resolution_x=900;scene.render.resolution_y=800;scene.cycles.samples=8;scene.render.threads_mode='FIXED';scene.render.threads=2
for f in[20,84,150]:
 scene.frame_set(f);bpy.context.view_layer.update();wm=rig.matrix_world@rig.pose.bones['WeaponSocket'].matrix
 for o in props:o.matrix_world=wm
 scene.render.filepath=os.path.join(ROOT,'docs/combat-revision/boss-sweep-v57-'+str(f)+'.png');bpy.ops.render.render(write_still=True)
print('SWEEP_DIAGNOSTIC_READY',flush=True)
