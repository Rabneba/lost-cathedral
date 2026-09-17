import bpy,os,json,math
from mathutils import Vector
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'));bpy.ops.wm.open_mainfile(filepath=os.path.join(ROOT,'assets/combat-revision/boss/v70-fk-wrist-limit/boss-combat-candidate.blend'));rig=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE');rig.animation_data.action=None
for t in rig.animation_data.nla_tracks:t.mute=t.name!='slam'
def P(n):return(rig.matrix_world@rig.pose.bones['mixamorig:'+n].matrix).translation.copy()
rows=[]
for f in range(198):
 bpy.context.scene.frame_set(f);bpy.context.view_layer.update();q=(rig.matrix_world@rig.pose.bones['WeaponSocket'].matrix).to_quaternion();shaft=q@Vector((0,0,1));row={'frame':f}
 for s in ['Left','Right']:
  F=(P(s+'Hand')-P(s+'ForeArm')).normalized();A=(P(s+'HandIndex1')-P(s+'HandPinky1')).normalized();L=(P(s+'HandMiddle1')-P(s+'Hand')).normalized();af=math.degrees(F.angle(shaft));aa=math.degrees(A.angle(shaft));row[s]={'forearmShaftAngle':min(af,180-af),'acrossShaftAngle':min(aa,180-aa),'requiredWristBend':abs(90-af),'capturedBend':math.degrees(F.angle(L))};upper=(P(s+'ForeArm')-P(s+'Arm')).normalized();hinge=upper.cross(F).normalized();neutral=hinge.cross(F).normalized();thumb=A-F*A.dot(F);thumb.normalize();row[s]['geometricPronation']=math.degrees(math.atan2(F.dot(neutral.cross(thumb)),neutral.dot(thumb)))
 rows.append(row)
json.dump(rows,open(os.path.join(ROOT,'docs/combat-revision/boss-v70-hand-frames.json'),'w'),indent=2)
for f in [0,20,32,40,60,70,79,84,90,110,130,160,197]:print(rows[f],flush=True)
