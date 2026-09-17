"""V76 derivative: actual boot support, captured knee planes, unchanged upper body.

Only UpLeg/Leg/Foot/ToeBase chains change. The source's minimum-vertex grounding
left the lead boot in the air. This replaces that with deliberately timed support
and recovery steps, calibrated from the accepted idle boot orientation.
"""
import bpy, os, json, math
import numpy as np
from mathutils import Vector, Matrix, Quaternion
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'))
TAG=os.environ.get('VESPER_FOOT_TAG','v76-slam-foot-support')
OUT=ROOT+'/assets/combat-revision/boss/'+TAG;os.makedirs(OUT,exist_ok=True)
bpy.context.preferences.filepaths.save_version=0
# Shared read-only setup reads and snapshots all 198 source poses.
prefix=open(ROOT+'/scripts/blender/diagnose_boss_foot_support.py').read().split('rows=[]')[0]
exec(compile(prefix,'diagnose_boss_foot_support.py','exec'))
raw=[{n:m.copy()for n,m in p.items()}for p in poses]
Z=Vector((0,0,1));allowed={B(s+n).name for s in ['Left','Right']for n in ['UpLeg','Leg','Foot','ToeBase']}
def setworld(b,m):b.matrix=inv@m;update()
def rotate(b,q):
 m=M(b);setworld(b,Matrix.LocRotScale(m.translation,q@m.to_quaternion(),m.to_scale()))
def aim(a,b,target):
 v=P(b)-P(a);w=target-P(a)
 if min(v.length,w.length)>1e-8:rotate(a,v.normalized().rotation_difference(w.normalized()))
apply(raw[0]);hinges={};idle={}
for side in ['Left','Right']:
 H,K,A=[P(B(side+n))for n in ['UpLeg','Leg','Foot']]
 hinges[side]=M(B(side+'UpLeg')).to_quaternion().inverted()@(K-H).cross(A-K).normalized()
 idle[side]=A.copy()
def hinge_error(s):
 H,K,A=[P(B(s+n))for n in ['UpLeg','Leg','Foot']];axis=(K-H).normalized();actual=M(B(s+'UpLeg')).to_quaternion()@hinges[s];actual-=axis*actual.dot(axis);actual.normalize();plane=axis.cross(A-K).normalized();return math.atan2(axis.dot(actual.cross(plane)),actual.dot(plane))
def solve_leg(s,target,pole,captured_roll):
 a,b,c=[B(s+n)for n in ['UpLeg','Leg','Foot']];H,K,A=[P(x)for x in [a,b,c]];l1=(K-H).length;l2=(A-K).length;d=(target-H).length
 if d>l1+l2-.0001 or d<abs(l1-l2)+.0001:return False,(l1+l2)-d
 axis=(target-H).normalized();along=(l1*l1-l2*l2+d*d)/(2*d);height=math.sqrt(max(0,l1*l1-along*along));source_axis,source_bend=pole;bend=source_axis.rotation_difference(axis)@source_bend;bend-=axis*bend.dot(axis)
 if bend.length<1e-7:return False,-1
 E=H+axis*along+bend.normalized()*height;aim(a,b,E);aim(b,c,target)
 bm=M(b).copy();cm=M(c).copy();error=hinge_error(s)-captured_roll;rotate(a,Quaternion((P(b)-P(a)).normalized(),error));setworld(b,bm);setworld(c,cm)
 return True,(l1+l2)-d
def smoother(v):v=max(0,min(1,v));return v*v*v*(v*(v*6-15)+10)
def yaw_at(side,f):
 apply(raw[f]);d=P(B(side+'ToeBase'))-P(B(side+'Foot'));return math.atan2(d.y,d.x)
