"""Whole-sequence actual-material proof, streamed directly to MP4."""
import os,sys,json,tempfile,subprocess
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'))
tag=os.environ.get('VESPER_SWEEP_TAG','sweep-capture-close-3')
blend='assets/combat-revision/boss/'+tag+'/boss-combat-candidate.blend'
destination=os.path.join(ROOT,'assets/combat-revision/boss',tag,'sweep-source-paced-proof.mp4')
if os.path.exists(destination):raise FileExistsError(destination)
sys.argv=['review','--',blend,'sweep','unused','assets/idle-video-motion/scythe-fitted.glb','2.85','1']
setup=open(os.path.join(ROOT,'scripts/blender/render_boss_combat_contactsheet.py')).read().split('destination=')[0]
exec(compile(setup,'render_boss_combat_contactsheet.py','exec'))
scene.render.resolution_x=800;scene.render.resolution_y=600;scene.cycles.samples=4
scene.render.threads_mode='FIXED';scene.render.threads=2
camera.location=(3,-6,3);target=Vector((0,-.1,1.7));camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler();bpy.context.view_layer.update()
cameraQ=camera.matrix_world.to_quaternion();cameraInv=cameraQ.inverted();lo=Vector((float('inf'),)*3);hi=-lo
characters=[o for o in scene.objects if o.type=='MESH'and any(m.type=='ARMATURE'for m in o.modifiers)]
frames=list(range(0,198,2))
for f in frames:
 scene.frame_set(f);bpy.context.view_layer.update();wm=rig.matrix_world@rig.pose.bones['WeaponSocket'].matrix
 for o in props:o.matrix_world=wm
 bpy.context.view_layer.update();dg=bpy.context.evaluated_depsgraph_get()
 for o in characters+props:
  ev=o.evaluated_get(dg)
  for c in ev.bound_box:
   p=cameraInv@(ev.matrix_world@Vector(c))
   for k in range(3):lo[k]=min(lo[k],p[k]);hi[k]=max(hi[k],p[k])
mid=(hi+lo)/2;cs=cameraInv@camera.location;cs.x=mid.x;cs.y=mid.y;camera.location=cameraQ@cs;extent=hi-lo;camera.data.ortho_scale=max(extent.x,extent.y*800/600)*1.1
tmp=tempfile.NamedTemporaryFile(prefix='sweep-capture-proof-',suffix='.png',delete=False);tmp.close()
encoder=subprocess.Popen(['/opt/homebrew/bin/ffmpeg','-hide_banner','-loglevel','error','-f','image2pipe','-framerate','15','-i','-','-an','-c:v','libx264','-crf','20','-pix_fmt','yuv420p','-movflags','+faststart',destination],stdin=subprocess.PIPE)
try:
 for f in frames:
  scene.frame_set(f);bpy.context.view_layer.update();wm=rig.matrix_world@rig.pose.bones['WeaponSocket'].matrix
  for o in props:o.matrix_world=wm
  scene.render.filepath=tmp.name;bpy.ops.render.render(write_still=True)
  with open(tmp.name,'rb')as stream:encoder.stdin.write(stream.read())
finally:
 encoder.stdin.close();code=encoder.wait();os.unlink(tmp.name)
 if code:raise RuntimeError('encoder failed '+str(code))
print('SWEEP_CAPTURE_MOVIE_DONE',destination,flush=True)
