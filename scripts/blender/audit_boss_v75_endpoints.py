import bpy,os,json,math
from mathutils import Vector
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'));bpy.ops.wm.open_mainfile(filepath=os.path.join(ROOT,'assets/combat-revision/boss/v75-slam-bounded-grip-review/boss-combat-candidate.blend'));rig=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE');rig.animation_data.action=None
for t in rig.animation_data.nla_tracks:t.mute=t.name!='slam'
def P(n):return(rig.matrix_world@rig.pose.bones['mixamorig:'+n].matrix).translation.copy()
def Q(n):return(rig.matrix_world@rig.pose.bones['mixamorig:'+n].matrix).to_quaternion()
bpy.context.scene.frame_set(0);bpy.context.view_layer.update();normals={}
for s in['Left','Right']:
 S,E,W=P(s+'Arm'),P(s+'ForeArm'),P(s+'Hand');normal=(E-S).cross(W-E).normalized();normals[s]=Q(s+'Arm').inverted()@normal

meta=json.load(open(os.path.join(ROOT,'assets/combat-revision/boss/trajectory-context/context.json')));idle=dict(zip(meta['bones'],meta['idlePose']));out=[]
for f in [0,197]:
 bpy.context.scene.frame_set(f);bpy.context.view_layer.update();errors=[]
 for n,m in idle.items():
  actual=rig.pose.bones[n].matrix_basis;errors.append((max(abs(actual[i][j]-m[i][j])for i in range(4)for j in range(4)),n))
 errors.sort(reverse=True);out.append({'frame':f,'maxLocalMatrixDifference':errors[0][0],'worstBone':errors[0][1],'weaponSocketDifference':next(e for e,n in errors if n=='WeaponSocket'),'top':errors[:5]})
json.dump({'reference':'trajectory-context/context.json idlePose, approved idle','candidate':'v75-slam-bounded-grip-review','endpoints':out},open(os.path.join(ROOT,'docs/combat-revision/boss-v75-idle-endpoints.json'),'w'),indent=2);print(out,flush=True)
