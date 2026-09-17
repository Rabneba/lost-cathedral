"""Render the review rig and its separate, runtime-normalized scythe."""
import bpy, os, sys, math, statistics
from mathutils import Vector, Matrix
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'))
args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
blend=args[0] if args else 'assets/idle-trial/boss-idle-study.blend'
clip=args[1] if len(args)>1 else 'idle-study'
bpy.ops.wm.open_mainfile(filepath=os.path.join(ROOT,blend))
scene=bpy.context.scene
rig=next(o for o in scene.objects if o.type=='ARMATURE')
for t in rig.animation_data.nla_tracks:t.mute=t.name!=clip
rig.animation_data.action=None
before=set(scene.objects)
bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT,args[3] if len(args)>3 else 'assets/exact-isolated-scythe-from-this-image-si-cmu1fy15.glb'))
props=[o for o in scene.objects if o not in before and o.type=='MESH']
if clip in ['uthana-source','video-source']:
 for o in props:o.hide_render=True
verts=[]
for o in props:
 mat=Matrix.Rotation(-math.pi/2,4,'Z')@o.matrix_world
 for v in o.data.vertices:v.co=mat@v.co
 o.parent=None;o.matrix_world.identity();verts.extend(v.co.copy()for v in o.data.vertices)
lo=Vector([min(p[i]for p in verts)for i in range(3)]);hi=Vector([max(p[i]for p in verts)for i in range(3)])
center=Vector(((lo.x+hi.x)/2,(lo.y+hi.y)/2,lo.z));scale=(float(args[4]) if len(args)>4 else 3.2)/(hi.z-lo.z)
for o in props:
 for v in o.data.vertices:v.co=(v.co-center)*scale
handle=[v.co for o in props for v in o.data.vertices if .55<v.co.z<1.25]
offset=Vector((statistics.median(p.x for p in handle),statistics.median(p.y for p in handle),0))
for o in props:
 for v in o.data.vertices:v.co-=offset
# Neutral review lighting preserves the material and exposes contact errors.
scene.world=bpy.data.worlds.new('Review world');scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.13,.16,.19,1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value=.5
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.001));floor=bpy.context.object
mat=bpy.data.materials.new('Review floor');mat.diffuse_color=(.085,.105,.12,1);floor.data.materials.append(mat)
line_mat=bpy.data.materials.new('Half metre contact grid');line_mat.diffuse_color=(.035,.045,.055,1)
for axis in [0,1]:
 for index in range(-20,21):
  loc=[0,0,0];loc[axis]=index*.5
  bpy.ops.mesh.primitive_cube_add(size=1,location=loc);line=bpy.context.object
  line.dimensions=(.009,20,.001) if axis==0 else (20,.009,.001);line.data.materials.append(line_mat)
def light(name,loc,energy,size):
 d=bpy.data.lights.new(name,'AREA');d.energy=energy;d.shape='DISK';d.size=size;o=bpy.data.objects.new(name,d);scene.collection.objects.link(o);o.location=loc;o.rotation_euler=(Vector((0,0,1.3))-o.location).to_track_quat('-Z','Y').to_euler()
light('Key',(-3,-4,6),650,5);light('Fill',(4,-2,3),450,4);light('Rim',(2,3,5),900,3)
bpy.ops.object.camera_add();camera=bpy.context.object;scene.camera=camera;camera.data.type='ORTHO';camera.data.lens=45
scene.render.engine='CYCLES';scene.cycles.samples=24;scene.cycles.use_denoising=True
scene.render.resolution_x=800;scene.render.resolution_y=900;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'
scene.view_settings.view_transform='AgX'
render_dir=os.path.join(ROOT,args[2] if len(args)>2 else 'assets/idle-trial/review')
os.makedirs(render_dir,exist_ok=True)

scene.cycles.samples=8
scene.render.resolution_x=840;scene.render.resolution_y=720
camera.location=(4.8,-7,3.4);target=Vector((0,-.05,1.4))
camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.ortho_scale=4.7
track=next(t for t in rig.animation_data.nla_tracks if t.name==clip)
end=int(track.strips[0].frame_end)
step=1
rig_base=rig.matrix_world.copy()
meta=__import__('json').load(open(os.path.join(ROOT,'docs/boss-essential-manifest.json')))
for f in range(0,end+1,step):
 rig.matrix_world=rig_base.copy()
 scene.frame_set(f);bpy.context.view_layer.update()
 if clip=='walk-forward':
  travel=-meta['clips'][clip]['sourceSpeed']*f/30
  rig.matrix_world.translation.y+=travel;bpy.context.view_layer.update()
  camera.location=(4.8,-7+travel,3.4);target=Vector((0,-.05+travel,1.4))
  camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler()
 wm=rig.matrix_world@rig.pose.bones['WeaponSocket'].matrix
 for o in props:o.matrix_world=wm
 scene.render.filepath=os.path.join(render_dir,clip+'-%04d.png'%(f//step))
 bpy.ops.render.render(write_still=True)
print('MOTION_REVIEW_DONE',clip,flush=True)
