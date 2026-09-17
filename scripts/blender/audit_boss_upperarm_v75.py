import bpy,os,json,math
from mathutils import Vector
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'));bpy.ops.wm.open_mainfile(filepath=os.path.join(ROOT,'assets/combat-revision/boss/v75-slam-bounded-grip-review/boss-combat-candidate.blend'));rig=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE');rig.animation_data.action=None
for t in rig.animation_data.nla_tracks:t.mute=t.name!='slam'
def P(n):return(rig.matrix_world@rig.pose.bones['mixamorig:'+n].matrix).translation.copy()
def Q(n):return(rig.matrix_world@rig.pose.bones['mixamorig:'+n].matrix).to_quaternion()
bpy.context.scene.frame_set(0);bpy.context.view_layer.update();normals={}
for s in['Left','Right']:
 S,E,W=P(s+'Arm'),P(s+'ForeArm'),P(s+'Hand');normal=(E-S).cross(W-E).normalized();normals[s]=Q(s+'Arm').inverted()@normal
rows=[]
for f in range(198):
 bpy.context.scene.frame_set(f);bpy.context.view_layer.update();r={'frame':f,'hands':{}}
 for s in['Left','Right']:
  S,E,W=P(s+'Arm'),P(s+'ForeArm'),P(s+'Hand');axis=(E-S).normalized();normal=axis.cross(W-E).normalized();current=Q(s+'Arm')@normals[s];current-=axis*current.dot(axis);current.normalize();roll=math.degrees(math.atan2(axis.dot(current.cross(normal)),current.dot(normal)));r['hands'][s]={'shoulder':list(S),'elbow':list(E),'wrist':list(W),'elbowHeightRelativeShoulder':E.z-S.z,'elbowHeadDistance':(E-P('Head')).length,'humerusRollErrorFromIdleHinge':roll}
 rows.append(r)
json.dump(rows,open(os.path.join(ROOT,'docs/combat-revision/boss-upperarm-v75.json'),'w'),indent=2)
for s in['Left','Right']:
 print(s,sorted(rows,key=lambda r:abs(r['hands'][s]['humerusRollErrorFromIdleHinge']),reverse=True)[:3],flush=True)
