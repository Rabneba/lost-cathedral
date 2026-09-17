import bpy,sys,os,json
from mathutils import Vector
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'));out={}
for kind in ['strike','dodge']:
 bpy.ops.wm.read_factory_settings(use_empty=True);bpy.context.scene.render.fps=30;bpy.ops.import_scene.gltf(filepath=ROOT+'/assets/player-essential-motion/'+kind+'-source.glb');r=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE')
 out[kind]=[]
 for f in range(0,155,10):
  bpy.context.scene.frame_set(f);bpy.context.view_layer.update()
  out[kind].append({'f':f,**{n:list((r.matrix_world@r.pose.bones['mixamorig:'+n].matrix).translation) for n in ['Hips','LeftFoot','LeftToeBase','RightFoot','RightToeBase','RightHand','LeftHand']}})
json.dump(out,open(ROOT+'/docs/player-essential-raw-metrics.json','w'),indent=2)
