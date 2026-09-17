"""Concrete whole-slam review: solved strike, joint-space recovery, blade floor pass.
Writes only a new candidate. Source body and approved idle are preserved.
"""
import bpy,os,sys,json,math
import numpy as np
from mathutils import Vector,Quaternion,Matrix
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'));sys.path.insert(0,os.path.dirname(__file__))
from boss_grip_constraints import solve_grip_pair
TAG=os.environ.get('VESPER_SLAM_REVIEW_TAG','v38-slam-review');OUT=os.path.join(ROOT,'assets/combat-revision/boss',TAG);os.makedirs(OUT,exist_ok=True)
REGRIP=os.environ.get('VESPER_SLAM_REGRIP')=='1'
PURE_ROLL=os.environ.get('VESPER_SLAM_FLOOR_ROLL')=='1'
FORWARD_BOW=float(os.environ.get('VESPER_SLAM_FORWARD_BOW','0'))
LOWER_RELEASED_ARM=os.environ.get('VESPER_SLAM_LOWER_RELEASED_ARM')=='1'
CONTINUOUS_RELEASE_POLE=os.environ.get('VESPER_SLAM_CONTINUOUS_RELEASE_POLE')=='1'
SMOOTH_RELEASED_ARM=os.environ.get('VESPER_SLAM_SMOOTH_RELEASED_ARM')=='1'
previous_elbows={}
DIR=os.path.join(ROOT,'assets/combat-revision/boss/trajectory-context');meta=json.load(open(os.path.join(DIR,'context.json')));base=np.load(os.path.join(DIR,'slam.npz'))['poses'];idle={n:Matrix(m)for n,m in zip(meta['bones'],meta['idlePose'])};data=meta['clips']['slam'];N=len(base);START=int(os.environ.get('VESPER_SLAM_RECOVERY_START','130'))
cloud=np.asarray(json.load(open(os.path.join(ROOT,'docs/combat-revision/scythe-socket-vertex-cloud.json')))['xyz']).reshape((-1,3));tip=Vector(cloud[2762]);Z=Vector((0,0,1));frames={s:Quaternion(q)for s,q in meta['handFrames'].items()}
bpy.ops.wm.open_mainfile(filepath=os.environ.get('VESPER_SLAM_REVIEW_SOURCE',os.path.join(ROOT,'assets/combat-revision/boss/v24-whole-prefix-diagnostic/boss-combat-candidate.blend')))
scene=bpy.context.scene;rig=next(o for o in scene.objects if o.type=='ARMATURE');bones=rig.pose.bones;body=next(o for o in scene.objects if o.type=='MESH'and any(m.type=='ARMATURE'for m in o.modifiers));inv=rig.matrix_world.inverted()
for t in rig.animation_data.nla_tracks:t.mute=True
track=next(t for t in rig.animation_data.nla_tracks if t.name=='slam');strip=track.strips[0];rig.animation_data.action=strip.action;rig.animation_data.action_slot=strip.action_slot
poses=[];fallback_poses=[]
for f in range(N if os.environ.get('VESPER_SLAM_FALLBACK_SPLICE')=='1' else START+1):
 scene.frame_set(f);bpy.context.view_layer.update();p={p.name:p.matrix_basis.copy()for p in bones};fallback_poses.append(p)
 if f<=START:
  if os.environ.get('VESPER_SLAM_FALLBACK_SPLICE')=='1':
   def s0(v):v=max(0,min(1,v));return v*v*(3-2*v)
   prior=math.radians(18)*s0((f-72)/12)*(1-s0((f-108)/24))
   p['WeaponSocket']=p['WeaponSocket']@Quaternion(Vector((0,0,1)),-prior).to_matrix().to_4x4()
  poses.append(p)
