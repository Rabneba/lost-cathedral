import bpy,sys,os,json,math
from mathutils import Vector,Matrix
args=sys.argv[sys.argv.index('--')+1:];src,out,height=args[0],args[1],float(args[2]);yaw=float(args[3]) if len(args)>3 else -math.pi/2
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.abspath(src))
meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
for o in meshes:
 world=Matrix.Rotation(yaw,4,'Z')@o.matrix_world
 for vert in o.data.vertices:vert.co=world@vert.co
 o.matrix_world.identity()
coords=[o.matrix_world@Vector(c) for o in meshes for c in o.bound_box]
lo=Vector(tuple(min(p[i] for p in coords) for i in range(3)));hi=Vector(tuple(max(p[i] for p in coords) for i in range(3)));scale=height/(hi.z-lo.z);center=Vector(((lo.x+hi.x)/2,(lo.y+hi.y)/2,lo.z))
for o in meshes:
 for vert in o.data.vertices:vert.co=(o.matrix_world@vert.co-center)*scale
 o.matrix_world.identity()
os.makedirs(os.path.dirname(out),exist_ok=True)
bpy.ops.export_scene.gltf(filepath=os.path.abspath(out),export_format='GLB',export_yup=True)
print('NORMALIZED',json.dumps({'path':out,'height':height,'yaw':yaw,'sourceBounds':[list(lo),list(hi)]}))
