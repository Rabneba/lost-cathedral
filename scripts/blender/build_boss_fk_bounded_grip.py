"""Minimal captured-FK preparation clearance pass, without authored strike targets.
Translate the captured palms together briefly; preserve captured elbow pole and
humerus hinge orientation. No change to active source arm poses.
"""
import bpy,os,json,math,sys
import numpy as np
from mathutils import Vector,Quaternion,Matrix
from mathutils.bvhtree import BVHTree
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'));sys.path.insert(0,os.path.dirname(__file__));from boss_grip_constraints import shaft_clearance
TAG=os.environ.get('VESPER_FK_PREP_TAG','v75-slam-bounded-grip-review');OUT=os.path.join(ROOT,'assets/combat-revision/boss',TAG);os.makedirs(OUT,exist_ok=True);meta=json.load(open(os.path.join(ROOT,'assets/combat-revision/boss/trajectory-context/context.json')));sections=[(Vector(c),r)for c,r in meta['shaftSections']];bpy.ops.wm.open_mainfile(filepath=os.path.join(ROOT,'assets/combat-revision/boss/v74-slam-terminal-roll-review/boss-combat-candidate.blend'));scene=bpy.context.scene;rig=next(o for o in scene.objects if o.type=='ARMATURE');bones=rig.pose.bones;body=next(o for o in scene.objects if o.type=='MESH'and any(m.type=='ARMATURE'for m in o.modifiers));inv=rig.matrix_world.inverted();rig.animation_data.action=None
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


raw=[{n:m.copy()for n,m in p.items()}for p in poses];turnover=json.load(open(os.path.join(ROOT,'docs/combat-revision/boss-turnover-v74-report.json')))['samples'];targets={};dataRows={};grid=np.arange(-78.,78.001,2.);Z=Vector((0,0,1));X=Vector((1,0,0));Y=Vector((0,1,0))
def pronation(s):
 S,E,W=P(B(s+'Arm')),P(B(s+'ForeArm')),P(B(s+'Hand'));F=(W-E).normalized();upper=(E-S).normalized();hinge=upper.cross(F).normalized();neutral=hinge.cross(F).normalized();thumb=(P(B(s+'HandIndex1'))-P(B(s+'HandPinky1')));thumb-=F*thumb.dot(F);thumb.normalize();return math.atan2(F.dot(neutral.cross(thumb)),neutral.dot(thumb))
for side in ['Left','Right']:
 costs=[];records=[]
 for f in range(198):
  apply(raw[f]);F=(P(B(side+'Hand'))-P(B(side+'ForeArm'))).normalized();A=(P(B(side+'HandIndex1'))-P(B(side+'HandPinky1'))).normalized();shaft=M(bones['WeaponSocket']).to_quaternion()@Z;phi=math.degrees(pronation(side));release=turnover[f]['secondaryOpenWeight']/.7 if side=='Left'else 0.;row=[]
  for theta in grid:
   candidate=Quaternion(F,math.radians(float(theta-phi)))@A;error=math.acos(min(1,abs(candidate.dot(shaft))));row.append(10*(1-release)**2*error*error+(.025+release*3)*((theta-phi)/80)**2)
  costs.append(row);records.append({'frame':f,'sourcePronation':phi,'release':release})
 costs=np.asarray(costs);transition=.28*((grid[:,None]-grid[None,:])/10)**2;transition[np.abs(grid[:,None]-grid[None,:])>12]=np.inf
 costs[0]+=1000*((grid-records[0]['sourcePronation'])/2)**2;costs[-1]+=1000*((grid-records[-1]['sourcePronation'])/2)**2;dp=costs[0].copy();backs=[]
 for f in range(1,198):z=dp[:,None]+transition;back=np.argmin(z,axis=0);dp=costs[f]+z[back,np.arange(len(grid))];backs.append(back)
 idx=int(np.argmin(dp));indices=[idx]
 for back in reversed(backs):idx=int(back[idx]);indices.append(idx)
 theta=grid[list(reversed(indices))];theta=np.convolve(np.pad(theta,(1,1),mode='edge'),[.2,.6,.2],mode='valid');theta[0]=records[0]['sourcePronation'];theta[-1]=records[-1]['sourcePronation'];targets[side]=theta;dataRows[side]=records
rows=[];failures=[]
for f in range(198):
 apply(raw[f]);row={'frame':f,'time':f/30,'hands':{}}
 for side in ['Left','Right']:
  capture={n:b.matrix_basis.copy()for n,b in bones.items()};G=grip(side);oldFQ=M(B(side+'ForeArm')).to_quaternion();oldHQ=M(B(side+'Hand')).to_quaternion();relative=oldFQ.inverted()@oldHQ;oldW=P(B(side+'Hand'));localGrip=oldHQ.inverted()@(G-oldW);F0=(oldW-P(B(side+'ForeArm'))).normalized();phi0=math.degrees(pronation(side));hinge0=hinge_error(side);release=dataRows[side][f]['release'];desired=phi0+(float(targets[side][f])-phi0)*(1-release);delta=desired-phi0;okay=True
  for iteration in range(5):
   apply(capture);targetHQ=Quaternion(F0,math.radians(delta))@oldHQ;targetW=G-targetHQ@localGrip
   if not move_arm(side,targetW-oldW):okay=False;break
   fm=M(B(side+'ForeArm'));targetFQ=targetHQ@relative.inverted();setworld(B(side+'ForeArm'),Matrix.LocRotScale(fm.translation,targetFQ,fm.to_scale()));aim(B(side+'ForeArm'),B(side+'Hand'),targetW);hm=M(B(side+'Hand'));setworld(B(side+'Hand'),Matrix.LocRotScale(hm.translation,targetHQ,hm.to_scale()));actual=math.degrees(pronation(side));error=(desired-actual+180)%360-180
   if abs(error)<.05:break
   delta+=error
  if not okay:apply(capture);failures.append({'frame':f,'side':side,'reason':'grip wrist reach'})
  W=P(B(side+'Hand'));long=(P(B(side+'HandMiddle1'))-W).normalized();fore=(W-P(B(side+'ForeArm'))).normalized();row['hands'][side]={'desiredPronation':desired,'actualPronation':math.degrees(pronation(side)),'wristBend':math.degrees(long.angle(fore)),'wristShift':(W-oldW).length,'palmResidual':(grip(side)-G).length,'humerusHingeChange':math.degrees(hinge_error(side)-hinge0)}
 if f in[0,197]:apply(raw[f])
 poses[f]={b.name:b.matrix_basis.copy()for b in bones};rows.append(row)
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
scene.frame_set(0);update();bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);body.select_set(True);bpy.context.view_layer.objects.active=rig;bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT,'boss-combat-candidate.blend'));bpy.ops.export_scene.gltf(filepath=os.path.join(OUT,'boss-combat-candidate.glb'),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='NLA_TRACKS',export_nla_strips=True,export_frame_range=False,export_force_sampling=True,export_def_bones=False);json.dump({'status':'bounded-grip review; no promotion','source':'v74-slam-terminal-roll-review','method':'temporal DP geometric pronation within78degrees, fixed palm center, captured hinge/pole; no weapon path changes','samples':rows,'failures':failures},open(os.path.join(ROOT,'docs/combat-revision/boss-bounded-grip-v75-report.json'),'w'),indent=2);print('BOUNDED_GRIP_READY',OUT,'failures',failures,'maximums',{s:{k:max(abs(r['hands'][s][k])for r in rows)for k in ['actualPronation','wristBend','wristShift','palmResidual','humerusHingeChange']}for s in ['Left','Right']},flush=True)
