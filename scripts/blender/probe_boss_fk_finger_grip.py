"""Minimal captured-FK preparation clearance pass, without authored strike targets.
Translate the captured palms together briefly; preserve captured elbow pole and
humerus hinge orientation. No change to active source arm poses.
"""
import bpy,os,json,math,sys
import numpy as np
from mathutils import Vector,Quaternion,Matrix
from mathutils.bvhtree import BVHTree
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'));sys.path.insert(0,os.path.dirname(__file__));from boss_grip_constraints import shaft_clearance
TAG=os.environ.get('VESPER_FK_PREP_TAG','v70-fk-wrist-limit');OUT=os.path.join(ROOT,'assets/combat-revision/boss',TAG);os.makedirs(OUT,exist_ok=True);meta=json.load(open(os.path.join(ROOT,'assets/combat-revision/boss/trajectory-context/context.json')));sections=[(Vector(c),r)for c,r in meta['shaftSections']];bpy.ops.wm.open_mainfile(filepath=os.path.join(ROOT,'assets/combat-revision/boss/v70-fk-wrist-limit/boss-combat-candidate.blend'));scene=bpy.context.scene;rig=next(o for o in scene.objects if o.type=='ARMATURE');bones=rig.pose.bones;body=next(o for o in scene.objects if o.type=='MESH'and any(m.type=='ARMATURE'for m in o.modifiers));inv=rig.matrix_world.inverted();rig.animation_data.action=None
for t in rig.animation_data.nla_tracks:t.mute=t.name!='slam'
poses=[]
for f in range(198):scene.frame_set(f);bpy.context.view_layer.update();poses.append({p.name:p.matrix_basis.copy()for p in bones})
for t in rig.animation_data.nla_tracks:t.mute=True

def update():bpy.context.view_layer.update()
def B(n):return bones['mixamorig:'+n]
def M(p):return rig.matrix_world@p.matrix
def P(p):return M(p).translation.copy()
def apply(p):
 for n,m in p.items():bones[n].matrix_basis=m
 update()
def setworld(p,m):p.matrix=inv@m;update()
def rotate(p,q):
 m=M(p);v=m.translation.copy();setworld(p,Matrix.Translation(v)@q.to_matrix().to_4x4()@Matrix.Translation(-v)@m)
def aim(p,child,target):
 a=P(child)-P(p);b=target-P(p)
 if min(a.length,b.length)>1e-7:rotate(p,a.normalized().rotation_difference(b.normalized()))
def grip(s):
 ps=[P(B(s+'Hand'+d+str(j)))for d in ['Index','Middle','Ring','Pinky']for j in[1,3]]
 return sum(ps,Vector())*(.8/len(ps))+P(B(s+'HandThumb3'))*.2
apply(poses[0]);hinge={}
for s in['Left','Right']:
 S,E,W=P(B(s+'Arm')),P(B(s+'ForeArm')),P(B(s+'Hand'));hinge[s]=M(B(s+'Arm')).to_quaternion().inverted()@(E-S).cross(W-E).normalized()
def hinge_error(s):
 S,E,W=P(B(s+'Arm')),P(B(s+'ForeArm')),P(B(s+'Hand'));ax=(E-S).normalized();actual=M(B(s+'Arm')).to_quaternion()@hinge[s];actual-=ax*actual.dot(ax);actual.normalize();plane=ax.cross(W-E).normalized();return math.atan2(ax.dot(actual.cross(plane)),actual.dot(plane))