rig.animation_data.action=None

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
def solve_arm(side,wrist,handQ):
 S=P(B(side+'Arm'));E=P(B(side+'ForeArm'));W=P(B(side+'Hand'));l1=(E-S).length;l2=(W-E).length;axis=(wrist-S).normalized();d=min((wrist-S).length,l1+l2-.002);wrist=S+axis*d
 along=(l1*l1-l2*l2+d*d)/(2*d);height=math.sqrt(max(0,l1*l1-along*along));pole=E-S;pole-=axis*pole.dot(axis)
 if CONTINUOUS_RELEASE_POLE and side=='Left' and side in previous_elbows:
  transported=previous_elbows[side]-S;transported-=axis*transported.dot(axis)
  if transported.length>1e-5:
   end_weight=smooth((f-160)/37)
   if os.environ.get('VESPER_SLAM_IDLE_POLE')=='1':
    pole=idleLeftElbow-idleLeftShoulder;pole-=axis*pole.dot(axis)
   pole=transported.normalized().lerp(pole.normalized(),end_weight) if pole.length>1e-5 else transported
 if pole.length<1e-5:pole=Vector((0,0,-1))-axis*axis.dot(Vector((0,0,-1)))
 elbow=S+axis*along+pole.normalized()*height;aim(B(side+'Arm'),B(side+'ForeArm'),elbow);aim(B(side+'ForeArm'),B(side+'Hand'),wrist);m=M(B(side+'Hand'));setworld(B(side+'Hand'),Matrix.LocRotScale(m.translation,handQ,m.to_scale()))
def grip(s):
 ps=[P(B(s+'Hand'+d+str(j)))for d in ['Index','Middle','Ring','Pinky']for j in [1,3]]
 return sum(ps,Vector())*(.8/len(ps))+P(B(s+'HandThumb3'))*.2

def fit_socket(Q,rear):
 left=grip('Left');right=grip('Right');C=(left+right)*.5;S=(left-right).length;A=(left-right).normalized();Q=(Q@Z).rotation_difference(A)@Q
 setworld(bones['WeaponSocket'],Matrix.LocRotScale(C-A*(rear+S*.5),Q,Vector((1,1,1))))
 return C,Q,S

apply({p.name:Matrix.Identity(4)for p in bones});leftNeutral=M(B('LeftForeArm')).to_quaternion().inverted()@M(B('LeftHand')).to_quaternion()
start=poses[-1];apply(start);previousQ=M(bones['WeaponSocket']).to_quaternion();idleQ=Quaternion(meta['idleResult']['quaternion']);rightRelativeStart=M(B('RightHand')).to_quaternion().inverted()@previousQ;initialSpacing=(grip('Left')-grip('Right')).length
apply(idle);idleLeftElbow=P(B('LeftForeArm'));idleLeftShoulder=P(B('LeftArm'));rightRelativeIdle=M(B('RightHand')).to_quaternion().inverted()@idleQ;leftRelativeIdle=idleQ.inverted()@M(B('LeftHand')).to_quaternion();apply(start)
def smooth(v):v=max(0,min(1,v));return v*v*(3-2*v)
planned=[]
for f in range(START+1,N):
 apply({n:Matrix(m)for n,m in zip(meta['bones'],base[f])});t=(f-START)/(N-1-START);w=t*t*(3-2*t)
 for side in ['Left','Right']:
  for suffix in ['Arm','ForeArm','Hand']:
   name='mixamorig:'+side+suffix;la,qa,sa=start[name].decompose();lb,qb,sb=idle[name].decompose();bones[name].matrix_basis=Matrix.LocRotScale(la.lerp(lb,w),qa.slerp(qb,w),sa.lerp(sb,w))
 update();left=grip('Left');right=grip('Right');A=(left-right).normalized();Q=(previousQ@Z).rotation_difference(A)@previousQ;target=(idleQ@Z).rotation_difference(A)@idleQ
 # Continuous blade roll approaches the approved idle, independently of grip.
 Q=Q.slerp(target,min(1,.05+.20*w));rear=.6+(.4-.6)*data[f]['sourceWeight']
 if REGRIP:
  if FORWARD_BOW and START+10<f<START+45:
   bow=FORWARD_BOW*math.sin(math.pi*(f-START-10)/35)**2;rightHand=M(B('RightHand'));solve_arm('Right',rightHand.translation+Vector((0,-bow,0)),rightHand.to_quaternion())
  Q=M(B('RightHand')).to_quaternion()@rightRelativeStart.slerp(rightRelativeIdle,w);A=Q@Z;spacing=initialSpacing+(.95-initialSpacing)*w;right=grip('Right');setworld(bones['WeaponSocket'],Matrix.LocRotScale(right-A*rear,Q,Vector((1,1,1))))
  if LOWER_RELEASED_ARM:
   lowered=smooth((f-START-8)/17);side=(P(B('LeftArm'))-P(B('RightArm'))).normalized();forward=side.cross(Z).normalized();goal=P(B('LeftArm'))+side*.14+forward*.08-Z*.52;hand=M(B('LeftHand'));qBefore=hand.to_quaternion()
   solve_arm('Left',hand.translation.lerp(goal,lowered),qBefore);m=M(B('LeftHand'));neutral=M(B('LeftForeArm')).to_quaternion()@leftNeutral;setworld(B('LeftHand'),Matrix.LocRotScale(m.translation,qBefore.slerp(neutral,lowered),m.to_scale()))
  opened=.65*smooth((f-START)/12)*(1-smooth((f-170)/20))
  for p in bones:
   if p.name.startswith('mixamorig:LeftHand')and p.name!='mixamorig:LeftHand':
    loc,q,scale=start[p.name].decompose();p.matrix_basis=Matrix.LocRotScale(loc,q.slerp(Quaternion(),opened),scale)
  update();approach=smooth((f-174)/18)
  if approach:
   targetHand=Q@leftRelativeIdle;targetW=right+A*spacing-targetHand@Vector(meta['localGrip']['Left']);current=M(B('LeftHand'));solve_arm('Left',current.translation.lerp(targetW,approach),current.to_quaternion().slerp(targetHand,approach))
 else:fit_socket(Q,rear)
 previousQ=Q
 if f==N-1:apply(idle)
 poses.append({p.name:p.matrix_basis.copy()for p in bones})
 previous_elbows['Left']=P(B('LeftForeArm'))


