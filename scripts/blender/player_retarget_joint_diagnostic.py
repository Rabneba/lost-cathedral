import bpy,os,json,math
from mathutils import Vector,Quaternion
R=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'))
bpy.ops.wm.open_mainfile(filepath=R+'/assets/player-combat-revision/player-video-retarget-trial.blend')
s=bpy.context.scene;t=next(o for o in s.objects if o.type=='ARMATURE');t.animation_data.action=None
for tr in t.animation_data.nla_tracks:tr.mute=tr.name!='guard-v2'
s.frame_set(60);bpy.context.view_layer.update()
report={};parts=['RightShoulder','RightArm','RightForeArm','RightHand','LeftArm','LeftForeArm','LeftHand','Hips']
for name in parts:
 b=t.pose.bones['mixamorig:'+name];report[name]={'target':list((t.matrix_world@b.matrix).translation)}
before=set(s.objects);bpy.ops.import_scene.gltf(filepath=R+'/assets/player-combat-revision/raw-motion/guard-v2-source.glb');a=next(o for o in s.objects if o not in before and o.type=='ARMATURE');act=a.animation_data.nla_tracks[0].strips[0].action
for tr in a.animation_data.nla_tracks:tr.mute=True
a.animation_data.action=act;a.animation_data.action_slot=act.slots[0];s.frame_set(60);bpy.context.view_layer.update();turn=Quaternion((0,0,1),math.radians(-42.95946772373585))
for name in parts:
 b=a.pose.bones['mixamorig:'+name];report[name]['source']=list(turn@(a.matrix_world@b.matrix).translation)
for name,child in [('RightArm','RightForeArm'),('RightForeArm','RightHand')]:
 for key,rig in [('source',a),('target',t)]:
  b,c=[rig.pose.bones['mixamorig:'+n]for n in [name,child]];rel=b.matrix.inverted()@c.matrix;report[name][key+'ChildLocal']=list(rel.translation);report[name][key+'RestChildLocal']=list((b.bone.matrix_local.inverted()@c.bone.matrix_local).translation)
json.dump(report,open(R+'/docs/player-combat-revision/retarget-joint-diagnostic.json','w'),indent=2);print(json.dumps(report),flush=True)
