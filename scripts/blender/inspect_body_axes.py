import bpy,os,sys,json
from mathutils import Vector
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.abspath(sys.argv[-1]))
for o in bpy.context.scene.objects:
 if o.type=='MESH':
  bpy.context.view_layer.update();print('AXES',o.name,o.rotation_mode,list(o.rotation_euler),list(o.rotation_quaternion),[list(row) for row in o.matrix_world]);print('BOUNDS',[list(o.matrix_world@Vector(c)) for c in o.bound_box])