def move_arm(s,delta):
 arm,fore,hand=B(s+'Arm'),B(s+'ForeArm'),B(s+'Hand');S,E,W=P(arm),P(fore),P(hand);Q=M(hand).to_quaternion();capturedRoll=hinge_error(s);target=W+delta;l1=(E-S).length;l2=(W-E).length;distance=(target-S).length
 if distance>l1+l2-.003:return False
 axis=(target-S).normalized();along=(l1*l1-l2*l2+distance*distance)/(2*distance);height=math.sqrt(max(0,l1*l1-along*along));pole=E-S;pole-=axis*pole.dot(axis);newE=S+axis*along+pole.normalized()*height;aim(arm,fore,newE);aim(fore,hand,target);hm=M(hand);setworld(hand,Matrix.LocRotScale(hm.translation,Q,hm.to_scale()));fm=M(fore).copy();hm=M(hand).copy();angle=hinge_error(s)-capturedRoll;rotate(arm,Quaternion((P(fore)-P(arm)).normalized(),angle));setworld(fore,fm);setworld(hand,hm);return True
names={g.index:g.name for g in body.vertex_groups};regionBones={'hood':{'mixamorig:Head','mixamorig:Neck'},'torso':{'mixamorig:Hips','mixamorig:Spine','mixamorig:Spine1','mixamorig:Spine2'}};faces={}
for n,groupnames in regionBones.items():
 ids={v.index for v in body.data.vertices if sum(g.weight for g in v.groups if names[g.group]in groupnames)>.25};faces[n]=[list(p.vertices)for p in body.data.polygons if any(i in ids for i in p.vertices)]


apply(poses[84]);report=[]
for side in ['Left','Right']:
 G=grip(side);oldFQ=M(B(side+'ForeArm')).to_quaternion();oldHQ=M(B(side+'Hand')).to_quaternion();relative=oldFQ.inverted()@oldHQ;localGrip=oldHQ.inverted()@(G-P(B(side+'Hand')));w0=P(B(side+'Hand'));hinge0=hinge_error(side)
 S,E,W=P(B(side+'Arm')),P(B(side+'ForeArm')),P(B(side+'Hand'));F=(W-E).normalized();upper=(E-S).normalized();normal=upper.cross(F).normalized();neutral=normal.cross(F).normalized();thumb=(P(B(side+'HandIndex1'))-P(B(side+'HandPinky1')));thumb-=F*thumb.dot(F);thumb.normalize();phi=math.atan2(F.dot(neutral.cross(thumb)),neutral.dot(thumb));axis=M(bones['WeaponSocket']).to_quaternion()@Vector((0,0,1));projected=axis-F*axis.dot(F);projected.normalize();desired=math.atan2(F.dot(neutral.cross(projected)),neutral.dot(projected))
 if desired>math.pi/2:desired-=math.pi
 if desired<-math.pi/2:desired+=math.pi
 desired=max(-math.radians(80),min(math.radians(80),desired));targetHQ=Quaternion(F,desired-phi)@oldHQ;targetW=G-targetHQ@localGrip;okay=move_arm(side,targetW-W)
 if okay:
  fm=M(B(side+'ForeArm'));targetFQ=targetHQ@relative.inverted();setworld(B(side+'ForeArm'),Matrix.LocRotScale(fm.translation,targetFQ,fm.to_scale()));aim(B(side+'ForeArm'),B(side+'Hand'),targetW);hm=M(B(side+'Hand'));setworld(B(side+'Hand'),Matrix.LocRotScale(hm.translation,targetHQ,hm.to_scale()))
 report.append({'side':side,'oldPronation':math.degrees(phi),'desiredPronation':math.degrees(desired),'shift':(targetW-w0).length,'okay':okay,'palmResidual':(grip(side)-G).length,'humerusRollChange':math.degrees(hinge_error(side)-hinge0)})
# Save one posed diagnostic frame; no final asset path is touched.
for b in bones:
 b.keyframe_insert('location',frame=84);b.keyframe_insert('rotation_quaternion',frame=84);b.keyframe_insert('scale',frame=84)
rig.animation_data.action.name='static-grip-diagnostic';scene.frame_set(84);bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT,'assets/combat-revision/boss/v70-static-grip-diagnostic.blend'));json.dump(report,open(os.path.join(ROOT,'docs/combat-revision/boss-v70-static-grip-diagnostic.json'),'w'),indent=2);print(report,flush=True)