yaws={s:{f:yaw_at(s,f)for f in [0,30,35,84,180,197]}for s in ['Left','Right']}
def entry(f,p,yaw):return(f,Vector((p[0],p[1],flat['Left']['height'])),yaw)
paths={
 'Left':[(0,idle['Left'],yaws['Left'][0]),(18,Vector((-.10,.42,0)),yaws['Left'][30]),(145,Vector((-.10,.42,0)),yaws['Left'][30]),(160,Vector((.146,-.023,0)),yaws['Left'][180]),(188,Vector((.146,-.023,0)),yaws['Left'][180]),(197,idle['Left'],yaws['Left'][197])],
 'Right':[(0,idle['Right'],yaws['Right'][0]),(18,idle['Right'],yaws['Right'][0]),(34,Vector((-.15,-.53,0)),yaws['Right'][35]),(48,Vector((-.15,-.53,0)),yaws['Right'][35]),(64,Vector((.055,-.56,0)),yaws['Right'][84]),(160,Vector((.055,-.56,0)),yaws['Right'][84]),(180,Vector((-.135,-.005,0)),yaws['Right'][180]),(188,idle['Right'],yaws['Right'][197]),(197,idle['Right'],yaws['Right'][197])]
}
swings={'Left':[(0,18,.09),(145,160,.07),(188,197,.07)],'Right':[(18,34,.09),(48,64,.07),(160,188,.09)]}
def target_at(s,f):
 points=paths[s];i=next((i for i in range(len(points)-1)if points[i][0]<=f<=points[i+1][0]),len(points)-2);a,p,y=points[i];b,q,z=points[i+1];v=smoother((f-a)/(b-a));position=p.lerp(q,v);yaw=y+((z-y+math.pi)%(2*math.pi)-math.pi)*v;lift=0;phase='support'
 for a,b,h in swings[s]:
  if a<f<b:lift=h*math.sin(math.pi*(f-a)/(b-a))**2;phase='swing'
 position.z=flat[s]['height']+lift
 Q=Quaternion(Z,yaw-flat[s]['direction'])@flat[s]['rotation']
 if s=='Left':
  # A 3.8 degree heel-led settle accommodates the captured recovery's maximum
  # hip height without stretching a leg or lifting the root. This is far below
  # the source's toe-supported 32cm heel rise; the actual heel stays on ground.
  pitch=-math.radians(3.8)*smoother((f-174)/6)*(1-smoother((f-184)/7));direction=Vector((math.cos(yaw),math.sin(yaw),0));Q=Quaternion(Z.cross(direction),pitch)@Q
 return position,Q,lift,phase
def foot_metrics():
 ev=body.evaluated_get(bpy.context.evaluated_depsgraph_get());me=ev.to_mesh();out={}
 for s in ['Left','Right']:
  ids=sets[s];p=np.array([list(ev.matrix_world@me.vertices[i].co)for i in ids]);out[s]={'minimum':float(p[:,2].min())}
 ev.to_mesh_clear();return out
