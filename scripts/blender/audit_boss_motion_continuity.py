"""Read-only current boss clip kinematics, grip residual and idle-boundary audit."""
import bpy,os,json,math
import numpy as np
from mathutils import Vector, Quaternion
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'))
TAG=os.environ.get('VESPER_MOTION_AUDIT_TAG','v7')
PATH=os.environ.get('VESPER_MOTION_AUDIT_BLEND','/tmp/vesper-boss-candidate-'+TAG+'.blend')
bpy.ops.wm.open_mainfile(filepath=PATH)
scene=bpy.context.scene;rig=next(o for o in scene.objects if o.type=='ARMATURE');bones=rig.pose.bones
report=json.load(open(os.path.join(ROOT,'docs/combat-revision/boss-candidate-bake-'+TAG+'.json')))
FPS=scene.render.fps
for t in rig.animation_data.nla_tracks:t.mute=True
def use(name):
 strip=next(t for t in rig.animation_data.nla_tracks if t.name==name).strips[0]
 rig.animation_data.action=strip.action;rig.animation_data.action_slot=strip.action_slot
 return round(strip.action_frame_start),round(strip.action_frame_end)
def mat(p):return rig.matrix_world@p.matrix
def pos(n):return mat(bones['mixamorig:'+n]).translation.copy()
def grip(s):
 ps=[pos(s+'Hand'+d+str(j))for d in ['Index','Middle','Ring','Pinky']for j in [1,3]]
 return sum(ps,Vector())*(.8/len(ps))+pos(s+'HandThumb3')*.2
def snapshot():
 return {p.name:{'local':p.matrix_basis.copy(),'world':mat(p).copy()}for p in bones}
def qdistance(a,b):
 v=math.degrees(a.rotation_difference(b).angle);return min(v,360-v)
def compact(series):
 a=np.asarray(series,dtype=float);return {'max':float(np.max(a)),'mean':float(np.mean(a)),'p95':float(np.percentile(a,95))}
use('idle');scene.frame_set(0);bpy.context.view_layer.update();idle=snapshot()
result={'blend':PATH,'fps':FPS,'idleReference':'idle frame 0, same approved track retained in candidate','clips':{}}
for clip in [c for c in ['sweep','slam']if c in report]:
 first,last=use(clip);samples=[];boundary={};previous=None
 for f in range(first,last+1):
  scene.frame_set(f);bpy.context.view_layer.update();wm=mat(bones['WeaponSocket']);q=wm.to_quaternion()
  axis=q@Vector((0,0,1));center=(grip('Left')+grip('Right'))*.5
  sample={'frame':f,'time':(f-first)/FPS,'weaponQuaternion':list(q),'weaponOrigin':list(wm.translation),'gripCenter':list(center),'shaftAxis':list(axis),'hands':{},'landmarks':{}}
  r=report[clip]['samples'][f-first];C=Vector(r['center']);A=Vector(r['shaft'])
  for side,sign in [('Left',1),('Right',-1)]:
   sample['hands'][side]={'wrist':list(pos(side+'Hand')),'elbow':list(pos(side+'ForeArm')),'grip':list(grip(side)),
    'gripError':(grip(side)-(C+A*r['spacing']*.5*sign)).length,'quaternion':list(mat(bones['mixamorig:'+side+'Hand']).to_quaternion())}
  for n in ['Hips','Spine2','Head','LeftFoot','RightFoot']:sample['landmarks'][n]=list(pos(n))
  if previous:
   sample['centerStepMetres']=(center-Vector(previous['gripCenter'])).length
   sample['weaponAngleStepDegrees']=qdistance(Quaternion(previous['weaponQuaternion']),q)
   sample['shaftAngleStepDegrees']=math.degrees(axis.angle(Vector(previous['shaftAxis'])))
  else:sample['centerStepMetres']=0;sample['weaponAngleStepDegrees']=0;sample['shaftAngleStepDegrees']=0
  samples.append(sample);previous=sample
  if f in [first,last]:
   diff={}
   for p in bones:
    now=mat(p);was=idle[p.name]
    diff[p.name]={'localRotationDegrees':qdistance(was['local'].to_quaternion(),p.matrix_basis.to_quaternion()),
     'localTranslationUnits':(was['local'].translation-p.matrix_basis.translation).length,
     'worldPositionMetres':(was['world'].translation-now.translation).length,
     'worldRotationDegrees':qdistance(was['world'].to_quaternion(),now.to_quaternion())}
   boundary['start'if f==first else'end']={'frame':f,'bones':diff,
    'largestLocalRotation':sorted(([v['localRotationDegrees'],n]for n,v in diff.items()),reverse=True)[:12],
    'largestWorldPosition':sorted(([v['worldPositionMetres'],n]for n,v in diff.items()),reverse=True)[:12]}
 summary={}
 for key in ['centerStepMetres','weaponAngleStepDegrees','shaftAngleStepDegrees']:
  values=[s[key]for s in samples[1:]];summary[key]=compact(values)
  summary[key]['worstFrame']=max(samples[1:],key=lambda s:s[key])['frame'];summary[key]['worstTime']=(summary[key]['worstFrame']-first)/FPS
  summary[key]['topFrames']=[[s['frame'],s[key]]for s in sorted(samples[1:],key=lambda s:s[key],reverse=True)[:12]]
 positions=np.asarray([s['gripCenter']for s in samples]);velocity=np.diff(positions,axis=0)*FPS;accel=np.diff(velocity,axis=0)*FPS
 accelerations=np.linalg.norm(accel,axis=1)
 summary['centerAccelerationMetresPerSecondSquared']=compact(accelerations)
 summary['centerAccelerationMetresPerSecondSquared']['topFrames']=[[int(i+2+first),float(accelerations[i])]for i in np.argsort(accelerations)[-12:][::-1]]
 # A moving-average residual isolates small fast perturbations but includes
 # intentional strike acceleration. It is evidence, not an automatic rejection.
 residual=[float(np.linalg.norm(positions[i]-np.mean(positions[i-2:i+3],axis=0)))for i in range(2,len(positions)-2)]
 summary['fiveFrameCenterResidualMetres']=compact(residual)
 summary['maximumGripError']=max(h['gripError']for s in samples for h in s['hands'].values())
 summary['shaftHoldWindows']={}
 for label,a,b in ([('windupHold',.85,1.65),('postStrikeHold',2.8,3.0)]if clip=='sweep'else[('windupHold',1.55,2.0)]):
  window=[s for s in samples if a<s['time']<=b]
  summary['shaftHoldWindows'][label]={'timeRange':[a,b],'weaponAngleStepDegrees':compact([s['weaponAngleStepDegrees']for s in window]),'centerStepMetres':compact([s['centerStepMetres']for s in window])}
 result['clips'][clip]={'summary':summary,'idleBoundary':boundary,'samples':samples}
 print('MOTION',clip,json.dumps(summary),flush=True)
 for end,d in boundary.items():
  print('BOUNDARY',clip,end,'WeaponSocket',json.dumps(d['bones']['WeaponSocket']),'worstQ',d['largestLocalRotation'][:5],flush=True)
path=os.path.join(ROOT,'docs/combat-revision/boss-motion-continuity-'+TAG+'.json');json.dump(result,open(path,'w'),indent=2)
print('MOTION_AUDIT_WRITTEN',path,flush=True)
