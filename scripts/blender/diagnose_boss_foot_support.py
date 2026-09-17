"""Read-only V75 source-foot reach and flat-sole calibration diagnostic."""
import bpy, os, json, math
from mathutils import Vector, Quaternion, Matrix
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'))
bpy.ops.wm.open_mainfile(filepath=ROOT+'/assets/combat-revision/boss/v75-slam-bounded-grip-review/boss-combat-candidate.blend')
scene=bpy.context.scene;rig=next(o for o in scene.objects if o.type=='ARMATURE');bones=rig.pose.bones;body=next(o for o in scene.objects if o.type=='MESH' and any(m.type=='ARMATURE'for m in o.modifiers));inv=rig.matrix_world.inverted()
rig.animation_data.action=None
for t in rig.animation_data.nla_tracks:t.mute=t.name!='slam'
poses=[]
for f in range(198):
 scene.frame_set(f);bpy.context.view_layer.update();poses.append({b.name:b.matrix_basis.copy()for b in bones})
for t in rig.animation_data.nla_tracks:t.mute=True
def update():bpy.context.view_layer.update()
def B(n):return bones['mixamorig:'+n]
def M(b):return rig.matrix_world@b.matrix
def P(b):return M(b).translation.copy()
def apply(p):
 for n,m in p.items():bones[n].matrix_basis=m
 update()
sets={}
for s in ['Left','Right']:
 groups={g.index for g in body.vertex_groups if s in g.name and any(x in g.name for x in ['Foot','ToeBase'])};sets[s]=[v.index for v in body.data.vertices if sum(g.weight for g in v.groups if g.group in groups)>=.5]
def sole(s):
 ev=body.evaluated_get(bpy.context.evaluated_depsgraph_get());me=ev.to_mesh();low=min((ev.matrix_world@me.vertices[i].co).z for i in sets[s]);ev.to_mesh_clear();return low
apply(poses[0]);flat={}
for s in ['Left','Right']:
 d=P(B(s+'ToeBase'))-P(B(s+'Foot'));flat[s]={'rotation':M(B(s+'Foot')).to_quaternion().copy(),'height':P(B(s+'Foot')).z-sole(s),'direction':math.atan2(d.y,d.x),'toe':B(s+'ToeBase').matrix_basis.copy()}
rows=[]
for f in [0,5,10,15,20,25,30,35,45,55,60,65,70,75,80,84,90,100,110,125,140,150,160,170,180,190,197]:
 apply(poses[f]);row={'frame':f,'hip':list(P(B('Hips'))),'feet':{}}
 for s in ['Left','Right']:
  h,k,a=[P(B(s+n))for n in ['UpLeg','Leg','Foot']];l1=(k-h).length;l2=(a-k).length;target=a.copy();target.z=flat[s]['height'];row['feet'][s]={'hip':list(h),'knee':list(k),'ankle':list(a),'sole':sole(s),'flatTargetZ':target.z,'reachMargin':l1+l2-(target-h).length,'length':l1+l2,'bend':math.degrees((k-h).angle(a-k))}
 rows.append(row)
print(json.dumps(rows,indent=2),flush=True)
json.dump({'rows':rows,'flatHeights':{s:flat[s]['height']for s in flat}},open(ROOT+'/docs/combat-revision/boss-v75-foot-reach.json','w'),indent=2)
