import bpy,os,sys,math,statistics
from mathutils import Vector,Matrix
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'))
args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
blend=args[0] if args else 'assets/player-essential-motion/player-retarget-study.blend'
clip=args[1] if len(args)>1 else 'strike'
out=args[2] if len(args)>2 else 'assets/player-essential-motion/review'
frames=[float(x) for x in args[3].split(',')] if len(args)>3 else [0,25,50,75,100,130]
bpy.ops.wm.open_mainfile(filepath=ROOT+'/'+blend);scene=bpy.context.scene
rig=next(o for o in scene.objects if o.type=='ARMATURE');rig.animation_data.action=None
for t in rig.animation_data.nla_tracks:t.mute=t.name!=clip
# Match the game's local prop transform sequence, including socket quarter-turn.
def prop(path,height,sword=False):
 before=set(scene.objects);bpy.ops.import_scene.gltf(filepath=ROOT+'/'+path);meshes=[o for o in scene.objects if o not in before and o.type=='MESH'];verts=[]
 mat=Matrix.Rotation(-math.pi/2,4,'Z')@(Matrix.Rotation(math.pi,4,'Y') if sword else Matrix.Identity(4))
 for o in meshes:
  m=mat@o.matrix_world
  for v in o.data.vertices:v.co=m@v.co
  o.parent=None;o.matrix_world.identity();verts.extend(v.co.copy()for v in o.data.vertices)
 lo=Vector([min(v[i]for v in verts)for i in range(3)]);hi=Vector([max(v[i]for v in verts)for i in range(3)])
 center=Vector(((lo.x+hi.x)/2,(lo.y+hi.y)/2,lo.z));scale=height/(hi.z-lo.z)
 for o in meshes:
  for v in o.data.vertices:v.co=(v.co-center)*scale
 if sword:
  handle=[v.co for o in meshes for v in o.data.vertices if .08<v.co.z<.25]
  center=Vector((statistics.median(v.x for v in handle),statistics.median(v.y for v in handle),0))
  for o in meshes:
   for v in o.data.vertices:v.co-=center
 return meshes
sword=prop('assets/create-the-exact-isolated-player-sword-s-cmu12ngf.glb',1.28,True)
shield=prop('assets/create-the-exact-isolated-player-shield-cmu12nf3.glb',.73)
scene.world=bpy.data.worlds.new('Player review world');scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.12,.15,.18,1);scene.world.node_tree.nodes['Background'].inputs[1].default_value=.5
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.025));floor=bpy.context.object
mat=bpy.data.materials.new('Floor');mat.diffuse_color=(.11,.14,.16,1);floor.data.materials.append(mat)
def light(loc,energy,size):
 d=bpy.data.lights.new('review','AREA');d.energy=energy;d.shape='DISK';d.size=size;o=bpy.data.objects.new('review',d);scene.collection.objects.link(o);o.location=loc;o.rotation_euler=(Vector((0,0,1))-o.location).to_track_quat('-Z','Y').to_euler()
light((-3,-4,6),600,5);light((4,-2,3),450,4);light((2,3,5),750,3)
bpy.ops.object.camera_add();cam=bpy.context.object;scene.camera=cam;cam.data.type='ORTHO';cam.data.ortho_scale=3.3
scene.render.engine='CYCLES';scene.cycles.samples=12;scene.cycles.use_denoising=True;scene.render.resolution_x=560;scene.render.resolution_y=640;scene.render.resolution_percentage=100;scene.view_settings.view_transform='AgX'
os.makedirs(ROOT+'/'+out,exist_ok=True)
for f in frames:
 scene.frame_set(int(f),subframe=f-int(f));bpy.context.view_layer.update()
 sw=rig.matrix_world@rig.pose.bones['WeaponSocket'].matrix
 sh=rig.matrix_world@rig.pose.bones['ShieldSocket'].matrix@Matrix.Rotation(math.pi/2,4,'Z')
 for o in sword:o.matrix_world=sw
 for o in shield:o.matrix_world=sh
 hip=(rig.matrix_world@rig.pose.bones['mixamorig:Hips'].matrix).translation
 cam.location=(hip.x+3.5,hip.y-6,2.8);target=Vector((hip.x,hip.y,1));cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler()
 scene.render.filepath=ROOT+'/'+out+'/'+clip+'-'+str(round(f)).zfill(3)+'.png';bpy.ops.render.render(write_still=True)
print('RENDERED',out,clip,flush=True)