if os.environ.get('VESPER_SLAM_FALLBACK_SPLICE')=='1':
 branch_targets={}
 def branch_slerp(a,b,t,n):
  b=b.copy();reference=branch_targets.get(n,a)
  if reference.dot(b)<0:b.negate()
  branch_targets[n]=b.copy();dot=max(-1,min(1,a.dot(b)));angle=math.acos(dot)
  if angle<1e-7:return a.copy()
  sa=math.sin((1-t)*angle)/math.sin(angle);sb=math.sin(t*angle)/math.sin(angle)
  q=Quaternion(tuple(sa*x+sb*y for x,y in zip(a,b)));q.normalize();return q
 for f in range(160,N):
  w=smooth((f-160)/30)
  for suffix in ['Arm','ForeArm','Hand']:
   n='mixamorig:Left'+suffix;la,qa,sa=poses[160][n].decompose();lb,qb,sb=fallback_poses[f][n].decompose();poses[f][n]=Matrix.LocRotScale(la.lerp(lb,w),branch_slerp(qa,qb,w,n),sa.lerp(sb,w))

if SMOOTH_RELEASED_ARM:
 original=[{n:m.copy() for n,m in p.items()} for p in poses]
 for f in range(START+1,192):
  blend=smooth((f-START)/8)*(1-smooth((f-189)/3))
  for suffix in ['Arm','ForeArm','Hand']:
   name='mixamorig:Left'+suffix;loc,q,scale=original[f][name].decompose();acc=None;weight=0
   for j in range(max(START,f-4),min(192,f+5)):
    other=original[j][name].to_quaternion();w=math.exp(-.5*((j-f)/2.0)**2)
    if acc is None:acc=other;weight=w
    else:acc=acc.slerp(other,w/(weight+w));weight+=w
   poses[f][name]=Matrix.LocRotScale(loc,q.slerp(acc,blend),scale)

def weapon_parameters():
 left=grip('Left');right=grip('Right');Q=M(bones['WeaponSocket']).to_quaternion()
 if REGRIP and CURRENT_FRAME>START:
  w=smooth((CURRENT_FRAME-START)/(N-1-START));spacing=initialSpacing+(.95-initialSpacing)*w;return right+(Q@Z)*(spacing*.5),Q,spacing
 return (left+right)*.5,Q,(left-right).length

def floor(C,Q,S,rear):
 origin=C-(Q@Z)*(rear+S*.5);R=np.asarray(Q.to_matrix());return float(np.min(cloud@R[2,:]+origin.z))

