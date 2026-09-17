"""Read-only audit of source vs rejected production wrist/prop anatomy.
Writes only docs diagnostics; does not save a Blender file or change a bake.
Run: Blender -b -t 2 --python scripts/blender/audit_boss_grip_anatomy.py
"""
import bpy, json, os, math, hashlib
from mathutils import Vector
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'))
TAG=os.environ.get('VESPER_GRIP_AUDIT_TAG','')
OUT=os.path.join(ROOT,'docs/combat-revision/boss-grip-anatomy-'+TAG+'.json')if TAG else os.path.join(ROOT,'docs/boss-grip-anatomy-audit.json')
FILES={'source':os.path.join(ROOT,'assets/boss-essential-motion/boss-sources.blend'),
       'rejected': '/tmp/vesper-rejected-boss-essential.blend'}
candidate=os.environ.get('VESPER_GRIP_CANDIDATE',os.path.join(ROOT,'assets/combat-revision/boss/boss-combat-candidate.blend'))
if os.path.exists(candidate):FILES['candidate']=candidate
def vec(v):return [round(x,7)for x in v]
def angle(a,b):return math.degrees(a.angle(b)) if a.length*b.length>1e-9 else None
result={'files':{},'anatomy':{},'clips':{}}
for source,path in FILES.items():
 result['files'][source]={'path':path,'sha256':hashlib.sha256(open(path,'rb').read()).hexdigest()}
 bpy.ops.wm.open_mainfile(filepath=path)
 scene=bpy.context.scene;rig=next(o for o in scene.objects if o.type=='ARMATURE');bones=rig.pose.bones
 def B(side,suffix):return bones['mixamorig:'+side+suffix]
 def mat(p):return rig.matrix_world@p.matrix
 def pos(p):return mat(p).translation.copy()
 def frame(side):
  hand=pos(B(side,'Hand'))
  long=(pos(B(side,'HandMiddle1'))-hand).normalized()
  across=(pos(B(side,'HandIndex1'))-pos(B(side,'HandPinky1'))).normalized()
  normal=long.cross(across).normalized()
  return long,across,normal
 rig.animation_data.action=None
 for t in rig.animation_data.nla_tracks:t.mute=True
 for p in bones:p.matrix_basis.identity()
 bpy.context.view_layer.update()
 rest={};anatomy={}
 for side in ['Left','Right']:
  long,across,normal=frame(side);qh=mat(B(side,'Hand')).to_quaternion();qf=mat(B(side,'ForeArm')).to_quaternion()
  rest[side]={'normalInForearm':qf.inverted()@normal,'longInHand':qh.inverted()@long,'acrossInHand':qh.inverted()@across}
  anatomy[side]={'longInHand':vec(qh.inverted()@long),'acrossInHand':vec(qh.inverted()@across),'normalInHand':vec(qh.inverted()@normal),
   'normalInForearm':vec(rest[side]['normalInForearm']),'restWristBendDegrees':angle(long,pos(B(side,'Hand'))-pos(B(side,'ForeArm'))),
   'upperArmLength':(pos(B(side,'ForeArm'))-pos(B(side,'Arm'))).length,'forearmLength':(pos(B(side,'Hand'))-pos(B(side,'ForeArm'))).length}
 result['anatomy'][source]=anatomy
 tracks=[t for t in rig.animation_data.nla_tracks if t.name in ['idle','source-sweep','source-slam','sweep','slam']]
 for track in tracks:
  for t in rig.animation_data.nla_tracks:t.mute=True
  strip=track.strips[0];data=[];last={}
  rig.animation_data.action=strip.action
  rig.animation_data.action_slot=strip.action_slot
  for f in range(round(strip.action_frame_start),round(strip.action_frame_end)+1):
   scene.frame_set(f);bpy.context.view_layer.update()
   wm=mat(bones['WeaponSocket']);axis=wm.to_quaternion()@Vector((0,0,1))
   datum={'frame':f,'time':(f-strip.action_frame_start)/scene.render.fps,'weaponOrigin':vec(wm.translation),'shaftAxis':vec(axis),'hands':{}}
   head=pos(B('','Head'));chest=pos(B('','Spine2'))
   for landmark,p in [('head',head),('chest',chest)]:
    d=p-wm.translation;along=max(0,min(2.7,d.dot(axis)))
    datum[landmark+'ToShaftMetres']=(p-wm.translation-axis*along).length
   for side in ['Left','Right']:
    long,across,normal=frame(side);h=pos(B(side,'Hand'));e=pos(B(side,'ForeArm'));s=pos(B(side,'Arm'))
    forearm=(h-e).normalized();expected=mat(B(side,'ForeArm')).to_quaternion()@rest[side]['normalInForearm']
    a=expected-forearm*expected.dot(forearm);b=normal-forearm*normal.dot(forearm)
    twist=math.degrees(math.atan2(forearm.dot(a.cross(b)),a.dot(b)))
    armAxis=(h-s).normalized();pole=e-s;pole-=armAxis*pole.dot(armAxis)
    qlocal=mat(B(side,'ForeArm')).to_quaternion().inverted()@mat(B(side,'Hand')).to_quaternion()
    delta=math.degrees(last[side].rotation_difference(qlocal).angle)if side in last else 0
    if delta>180:delta=360-delta
    last[side]=qlocal.copy()
    datum['hands'][side]={'wristBendDegrees':angle(long,forearm),'wristTwistFromRestDegrees':twist,'wristLocalDeltaDegrees':delta,
     'shaftAcrossPalmAngleDegrees':min(angle(axis,across),180-angle(axis,across)),
     'palmLong':vec(long),'palmAcross':vec(across),'palmNormal':vec(normal),'handWorld':vec(h),'elbowWorld':vec(e),'shoulderWorld':vec(s),
     'poleDistance':pole.length,'elbowBendDegrees':angle(e-s,h-e),'handQuaternion':vec(mat(B(side,'Hand')).to_quaternion()),'forearmQuaternion':vec(mat(B(side,'ForeArm')).to_quaternion())}
   data.append(datum)
  summary={}
  for side in ['Left','Right']:
   summary[side]={}
   for key in ['wristBendDegrees','wristTwistFromRestDegrees','wristLocalDeltaDegrees','shaftAcrossPalmAngleDegrees','poleDistance','elbowBendDegrees']:
    values=[d['hands'][side][key]for d in data]
    summary[side][key]={'min':min(values),'max':max(values),'mean':sum(values)/len(values)}
  summary['headToShaftMinimum']=min(d['headToShaftMetres']for d in data)
  summary['chestToShaftMinimum']=min(d['chestToShaftMetres']for d in data)
  summary['frames']=len(data);summary['duration']=data[-1]['time']
  for side in ['Left','Right']:
   summary[side]['worstTimes']={key:max(data,key=lambda d:abs(d['hands'][side][key]))['time']for key in ['wristBendDegrees','wristTwistFromRestDegrees','wristLocalDeltaDegrees']}
   elbow_steps=[(Vector(data[i]['hands'][side]['elbowWorld'])-Vector(data[i-1]['hands'][side]['elbowWorld'])).length for i in range(1,len(data))]
   summary[side]['maximumElbowStepMetres']=max(elbow_steps)
   summary[side]['maximumElbowStepTime']=data[1+elbow_steps.index(max(elbow_steps))]['time']
  result['clips'][source+'/'+track.name]={'summary':summary,'samples':data}
if os.environ.get('VESPER_GRIP_SUMMARY_ONLY')=='1':
 for clip in result['clips'].values():clip.pop('samples',None)
json.dump(result,open(OUT,'w'),indent=2)
print('ANATOMY',json.dumps(result['anatomy']))
for name,clip in result['clips'].items():print('CLIP',name,json.dumps(clip['summary']))
print('AUDIT_WRITTEN',OUT)
