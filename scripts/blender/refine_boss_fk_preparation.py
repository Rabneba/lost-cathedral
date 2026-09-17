"""Minimal captured-FK preparation clearance pass, without authored strike targets.
Translate the captured palms together briefly; preserve captured elbow pole and
humerus hinge orientation. No change to active source arm poses.
"""
import bpy,os,json,math,sys
import numpy as np
from mathutils import Vector,Quaternion,Matrix
from mathutils.bvhtree import BVHTree
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'));sys.path.insert(0,os.path.dirname(__file__));from boss_grip_constraints import shaft_clearance
TAG=os.environ.get('VESPER_FK_PREP_TAG','v68-fk-prep-clearance');OUT=os.path.join(ROOT,'assets/combat-revision/boss',TAG);os.makedirs(OUT,exist_ok=True);meta=json.load(open(os.path.join(ROOT,'assets/combat-revision/boss/trajectory-context/context.json')));sections=[(Vector(c),r)for c,r in meta['shaftSections']];bpy.ops.wm.open_mainfile(filepath=os.path.join(ROOT,'assets/combat-revision/boss/v67-slam-captured-fk-baseline/boss-combat-candidate.blend'));scene=bpy.context.scene;rig=next(o for o in scene.objects if o.type=='ARMATURE');bones=rig.pose.bones;body=next(o for o in scene.objects if o.type=='MESH'and any(m.type=='ARMATURE'for m in o.modifiers));inv=rig.matrix_world.inverted();rig.animation_data.action=None
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
required={};directions={};baseparams={}
for f in range(20,45):
 apply(poses[f]);wm=M(bones['WeaponSocket']);Q=wm.to_quaternion();A=Q@Vector((0,0,1));right,left=grip('Right'),grip('Left');S=(left-right).dot(A);C=right+A*S*.5;forward=(P(B('LeftArm'))-P(B('RightArm'))).cross(Vector((0,0,1))).normalized();ev=body.evaluated_get(bpy.context.evaluated_depsgraph_get());v=[body.matrix_world@x.co for x in ev.data.vertices];trees={n:BVHTree.FromPolygons(v,polys,all_triangles=False)for n,polys in faces.items()};need=None
 for amount in np.arange(0,.251,.005):
  if shaft_clearance(C+forward*float(amount),Q,S,.6,trees,sections,.015)is not None:need=float(amount);break
 required[f]=need;directions[f]=forward;baseparams[f]=(C,Q,S)
 print('FK_PREP_NEED',f,need,flush=True)
# Compact C1 bump envelopes for all colliding frames, no correction outside20–44.
shifts={f:0.0 for f in range(198)}
for f in range(20,45):
 for j,need in required.items():
  if need:
   d=abs(f-j);weight=math.cos(math.pi*d/16)**2 if d<8 else 0;shifts[f]=max(shifts[f],(need+.02)*weight)
# A source window's ends have zero amplitude so active motion remains exact.
rows=[];failed=[]
for f in range(20,45):
 amount=shifts[f]
 if amount<1e-7:continue
 apply(poses[f]);delta=directions[f]*amount;before={s:hinge_error(s)for s in['Left','Right']};ok=all(move_arm(s,delta)for s in['Right','Left'])
 if not ok:failed.append({'frame':f,'reason':'captured arm reach exceeded','amount':amount});continue
 C,Q,S=baseparams[f];setworld(bones['WeaponSocket'],Matrix.LocRotScale(C+delta-(Q@Vector((0,0,1)))*(.6+S*.5),Q,Vector((1,1,1))));poses[f]={p.name:p.matrix_basis.copy()for p in bones};rows.append({'frame':f,'shift':amount,'delta':list(delta),'hingeErrorChangeDegrees':{s:math.degrees(hinge_error(s)-before[s])for s in before},'palmResidual':max((grip(s)-(C+delta+(Q@Vector((0,0,1)))*S*.5*(1 if s=='Left'else-1))).length for s in['Left','Right'])})
for t in list(rig.animation_data.nla_tracks):
 if t.name=='slam':rig.animation_data.nla_tracks.remove(t)
action=bpy.data.actions.new(TAG+'-slam');rig.animation_data.action=action;previous={}
for f,p in enumerate(poses):
 for name,m in p.items():
  b=bones[name];loc,q,scale=m.decompose()
  if name in previous and previous[name].dot(q)<0:q.negate()
  previous[name]=q.copy();b.location=loc;b.rotation_quaternion=q;b.scale=scale
  for field in['location','rotation_quaternion','scale']:b.keyframe_insert(field,frame=f)
rig.animation_data.action=None;t=rig.animation_data.nla_tracks.new();t.name='slam';t.strips.new('slam',0,action)
for t in rig.animation_data.nla_tracks:t.mute=False
scene.frame_set(0);update();bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);body.select_set(True);bpy.context.view_layer.objects.active=rig;bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT,'boss-combat-candidate.blend'));bpy.ops.export_scene.gltf(filepath=os.path.join(OUT,'boss-combat-candidate.glb'),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='NLA_TRACKS',export_nla_strips=True,export_frame_range=False,export_force_sampling=True,export_def_bones=False);json.dump({'status':'review candidate, no promotion','requiredShift':required,'corrections':rows,'failures':failed},open(os.path.join(ROOT,'docs/combat-revision/boss-fk-prep-'+TAG+'.json'),'w'),indent=2);print('FK_PREP_REVIEW_READY',OUT,'failures',failed,flush=True)
