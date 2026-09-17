import bpy,os,json,sys
from mathutils import Vector
bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=os.path.abspath(sys.argv[-1]));bpy.context.view_layer.update()
for o in bpy.context.scene.objects:
 if o.type=='ARMATURE':
  print('RIG',o.name,'matrix',[list(r)for r in o.matrix_world]);print('LANDMARKS',json.dumps({b.name:[list(o.matrix_world@b.head),list(o.matrix_world@b.tail)] for b in o.pose.bones if not any(x in b.name for x in ['Thumb','Index','Middle','Ring','Pinky'])}))
 if o.type=='MESH':print('MESH',o.name,[list(o.matrix_world@Vector(c)) for c in o.bound_box])
