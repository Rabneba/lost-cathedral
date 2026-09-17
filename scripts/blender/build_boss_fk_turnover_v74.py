"""Minimal captured-FK preparation clearance pass, without authored strike targets.
Translate the captured palms together briefly; preserve captured elbow pole and
humerus hinge orientation. No change to active source arm poses.
"""
import bpy,os,json,math,sys
import numpy as np
from mathutils import Vector,Quaternion,Matrix
from mathutils.bvhtree import BVHTree
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'));sys.path.insert(0,os.path.dirname(__file__));from boss_grip_constraints import shaft_clearance
TAG=os.environ.get('VESPER_FK_PREP_TAG','v74-slam-terminal-roll-review');OUT=os.path.join(ROOT,'assets/combat-revision/boss',TAG);os.makedirs(OUT,exist_ok=True);meta=json.load(open(os.path.join(ROOT,'assets/combat-revision/boss/trajectory-context/context.json')));sections=[(Vector(c),r)for c,r in meta['shaftSections']];bpy.ops.wm.open_mainfile(filepath=os.path.join(ROOT,'assets/combat-revision/boss/v70-fk-wrist-limit/boss-combat-candidate.blend'));scene=bpy.context.scene;rig=next(o for o in scene.objects if o.type=='ARMATURE');bones=rig.pose.bones;body=next(o for o in scene.objects if o.type=='MESH'and any(m.type=='ARMATURE'for m in o.modifiers));inv=rig.matrix_world.inverted();rig.animation_data.action=None
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


cloud=np.asarray(json.load(open(os.path.join(ROOT,'docs/combat-revision/scythe-socket-vertex-cloud.json')))['xyz']).reshape((-1,3));Z=Vector((0,0,1));Y=Vector((0,1,0));cache={}
for f in list(range(36))+list(range(125,198)):
 apply(poses[f]);wm=M(bones['WeaponSocket']);q=wm.to_quaternion();G=grip('Right');ev=body.evaluated_get(bpy.context.evaluated_depsgraph_get());vertices=[body.matrix_world@x.co for x in ev.data.vertices];cache[f]={'q':q,'G':G,'trees':{n:BVHTree.FromPolygons(vertices,polys,all_triangles=False)for n,polys in faces.items()}}
def smooth(x):x=max(0,min(1,x));return x*x*x*(10+x*(-15+6*x))
def transform(r,w,phi):
 q=r['q']@Quaternion(Z,phi)@Quaternion(Y,math.pi*w)@Quaternion(Z,-phi+(2*phi-math.radians(105))*w);axis=q@Z;station=.6+.5*w;origin=r['G']-axis*station;return q,origin,station

raw=[{n:m.copy()for n,m in p.items()}for p in poses];rows=[];warnings=[];previousQ=None;maxActiveDifference=0
for f in range(198):
 apply(raw[f]);wm=M(bones['WeaponSocket']);r={'q':wm.to_quaternion(),'G':grip('Right')}
 if f<35:w=smooth(f/35);phi=math.radians(110);opened=.7*smooth((f-1)/6)*(1-smooth((f-27)/8))
 elif f>125:w=1-smooth((f-125)/72);phi=math.radians(150);opened=.7*smooth((f-125)/8)*(1-smooth((f-180)/17))
 else:w=1.;phi=0.;opened=0.
 q,origin,station=transform(r,w,phi)
 if f>170:
  idleQ=Quaternion(meta['idleResult']['quaternion']);axis=q@Z;target=(idleQ@Z).rotation_difference(axis)@idleQ;q=q.slerp(target,smooth((f-170)/27))
 if opened:
  side=(P(B('LeftArm'))-P(B('RightArm'))).normalized();delta=(side*.12-Vector((0,0,.06)))*opened/.7;factor=1.
  while not move_arm('Left',delta*factor):
   factor*=.8
   if factor<.05:break
  if factor<1:warnings.append({'frame':f,'secondaryReachFactor':factor})
  for b in bones:
   if b.name.startswith('mixamorig:LeftHand')and b.name!='mixamorig:LeftHand':
    loc,hq,scale=raw[f][b.name].decompose();b.matrix_basis=Matrix.LocRotScale(loc,hq.slerp(Quaternion(),opened),scale)
  update()
 setworld(bones['WeaponSocket'],Matrix.LocRotScale(origin,q,Vector((1,1,1))))
 if f in [0,197]:apply(raw[f])
 pose={b.name:b.matrix_basis.copy()for b in bones};poses[f]=pose
 if 35<=f<=125:
  maxActiveDifference=max(maxActiveDifference,max(max(abs(pose[n][i][j]-raw[f][n][i][j])for i in range(4)for j in range(4))for n in pose if n!='WeaponSocket'))
 angle=0 if previousQ is None else min(previousQ.rotation_difference(q).angle,2*math.pi-previousQ.rotation_difference(q).angle);previousQ=q.copy();rows.append({'frame':f,'time':f/30,'turnoverWeight':w,'secondaryOpenWeight':opened,'mainStation':station,'weaponQuaternion':list(q),'origin':list(origin),'weaponStepDegrees':math.degrees(angle),'fullPropMinimum':float(np.min(cloud@np.asarray(q.to_matrix())[2,:]+origin.z))})
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
scene.frame_set(0);update();bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);body.select_set(True);bpy.context.view_layer.objects.active=rig;bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT,'boss-combat-candidate.blend'));bpy.ops.export_scene.gltf(filepath=os.path.join(OUT,'boss-combat-candidate.glb'),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='NLA_TRACKS',export_nla_strips=True,export_frame_range=False,export_force_sampling=True,export_def_bones=False);json.dump({'status':'turnover geometry review; physical finger/pronation refinement pending; do not promote','sourceArmsUnchangedFrames':[35,125],'maximumActiveMatrixDifference':maxActiveDifference,'secondaryReleaseFrames':[[2,34],[126,196]],'turnoverPhiDegrees':{'preparation':110,'recovery':150},'samples':rows,'warnings':warnings},open(os.path.join(ROOT,'docs/combat-revision/boss-turnover-v74-report.json'),'w'),indent=2);print('TURNOVER_REVIEW_READY',OUT,'activeDiff',maxActiveDifference,'maxWeaponStep',max(r['weaponStepDegrees']for r in rows),'floor',min(r['fullPropMinimum']for r in rows),flush=True)
