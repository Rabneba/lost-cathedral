"""Whole sweep review: visible choke-up preparation, constrained two-hand stroke,
then visible recovery regrip. Approved body mesh remains unchanged.
"""
import bpy,os,sys,json,math
import numpy as np
from mathutils import Vector,Quaternion,Matrix
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'));TAG=os.environ.get('VESPER_WHOLE_SWEEP_TAG','v57-close-whole');OUT=os.path.join(ROOT,'assets/combat-revision/boss',TAG);os.makedirs(OUT,exist_ok=True);DIR=os.path.join(ROOT,'assets/combat-revision/boss/trajectory-context');meta=json.load(open(os.path.join(DIR,'context.json')));base=np.load(os.path.join(DIR,'sweep.npz'))['poses'];N=len(base);idle={n:Matrix(m)for n,m in zip(meta['bones'],meta['idlePose'])};Z=Vector((0,0,1));cloud=np.asarray(json.load(open(os.path.join(ROOT,'docs/combat-revision/scythe-socket-vertex-cloud.json')))['xyz']).reshape((-1,3));bpy.ops.wm.open_mainfile(filepath=os.path.join(ROOT,'assets/combat-revision/boss/v55-close-stroke-prefix-diagnostic/boss-combat-candidate.blend'));scene=bpy.context.scene;rig=next(o for o in scene.objects if o.type=='ARMATURE');bones=rig.pose.bones;body=next(o for o in scene.objects if o.type=='MESH'and any(m.type=='ARMATURE'for m in o.modifiers));inv=rig.matrix_world.inverted();FPS=30
for t in rig.animation_data.nla_tracks:t.mute=True
tr=next(t for t in rig.animation_data.nla_tracks if t.name=='sweep');st=tr.strips[0];rig.animation_data.action=st.action;rig.animation_data.action_slot=st.action_slot;captured=[]
for f in range(111):scene.frame_set(f);bpy.context.view_layer.update();captured.append({p.name:p.matrix_basis.copy()for p in bones})
rig.animation_data.action=None

ACTIVE_REAR=float(os.environ.get('VESPER_SWEEP_ACTIVE_REAR','.8'))

def smooth(v):v=max(0,min(1,v));return v*v*(3-2*v)
def update():bpy.context.view_layer.update()
def B(n):return bones['mixamorig:'+n]
def M(p):return rig.matrix_world@p.matrix
def P(p):return M(p).translation.copy()
def apply(p):
 for n,m in p.items():bones[n].matrix_basis=m
 update()
def grip(s):
 ps=[P(B(s+'Hand'+d+str(j)))for d in ['Index','Middle','Ring','Pinky']for j in [1,3]]
 return sum(ps,Vector())*(.8/len(ps))+P(B(s+'HandThumb3'))*.2

def setworld(p,m):p.matrix=inv@m;update()
def aim(p,child,target):
 m=M(p);a=P(child)-m.translation;b=target-m.translation
 if min(a.length,b.length)<1e-7:return
 q=a.normalized().rotation_difference(b.normalized());v=m.translation.copy();setworld(p,Matrix.Translation(v)@q.to_matrix().to_4x4()@Matrix.Translation(-v)@m)
def solve_arm(side,wrist,handQ):
 S=P(B(side+'Arm'));E=P(B(side+'ForeArm'));W=P(B(side+'Hand'));l1=(E-S).length;l2=(W-E).length;axis=(wrist-S).normalized();d=min((wrist-S).length,l1+l2-.002);wrist=S+axis*d;along=(l1*l1-l2*l2+d*d)/(2*d);height=math.sqrt(max(0,l1*l1-along*along));pole=E-S;pole-=axis*pole.dot(axis)
 if pole.length<1e-5:pole=Vector((0,0,-1))-axis*axis.dot(Vector((0,0,-1)))
 elbow=S+axis*along+pole.normalized()*height;aim(B(side+'Arm'),B(side+'ForeArm'),elbow);aim(B(side+'ForeArm'),B(side+'Hand'),wrist);m=M(B(side+'Hand'));setworld(B(side+'Hand'),Matrix.LocRotScale(m.translation,handQ,m.to_scale()))

def state(p):
 apply(p);Q=M(bones['WeaponSocket']).to_quaternion();R=M(B('RightHand')).to_quaternion();return {'Q':Q,'relative':R.inverted()@Q,'spacing':(grip('Left')-grip('Right')).length}
