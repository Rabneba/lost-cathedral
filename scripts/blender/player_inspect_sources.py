import bpy,os,json,sys
from mathutils import Vector
root=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'))
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=root+'/assets/import-thorn-exile-body-glb-as-a-rigged-cmu1g9de-rigged-glb.glb')
r=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE')
print('SOURCE_MATRIX',[[round(v,5) for v in x] for x in r.matrix_world])
print('REST',[(b.name,list(r.matrix_world@b.head_local)) for b in r.data.bones if not any(x in b.name for x in ['Thumb','Index','Middle','Ring','Pinky'])])
