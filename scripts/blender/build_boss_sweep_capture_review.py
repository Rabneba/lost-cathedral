"""Sparse actual-material sweep inspection; writes only uniquely named diagnostics."""
import os, sys
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'))
blend=os.environ.get('VESPER_SWEEP_BLEND','assets/combat-revision/boss/v71-sweep-captured-fk-baseline/boss-combat-candidate.blend')
tag=os.environ.get('VESPER_SWEEP_REVIEW_TAG','raw')
frames=[int(x)for x in os.environ.get('VESPER_SWEEP_FRAMES','40,60,80,110').split(',')]
sys.argv=['review','--',blend,'sweep','docs/combat-revision/sweep-capture-review','assets/idle-video-motion/scythe-fitted.glb','2.85','1']
setup=open(os.path.join(ROOT,'scripts/blender/render_boss_combat_contactsheet.py')).read().split('destination=')[0]
exec(compile(setup,'render_boss_combat_contactsheet.py','exec'))
scene.render.resolution_x=800;scene.render.resolution_y=700;scene.cycles.samples=8
scene.render.threads_mode='FIXED';scene.render.threads=2
for f in frames:
 scene.frame_set(f);bpy.context.view_layer.update()
 wm=rig.matrix_world@rig.pose.bones['WeaponSocket'].matrix
 for o in props:o.matrix_world=wm
 for view in os.environ.get('VESPER_SWEEP_VIEWS','character').split(','):
  camera.location=(3,-6,3);target=Vector((0,-.1,1.7));camera.data.ortho_scale=4.8
  if view!='character':
   target=sum(((rig.matrix_world@rig.pose.bones['mixamorig:'+s+'Hand'].matrix).translation for s in ['Left','Right']),Vector())*.5
   camera.location=target+{'front':Vector((0,-4,.8)),'side':Vector((4,0,.8)),'top':Vector((0,-.01,4))}[view];camera.data.ortho_scale=1.5
  camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler()
  label=tag if view=='character'else tag+'-'+view
  scene.render.filepath=os.path.join(ROOT,'docs/combat-revision/sweep-capture-%s-%s.png'%(label,f))
  bpy.ops.render.render(write_still=True)
print('SWEEP_CAPTURE_REVIEW_DONE',tag,flush=True)