# Derive a smooth conservative angular correction from every real blade vertex.
raw=[];orig=[]
for f,p in enumerate(poses):
 CURRENT_FRAME=f
 apply(p);C,Q,S=weapon_parameters();rear=.6+(.4-.6)*data[f]['sourceWeight'];lo=floor(C,Q,S,rear);axis=(Q@(tip-Z*(rear+S*.5))).cross(Z).normalized();theta=0.
 if lo<.005:
  a=0.;b=.30
  if floor(C,Quaternion(axis,b)@Q,S,rear)>=.005:
   for _ in range(24):
    m=(a+b)*.5
    if floor(C,Quaternion(axis,m)@Q,S,rear)<.005:a=m
    else:b=m
   theta=b
  else:theta=.30
 raw.append(theta);orig.append((C,Q,S,rear,axis,lo))
 print('ORIGINAL_FLOOR',f,lo,flush=True)if f==84 else None
angles=[max(raw[j]*(1 if j==f else .85 if abs(j-f)==1 else .55)for j in range(max(0,f-2),min(N,f+3)))for f in range(N)]
if PURE_ROLL:
 angles=[]
 for f,(C,Q,S,rear,axis,minimum)in enumerate(orig):
  theta=0
  if minimum<.005:
   a=0.;b=math.radians(60)
   for _ in range(24):
    m=(a+b)*.5
    if floor(C,Q@Quaternion(Z,m),S,rear)<.005:a=m
    else:b=m
   theta=b
  envelope=math.radians(18.0)*smooth((f-72)/12)*(1-smooth((f-108)/24))
  angles.append(max(theta,envelope))
report=[];failures=[]
for f,p in enumerate(poses):
 CURRENT_FRAME=f
 apply(p);C,Q,S,rear,axis,rawfloor=orig[f];theta=angles[f];status='unchanged';shift=0
 if REGRIP and f>START:
  if not PURE_ROLL:theta=0
  status='secondary hand regrip'
 if PURE_ROLL and theta>1e-7:
  Q=Q@Quaternion(Z,theta);setworld(bones['WeaponSocket'],Matrix.LocRotScale(C-(Q@Z)*(rear+S*.5),Q,Vector((1,1,1))));status='blade roll only'
 if theta>1e-7 and not PURE_ROLL:
  old={};arms={}
  for s in ['Left','Right']:
   frame=M(B(s+'Hand')).to_quaternion()@frames[s];A=frame@Vector((1,0,0));L=frame@Vector((0,1,0));normal=frame@Vector((0,0,1));E=P(B(s+'ForeArm'));W=P(B(s+'Hand'));shoulder=P(B(s+'Arm'));F=(W-E).normalized();beta=math.degrees(math.acos(max(-1,min(1,F.dot(L)))));gamma=math.degrees(math.atan2(F.dot(normal),F.dot(A)))
   if gamma>90:gamma-=180;beta=-beta
   if gamma<-90:gamma+=180;beta=-beta
   old[s]={'elbow':E,'wrist':W,'across':A,'long':L,'normal':normal,'bendDegrees':beta,'bendPlaneDegrees':gamma}
   arms[s]={'shoulder':shoulder,'upper_length':(E-shoulder).length,'forearm_length':(W-E).length,'grip_coefficients':frames[s].inverted()@Vector(meta['localGrip'][s]),'captured_elbow':E,'captured_wrist':W,'captured_long':L,'captured_normal':normal,'captured_orientation_weight':.5,'across_sign':1,'across_reference_axis':Q@Z,'across_reference':A,'across_weight':0,'bend_plane_degrees':gamma,'bend_plane_candidates':[-90,-60,-30,0,30,60,90,gamma]}
  targetQ=Quaternion(axis,theta)@Q;hands=None
  for shift in [0,.015,.03]:
   targetC=C+Z*shift;hands=solve_grip_pair(targetC,targetQ@Z,S,arms,old,maximum_bend_degrees=40,maximum_hand_angle_step=12,enforce_signed_bend_step=False)
   if hands:break
  if hands:
   for s,h in hands.items():
    handQ=Matrix((h['across'],h['long'],h['normal'])).transposed().to_quaternion()@frames[s].inverted();aim(B(s+'Arm'),B(s+'ForeArm'),h['elbow']);aim(B(s+'ForeArm'),B(s+'Hand'),h['wrist']);hm=M(B(s+'Hand'));setworld(B(s+'Hand'),Matrix.LocRotScale(hm.translation,handQ,hm.to_scale()))
    fore=B(s+'ForeArm');ax=(P(B(s+'Hand'))-P(fore)).normalized();a=M(fore).to_quaternion()@Vector(meta['forearmNormal'][s]);b=handQ@(frames[s]@Vector((0,0,1)));a-=ax*a.dot(ax);b-=ax*b.dot(ax)
    if min(a.length,b.length)>.0001:
     a.normalize();b.normalize();ang=math.atan2(ax.dot(a.cross(b)),a.dot(b));hm=M(B(s+'Hand')).copy();rotate(fore,Quaternion(ax,ang*data[f]['sourceWeight']));setworld(B(s+'Hand'),hm)
   C=targetC;Q=targetQ;setworld(bones['WeaponSocket'],Matrix.LocRotScale(C-(Q@Z)*(rear+S*.5),Q,Vector((1,1,1))));status='corrected'
  else:failures.append({'frame':f,'reason':'floor target unreachable within40-degree wrist and12-degree correction'});status='failed'
 if f in [0,N-1]:apply(idle)
 poses[f]={p.name:p.matrix_basis.copy()for p in bones};C,Q,S=weapon_parameters();minimum=floor(C,Q,S,rear)
 errors={s:(grip(s)-(M(bones['WeaponSocket']).translation+(Q@Z)*(rear+(S if s=='Left'else 0)))).length for s in ['Left','Right']};contactExpected=not REGRIP or f<=START or f>=192;error=max(errors.values())if contactExpected else errors['Right']
 report.append({'t':f/30,'spacing':S,'center':list(C),'shaft':list(Q@Z),'weaponQuaternion':list(Q),'rearAnchor':rear,'referenceCenter':list(orig[f][0]),'referenceQuaternion':list(orig[f][1]),'referenceShaft':list(orig[f][1]@Z),'gripError':error,'gripErrors':errors,'secondaryContactExpected':contactExpected,'floorBefore':rawfloor,'floorAfter':minimum,'floorCorrectionDegrees':math.degrees(theta),'weaponLiftMeters':shift if status=='corrected'else 0,'status':status})