samples=[];rows=[];failures=[];previous=None;max_upper=0
for f in range(198):
 apply(raw[f]);original_world={n:M(bones[n]).copy()for n in bones.keys()if n not in allowed};row={'frame':f,'time':f/30,'feet':{}}
 for side in ['Left','Right']:
  target,Q,lift,phase=target_at(side,f);capture={n:b.matrix_basis.copy()for n,b in bones.items()};sourceHip=P(B(side+'UpLeg'));sourceAxis=(P(B(side+'Foot'))-sourceHip).normalized();sourceBend=P(B(side+'Leg'))-sourceHip;sourceBend-=sourceAxis*sourceBend.dot(sourceAxis);pole=(sourceAxis,sourceBend.normalized());roll=hinge_error(side);oldFoot=P(B(side+'Foot'));oldKnee=P(B(side+'Leg'));originalTarget=target.copy();margin=0;horizontal_projection=0
  fm=M(B(side+'Foot'));setworld(B(side+'Foot'),Matrix.LocRotScale(fm.translation,Q,fm.to_scale()));B(side+'ToeBase').matrix_basis=flat[side]['toe'];update();target.z=oldFoot.z-sole(side)+lift+.0004
  # Reach-only horizontal projection is diagnostic, not a root lift. The high
  # captured recovery needs the boot near the hip before the final outward step.
  H=P(B(side+'UpLeg'));l1=(P(B(side+'Leg'))-H).length;l2=(oldFoot-P(B(side+'Leg'))).length;dz=target.z-H.z;maxR=math.sqrt(max(0,(l1+l2-.0002)**2-dz*dz));delta=Vector((target.x-H.x,target.y-H.y,0))
  if delta.length>maxR:
   desired=H+delta.normalized()*maxR;horizontal_projection=(delta.length-maxR);target.x=desired.x;target.y=desired.y
  okay,margin=solve_leg(side,target,pole,roll)
  if okay:
   fm=M(B(side+'Foot'));setworld(B(side+'Foot'),Matrix.LocRotScale(fm.translation,Q,fm.to_scale()));B(side+'ToeBase').matrix_basis=flat[side]['toe'];update()
   # Exact evaluated boot surface, including calf weights. Iterate translation
   # without changing hip/torso or the requested foot pitch/roll.
   for repeat in range(4):
    error=lift+(.0004 if f not in [0,197]else 0)-sole(side)
    if abs(error)<.00002:break
    target=P(B(side+'Foot'));target.z+=error
    okay,margin=solve_leg(side,target,pole,roll)
    if not okay:break
    fm=M(B(side+'Foot'));setworld(B(side+'Foot'),Matrix.LocRotScale(fm.translation,Q,fm.to_scale()));B(side+'ToeBase').matrix_basis=flat[side]['toe'];update()
  if not okay:
   failures.append({'frame':f,'side':side,'reachMargin':margin,'target':list(target)});apply(capture)
  row['feet'][side]={'phase':phase,'intendedLift':lift,'target':list(target),'ankle':list(P(B(side+'Foot'))),'knee':list(P(B(side+'Leg'))),'ankleShift':(P(B(side+'Foot'))-oldFoot).length,'kneeShift':(P(B(side+'Leg'))-oldKnee).length,'horizontalReachProjection':horizontal_projection,'femurHingeChangeDegrees':math.degrees(hinge_error(side)-roll),'reachMargin':margin,'sole':sole(side)}
 if f in [0,197]:apply(raw[f])
 max_upper=max(max_upper,max(max(abs(M(bones[n])[i][j]-m[i][j])for i in range(4)for j in range(4))for n,m in original_world.items()))
 pose={b.name:b.matrix_basis.copy()for b in bones};row['maximumJointStepDegrees']=max((math.degrees(2*math.acos(min(1,abs(previous[n].to_quaternion().dot(pose[n].to_quaternion())))))for n in allowed),default=0)if previous else 0;previous=pose;samples.append(pose);rows.append(row)
 if f%30==0:print('FOOT_SUPPORT',f,{s:(round(row['feet'][s]['sole'],4),round(row['feet'][s]['horizontalReachProjection'],3))for s in ['Left','Right']},flush=True)
report={'source':'v75-slam-bounded-grip-review','status':'review only','allowedChangedBones':sorted(allowed),'maximumUnchangedWorldMatrixElementError':max_upper,'calibration':'accepted idle world Foot quaternion and ToeBase local matrix; yaw transported about world vertical, 3.8 degree heel-led settle at peak recovery height','steps':swings,'leadFoot':'Right; planted source64–160, including full cut/follow-through','failures':failures,'rows':rows}
json.dump(report,open(ROOT+'/docs/combat-revision/boss-'+TAG+'-report.json','w'),indent=2)
if failures:raise RuntimeError('No export: unsupported leg targets '+str(failures))
for t in list(rig.animation_data.nla_tracks):
 if t.name=='slam':rig.animation_data.nla_tracks.remove(t)
action=bpy.data.actions.new(TAG+'-slam');rig.animation_data.action=action;previous={}
for f,pose in enumerate(samples):
 for n,m in pose.items():
  b=bones[n];loc,q,scale=m.decompose()
  if n in previous and previous[n].dot(q)<0:q.negate()
  previous[n]=q.copy();b.location=loc;b.rotation_quaternion=q;b.scale=scale
  for field in ['location','rotation_quaternion','scale']:b.keyframe_insert(field,frame=f)
rig.animation_data.action=None;t=rig.animation_data.nla_tracks.new();t.name='slam';t.strips.new('slam',0,action)
for t in rig.animation_data.nla_tracks:t.mute=False
scene.frame_set(0);update();bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);body.select_set(True);bpy.context.view_layer.objects.active=rig
bpy.ops.wm.save_as_mainfile(filepath=OUT+'/boss-combat-candidate.blend')
bpy.ops.export_scene.gltf(filepath=OUT+'/boss-combat-candidate.glb',export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='NLA_TRACKS',export_nla_strips=True,export_frame_range=False,export_force_sampling=True,export_def_bones=False)
print('FOOT_SUPPORT_READY',OUT,'upperbody error',max_upper,'max joint step',max(r['maximumJointStepDegrees']for r in rows),flush=True)
