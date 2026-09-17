import bpy,os,json,math
from mathutils import Vector
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'))
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene;scene.render.fps=30
bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT,'assets/boss-essential-motion/boss-sources.glb'))
rig=next(o for o in scene.objects if o.type=='ARMATURE')
body=next(o for o in scene.objects if o.type=='MESH' and any(m.type=='ARMATURE'for m in o.modifiers))
bones=rig.pose.bones
rig.animation_data.action=None
names=['Hips','Spine2','Head','LeftShoulder','RightShoulder','LeftUpLeg','RightUpLeg','LeftLeg','RightLeg','LeftFoot','RightFoot','LeftToeBase','RightToeBase','LeftHand','RightHand']
reports={}
for track in rig.animation_data.nla_tracks:
 for t in rig.animation_data.nla_tracks:t.mute=t!=track
 strip=track.strips[0];start=strip.frame_start;end=strip.frame_end;samples=[]
 for i in range(round(end-start)+1):
  scene.frame_set(round(start)+i);bpy.context.view_layer.update()
  data={n:list((rig.matrix_world@bones['mixamorig:'+n].matrix).translation)for n in names}
  ev=body.evaluated_get(bpy.context.evaluated_depsgraph_get())
  data['floor']=min((body.matrix_world@v.co).z for v in ev.data.vertices)
  data['time']=i/30;samples.append(data)
 reports[track.name]={'duration':(end-start)/30,'samples':samples}
 print('SOURCE',track.name,'seconds',(end-start)/30,'floor',min(x['floor']for x in samples),max(x['floor']for x in samples),'hipsStart',samples[0]['Hips'],'hipsEnd',samples[-1]['Hips'],flush=True)
os.makedirs(os.path.join(ROOT,'assets/boss-essential-motion'),exist_ok=True)
json.dump(reports,open(os.path.join(ROOT,'docs/boss-essential-source-metrics.json'),'w'))
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT,'assets/boss-essential-motion/boss-sources.blend'))