for t in list(rig.animation_data.nla_tracks):
 if t.name=='slam':rig.animation_data.nla_tracks.remove(t)
action=bpy.data.actions.new(TAG+'-slam');rig.animation_data.action=action;previous={}
for f,p in enumerate(poses):
 for name,m in p.items():
  bone=bones[name];loc,q,scale=m.decompose()
  if name in previous and previous[name].dot(q)<0:q.negate()
  previous[name]=q.copy();bone.location=loc;bone.rotation_quaternion=q;bone.scale=scale
  for field in ['location','rotation_quaternion','scale']:bone.keyframe_insert(field,frame=f)
rig.animation_data.action=None;track=rig.animation_data.nla_tracks.new();track.name='slam';track.strips.new('slam',0,action);track.mute=True;apply(idle);scene.frame_start=0;scene.frame_end=788;scene.frame_set(0);update()
bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);body.select_set(True);bpy.context.view_layer.objects.active=rig
for t in rig.animation_data.nla_tracks:t.mute=False
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT,'boss-combat-candidate.blend'))
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT,'boss-combat-candidate.glb'),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='NLA_TRACKS',export_nla_strips=True,export_frame_range=False,export_force_sampling=True,export_def_bones=False)
result={'slam':{'sourceDuration':(N-1)/30,'samples':report,'recoveryMethod':'upper-arm/forearm/hand local quaternion settle, captured body unchanged, prop fitted through actual palm centers','failures':failures}}
json.dump(result,open(os.path.join(ROOT,'docs/combat-revision/boss-candidate-bake-'+TAG+'.json'),'w'),indent=2)
print('WHOLE_SLAM_REVIEW_READY',OUT,'floor',min(x['floorAfter']for x in report),'grip',max(x['gripError']for x in report),'failures',failures,flush=True)
