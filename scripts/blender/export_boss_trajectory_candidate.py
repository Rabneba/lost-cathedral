"""Bake a fully solved whole-trajectory candidate onto the approved rig copy."""
import bpy,os,sys,json,math
import numpy as np
from mathutils import Vector,Quaternion,Matrix
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'))
TAG=os.environ.get('VESPER_TRAJECTORY_TAG','v13-beam')
DIR=os.path.join(ROOT,'assets/combat-revision/boss/trajectory-context')
meta=json.load(open(os.path.join(DIR,'context.json')))
trajectory=json.load(open(os.path.join(ROOT,'docs/combat-revision/boss-trajectory-'+TAG+'.json')))
PREFIX_DIAGNOSTIC=os.environ.get('VESPER_TRAJECTORY_PREFIX_DIAGNOSTIC')=='1'
assert trajectory['status']=='complete'or PREFIX_DIAGNOSTIC,'Refuse to export incomplete path without explicit diagnostic mode'
OUTPUT_TAG=TAG+'-prefix-diagnostic'if PREFIX_DIAGNOSTIC else TAG
OUT=os.path.join(ROOT,'assets/combat-revision/boss',OUTPUT_TAG);os.makedirs(OUT,exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=os.path.join(DIR,'template.blend'))
scene=bpy.context.scene;rig=next(o for o in scene.objects if o.type=='ARMATURE');bones=rig.pose.bones
body=next(o for o in scene.objects if o.type=='MESH'and any(m.type=='ARMATURE'for m in o.modifiers))
inv=rig.matrix_world.inverted();FPS=30;scene.render.fps=FPS
rig.animation_data.action=None
for t in rig.animation_data.nla_tracks:t.mute=True
def update():bpy.context.view_layer.update()
def B(n):return bones['mixamorig:'+n]
def M(p):return rig.matrix_world@p.matrix
def P(p):return M(p).translation.copy()
def apply(pose):
 for n,m in zip(meta['bones'],pose):bones[n].matrix_basis=Matrix(m)
 update()
def setworld(p,m):p.matrix=inv@m;update()
def rotate(p,q):
 m=M(p);v=m.translation.copy();setworld(p,Matrix.Translation(v)@q.to_matrix().to_4x4()@Matrix.Translation(-v)@m)
def aim(p,child,target):
 a=P(child)-P(p);b=target-P(p)
 if min(a.length,b.length)>1e-6:rotate(p,a.normalized().rotation_difference(b.normalized()))
def grip(s):
 ps=[P(B(s+'Hand'+d+str(j)))for d in ['Index','Middle','Ring','Pinky']for j in [1,3]]
 return sum(ps,Vector())*(.8/len(ps))+P(B(s+'HandThumb3'))*.2
reports={}
for clip,solved in trajectory['clips'].items():
 assert solved['complete']or PREFIX_DIAGNOSTIC,clip
 data=meta['clips'][clip];references=trajectory.get('referenceOverrides',{}).get(clip,data);base=np.load(os.path.join(DIR,clip+'.npz'))['poses'];poses=[];report=[]
 for f,result in enumerate(solved['samples']):
  apply(base[f]);source_weight=data[f]['sourceWeight'];handq={};original={s:{'q':M(B(s+'Hand')).to_quaternion(),'wrist':P(B(s+'Hand'))}for s in result['hands']}
  for s,hand in result['hands'].items():
   frame=Matrix((Vector(hand['across']),Vector(hand['long']),Vector(hand['normal']))).transposed().to_quaternion()
   handq[s]=frame@Quaternion(meta['handFrames'][s]).inverted()
   aim(B(s+'Arm'),B(s+'ForeArm'),Vector(hand['elbow']));aim(B(s+'ForeArm'),B(s+'Hand'),Vector(hand['wrist']))
   hm=M(B(s+'Hand'));setworld(B(s+'Hand'),Matrix.LocRotScale(hm.translation,handq[s],hm.to_scale()))
  for s,q in handq.items():
   fore=B(s+'ForeArm');axis=(P(B(s+'Hand'))-P(fore)).normalized()
   a=M(fore).to_quaternion()@Vector(meta['forearmNormal'][s]);b=q@(Quaternion(meta['handFrames'][s])@Vector((0,0,1)))
   a-=axis*a.dot(axis);b-=axis*b.dot(axis)
   if min(a.length,b.length)>.0001:
    a.normalize();b.normalize();angle=math.atan2(axis.dot(a.cross(b)),a.dot(b))
    hm=M(B(s+'Hand')).copy();rotate(fore,Quaternion(axis,angle*source_weight));setworld(B(s+'Hand'),hm)
  C=Vector(result['center']);Q=Quaternion(result['quaternion']);A=Q@Vector((0,0,1));spacing=result['spacing'];rear=result.get('rear',.6+(trajectory.get('rearTarget',.04)-.6)*source_weight)
  setworld(bones['WeaponSocket'],Matrix.LocRotScale(C-A*(rear+spacing*.5),Q,Vector((1,1,1))))
  if f in [0,len(base)-1]:apply(meta['idlePose'])
  poses.append({p.name:p.matrix_basis.copy()for p in bones})
  report.append({'t':f/FPS,'spacing':spacing,'center':list(C),'shaft':list(A),'weaponQuaternion':list(Q),'rearAnchor':rear,
   'referenceCenter':references[f]['center'],'referenceQuaternion':references[f]['quaternion'],'referenceShaft':list(Quaternion(references[f]['quaternion'])@Vector((0,0,1))),
   'gripError':max((grip(s)-(C+A*spacing*.5*(1 if s=='Left'else-1))).length for s in result['hands']),
   'wristShift':{s:(P(B(s+'Hand'))-original[s]['wrist']).length for s in original}})
 for t in list(rig.animation_data.nla_tracks):
  if t.name==clip:rig.animation_data.nla_tracks.remove(t)
 action=bpy.data.actions.new(TAG+'-'+clip);rig.animation_data.action=action;previous={}
 for f,pose in enumerate(poses):
  for name,m in pose.items():
   p=bones[name];loc,q,sc=m.decompose()
   if name in previous and previous[name].dot(q)<0:q.negate()
   previous[name]=q.copy();p.location=loc;p.rotation_quaternion=q;p.scale=sc
   for channel in ['location','rotation_quaternion','scale']:p.keyframe_insert(channel,frame=f)
 rig.animation_data.action=None;track=rig.animation_data.nla_tracks.new();track.name=clip;track.strips.new(clip,0,action);track.mute=True
 reports[clip]={'sourceDuration':(len(poses)-1)/FPS,'samples':report}
 print('TRAJECTORY_BAKED',clip,'frames',len(poses),'grip',max(x['gripError']for x in report),flush=True)
apply(meta['idlePose']);scene.frame_start=0;scene.frame_end=788;scene.frame_set(0);update()
bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);body.select_set(True);bpy.context.view_layer.objects.active=rig
for o in scene.objects:
 if o not in [rig,body]:o.hide_render=True
for t in rig.animation_data.nla_tracks:t.mute=False
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT,'boss-combat-candidate.blend'))
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT,'boss-combat-candidate.glb'),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='NLA_TRACKS',export_nla_strips=True,export_frame_range=False,export_force_sampling=True,export_def_bones=False)
json.dump(reports,open(os.path.join(ROOT,'docs/combat-revision/boss-candidate-bake-'+OUTPUT_TAG+'.json'),'w'),indent=2)
print('PREFIX_DIAGNOSTIC_READY'if PREFIX_DIAGNOSTIC else'CONTINUOUS_CANDIDATE_READY',OUT,flush=True)