idleState=state(idle);prepState=state(captured[40]);endState=state(captured[110]);poses=[];rows=[]
for f in range(N):
 apply({n:Matrix(m)for n,m in zip(meta['bones'],base[f])});contact=40<=f<=110 or f in[0,N-1]
 if 40<=f<=110:
  apply(captured[f]);rear=ACTIVE_REAR;wm=M(bones['WeaponSocket']);wm.translation-=(wm.to_quaternion()@Z)*(ACTIVE_REAR-.8);setworld(bones['WeaponSocket'],wm);spacing=(grip('Left')-grip('Right')).length;phase='two-hand windup, strike and follow-through'
 else:
  preparing=f<40;start=idle if preparing else captured[110];finish=captured[40]if preparing else idle;t=f/40 if preparing else(f-110)/(N-1-110);w=smooth(t);first=idleState if preparing else endState;last=prepState if preparing else idleState
  for side in ['Left','Right']:
   for suffix in ['Arm','ForeArm','Hand']:
    n='mixamorig:'+side+suffix;la,qa,sa=start[n].decompose();lb,qb,sb=finish[n].decompose();bones[n].matrix_basis=Matrix.LocRotScale(la.lerp(lb,w),qa.slerp(qb,w),sa.lerp(sb,w))
  # The secondary hand opens visibly while the primary palm controls the rod.
  opened=.65*smooth(f/8)*(1-smooth((f-24)/16))if preparing else .65*smooth((f-110)/12)*(1-smooth((f-176)/18))
  for p in bones:
   if p.name.startswith('mixamorig:LeftHand')and p.name!='mixamorig:LeftHand':
    la,qa,sa=start[p.name].decompose();lb,qb,sb=finish[p.name].decompose();p.matrix_basis=Matrix.LocRotScale(la.lerp(lb,w),qa.slerp(qb,w).slerp(Quaternion(),opened),sa.lerp(sb,w))
  update()
  if not preparing and os.environ.get('VESPER_SWEEP_RECOVERY_BOW'):
   bow=float(os.environ['VESPER_SWEEP_RECOVERY_BOW'])*smooth((f-112)/13)*(1-smooth((f-137)/18));hand=M(B('RightHand'));solve_arm('Right',hand.translation+Vector((0,-bow,0)),hand.to_quaternion())
  Q=M(B('RightHand')).to_quaternion()@first['relative'].slerp(last['relative'],w);A=Q@Z;rear=.6+(ACTIVE_REAR-.6)*w if preparing else ACTIVE_REAR-(ACTIVE_REAR-.6)*w;spacing=first['spacing']+(last['spacing']-first['spacing'])*w;origin=grip('Right')-A*rear;bones['WeaponSocket'].matrix=inv@Matrix.LocRotScale(origin,Q,Vector((1,1,1)));update();phase='visible preparatory choke-up regrip'if preparing else'visible recovery regrip'
 if os.environ.get('VESPER_SWEEP_BLADE_ROLL'):
  roll_weight=smooth(f/40)if f<40 else 1 if f<=110 else 1-smooth((f-110)/(N-1-110));wm=M(bones['WeaponSocket']);Q=wm.to_quaternion()@Quaternion(Z,math.radians(float(os.environ['VESPER_SWEEP_BLADE_ROLL']))*roll_weight);setworld(bones['WeaponSocket'],Matrix.LocRotScale(wm.translation,Q,wm.to_scale()))
 if f in[0,N-1]:apply(idle);rear=.6;spacing=.95
 Q=M(bones['WeaponSocket']).to_quaternion();A=Q@Z;origin=M(bones['WeaponSocket']).translation;right=grip('Right');left=grip('Left');C=right+A*spacing*.5;floor=float(np.min(cloud@np.asarray(Q.to_matrix())[2,:]+origin.z));errors={'Right':(right-origin-A*rear).length,'Left':(left-origin-A*(rear+spacing)).length}
 poses.append({p.name:p.matrix_basis.copy()for p in bones});rows.append({'t':f/30,'center':list(C),'shaft':list(A),'weaponQuaternion':list(Q),'spacing':spacing,'rearAnchor':rear,'referenceCenter':list(C),'referenceQuaternion':list(Q),'referenceShaft':list(A),'secondaryContactExpected':contact,'gripErrors':errors,'gripError':max(errors.values())if contact else errors['Right'],'floorAfter':floor,'phase':phase})
for t in list(rig.animation_data.nla_tracks):
 if t.name=='sweep':rig.animation_data.nla_tracks.remove(t)
action=bpy.data.actions.new(TAG+'-sweep');rig.animation_data.action=action;previous={}
for f,p in enumerate(poses):
 for name,m in p.items():
  bone=bones[name];loc,q,scale=m.decompose()
  if name in previous and previous[name].dot(q)<0:q.negate()
  previous[name]=q.copy();bone.location=loc;bone.rotation_quaternion=q;bone.scale=scale
  for field in ['location','rotation_quaternion','scale']:bone.keyframe_insert(field,frame=f)
rig.animation_data.action=None;track=rig.animation_data.nla_tracks.new();track.name='sweep';track.strips.new('sweep',0,action);track.mute=True;apply(idle);scene.frame_start=0;scene.frame_end=788;scene.frame_set(0);update();bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);body.select_set(True);bpy.context.view_layer.objects.active=rig
for t in rig.animation_data.nla_tracks:t.mute=False
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT,'boss-combat-candidate.blend'));bpy.ops.export_scene.gltf(filepath=os.path.join(OUT,'boss-combat-candidate.glb'),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='NLA_TRACKS',export_nla_strips=True,export_frame_range=False,export_force_sampling=True,export_def_bones=False)
report={'sweep':{'sourceDuration':(N-1)/30,'twoHandSourceWindow':[40/30,110/30],'candidateStrikeWindow':[60/30,100/30],'samples':rows,'failures':[]}};json.dump(report,open(os.path.join(ROOT,'docs/combat-revision/boss-candidate-bake-'+TAG+'.json'),'w'),indent=2);print('WHOLE_SWEEP_REVIEW_READY',OUT,'floor',min(r['floorAfter']for r in rows),'contact',max(r['gripError']for r in rows),flush=True)
