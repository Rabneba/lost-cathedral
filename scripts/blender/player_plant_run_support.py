"""Match stance-foot travel to the runtime gait speed, retaining source swing and foot roll."""
import bpy,os,math,json
from mathutils import Matrix,Vector,Quaternion
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'));bpy.ops.wm.open_mainfile(filepath=ROOT+'/assets/player-essential-motion/player-footfall-study.blend');scene=bpy.context.scene;rig=next(o for o in scene.objects if o.type=='ARMATURE');body=next(o for o in scene.objects if o.type=='MESH'and not o.hide_render);bones=rig.pose.bones;inv=rig.matrix_world.inverted();tracks=list(rig.animation_data.nla_tracks);meta=json.load(open(ROOT+'/docs/player-essential-manifest.json'));report={}
for tr in tracks:tr.mute=True

def update():bpy.context.view_layer.update()
def B(n):return bones['mixamorig:'+n]
def wm(b):return rig.matrix_world@b.matrix
def pose(a,f):
 rig.animation_data.action=a;rig.animation_data.action_slot=a.slots[0];scene.frame_set(f);update();p={b.name:(b.location.copy(),b.rotation_quaternion.copy(),b.scale.copy())for b in bones};rig.animation_data.action=None
 for n,(l,q,s)in p.items():b=bones[n];b.location=l;b.rotation_quaternion=q;b.scale=s
 update();return p

def setworld(b,m):b.matrix=inv@m;update()
def rotateworld(b,q):
 m=wm(b);setworld(b,Matrix.LocRotScale(m.translation,q@m.to_quaternion(),m.to_scale()))
def aim(b,c,p):
 o=wm(b).translation;old=wm(c).translation-o;new=p-o
 if min(old.length,new.length)>1e-6:rotateworld(b,old.normalized().rotation_difference(new.normalized()))
def chain(side,target):
 a,b,c=B(side+'UpLeg'),B(side+'Leg'),B(side+'Foot');s=wm(a).translation;e=wm(b).translation;w=wm(c).translation;l1=(e-s).length;l2=(w-e).length;v=target-s;axis=v.normalized();d=max(abs(l1-l2)+.001,min(v.length,l1+l2-.001));x=(l1*l1-l2*l2+d*d)/(2*d);h=math.sqrt(max(0,l1*l1-x*x));p=e-s;p=(p-axis*p.dot(axis)).normalized();aim(a,b,s+axis*x+p*h);aim(b,c,target);return(wm(c).translation-target).length

def ease(u):u=max(0,min(1,u));return u*u*(3-2*u)
for tr in tracks:
 name=tr.name
 if not name.startswith('run-'):continue
 action=tr.strips[0].action;period=round(action.frame_range[1]);speed=meta['clips'][name]['sourceSpeed'];x=(1 if 'left'in name else -1 if 'right'in name else 0);y=(-1 if 'forward'in name else 1 if 'back'in name else 0);opposite=-Vector((x,y,0)).normalized();raw=[];feet={s:[]for s in ['Left','Right']}
 pose(action,0);sw=wm(B('RightHand')).inverted()@wm(bones['WeaponSocket']);sh=wm(B('LeftHand')).inverted()@wm(bones['ShieldSocket'])
 for f in range(period+1):
  raw.append(pose(action,f))
  for side in feet:feet[side].append(wm(B(side+'Foot')).copy())
 velocity={};phases={}
 for side,matrices in feet.items():
  points=[m.translation.copy()for m in matrices];proj=[p.dot(opposite)for p in points[:-1]];vel=[(proj[(i+1)%period]-proj[(i-1)%period])*15 for i in range(period)];vel=[(vel[(i-1)%period]+2*vel[i]+vel[(i+1)%period])/4 for i in range(period)];velocity[side]=vel;phases[side]=[];start=None
  for f in range(-period,2*period+1):
   active=vel[f%period]>.25
   if active and start is None:start=f
   if not active and start is not None:
    if f-start>=3:phases[side].append((start,f-1))
    start=None
 samples=[];errors=[];corrections=[]
 for f in range(period+1):
  ff=f%period
  for n,(l,q,s)in raw[f].items():b=bones[n];b.location=l;b.rotation_quaternion=q;b.scale=s
  update()
  for side in ['Left','Right']:
   fm=feet[side][f];target=fm.translation.copy();phase=next(((s,e)for s,e in phases[side]if s<=f<=e),None);weight=0
   if phase:
    s,e=phase;mid=(s+e)/2;lo=math.floor(mid);u=mid-lo;anchor=feet[side][lo%period].translation.lerp(feet[side][(lo+1)%period].translation,u);locked=anchor+opposite*(speed*(f-mid)/30);weight=min(ease((f-s)/1.5),ease((e-f)/1.5));target=target.lerp(locked,weight)
   # A recovering foot must clear the ground before moving forward.
   swing=ease((-velocity[side][ff]-.15)/1.5);target.z+=.035*swing
   corrections.append((target-fm.translation).length);errors.append(chain(side,target));now=wm(B(side+'Foot'));setworld(B(side+'Foot'),Matrix.LocRotScale(now.translation,fm.to_quaternion(),now.to_scale()))
  bones['WeaponSocket'].matrix=inv@(wm(B('RightHand'))@sw);bones['ShieldSocket'].matrix=inv@(wm(B('LeftHand'))@sh);update();samples.append({b.name:(b.location.copy(),b.rotation_quaternion.copy(),b.scale.copy())for b in bones})
 samples[-1]={n:(l.copy(),q.copy(),s.copy())for n,(l,q,s)in samples[0].items()}
 rig.animation_data.action=action;rig.animation_data.action_slot=action.slots[0]
 for f,p in enumerate(samples):
  for n,(l,q,s)in p.items():b=bones[n];b.location=l;b.rotation_quaternion=q;b.scale=s;b.keyframe_insert('location',frame=f);b.keyframe_insert('rotation_quaternion',frame=f);b.keyframe_insert('scale',frame=f)
 report[name]={'maxTargetCorrectionMeters':max(corrections),'maxLegReachErrorMeters':max(errors),'stanceSpeed':speed,'direction':list(opposite),'runtimeMetadataChanged':False};print('PLANTED',name,report[name],flush=True)
rig.animation_data.action=None
for b in bones:b.matrix_basis.identity()
for tr in tracks:tr.mute=False
bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);body.select_set(True);bpy.context.view_layer.objects.active=rig
bpy.ops.wm.save_as_mainfile(filepath=ROOT+'/assets/player-essential-motion/player-footfall-support-study.blend')
bpy.ops.export_scene.gltf(filepath=ROOT+'/assets/player-essential-motion/player-footfall-support-study.glb',export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='NLA_TRACKS',export_nla_strips=True,export_frame_range=False,export_force_sampling=True,export_def_bones=False)
json.dump(report,open(ROOT+'/docs/player-run-support-refinement.json','w'),indent=2);print('RUN_SUPPORT_REFINEMENT_COMPLETE',flush=True)
