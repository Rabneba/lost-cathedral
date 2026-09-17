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
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.025));floor=bpy.context.object
mat=bpy.data.materials.new('Review floor');mat.diffuse_color=(.085,.105,.12,1);floor.data.materials.append(mat)
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
views=[('quarter',(3.8,-7,3.4),(0,-.1,1.55),4.0),('hands',(1,-4,2.6),(-.05,-.3,1.55),1.55),('side',(6,-.3,2.8),(0,-.1,1.4),3.4)]
for name,loc,target,ortho in views:
 scene.frame_set(int(args[5]) if len(args)>5 else 60);bpy.context.view_layer.update()
 wm=rig.matrix_world@rig.pose.bones['WeaponSocket'].matrix
 for o in props:o.matrix_world=wm
 camera.location=loc;camera.rotation_euler=(Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.ortho_scale=ortho
 scene.render.filepath=os.path.join(render_dir,clip+'-'+name+'.png')
 bpy.ops.render.render(write_still=True)
print('REVIEW_RENDERS_DONE',flush=True)
