"""Fit weapon orientation to the approved video performance without moving elbows.

Uthana tracks the human body, not the prop. Retain captured shoulder/elbow paths;
use forearm pronation plus bounded anatomical wrist flex for the held sword.
"""
import bpy,os,json,math,numpy as np
from mathutils import Matrix,Vector,Quaternion
R=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'));OUT=R+'/assets/player-combat-revision'
bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.open_mainfile(filepath=OUT+'/player-video-carry-trial.blend');scene=bpy.context.scene;rig=next(o for o in scene.objects if o.type=='ARMATURE');bones=rig.pose.bones;inv=rig.matrix_world.inverted();source={tr.name:tr.strips[0].action for tr in rig.animation_data.nla_tracks};rig.animation_data.action=None
for tr in rig.animation_data.nla_tracks:tr.mute=True
def B(n):return bones['mixamorig:'+n]
def wm(b):return rig.matrix_world@b.matrix
def up():bpy.context.view_layer.update()
def cap():return {b.name:(b.location.copy(),b.rotation_quaternion.copy(),b.scale.copy())for b in bones}
def pose(a,f):
 rig.animation_data.action=a;rig.animation_data.action_slot=a.slots[0];scene.frame_set(int(f),subframe=f-int(f));up();p=cap();rig.animation_data.action=None
 for n,(l,q,s)in p.items():bones[n].location=l;bones[n].rotation_quaternion=q;bones[n].scale=s
 up()
def setw(b,m):b.matrix=inv@m;up()
def bend():return math.degrees((wm(B('RightHand')).translation-wm(B('RightForeArm')).translation).angle(wm(B('RightHandMiddle1')).translation-wm(B('RightHand')).translation))
def desired(name,t):
 if name=='light-v3':
  keys=[(0,(-.1,-.05,1)),(.75,(-.3,-.05,.95)),(1,(-.5,-.1,.85)),(1.25,(-.9,-.15,.4)),(1.5,(-.6,-.6,.5)),(1.65,(0,-.98,.2)),(1.75,(.65,-.65,.35)),(2,(.85,-.5,-.22)),(2.5,(.9,-.35,-.26)),(3,(.85,-.4,-.3)),(3.5,(.6,-.5,-.3)),(4,(-.3,-.8,.4)),(4.5,(-.1,-.05,1)),(5.14,(-.1,-.05,1))]
  return Vector([float(np.interp(t,[k[0]for k in keys],[k[1][i]for k in keys]))for i in range(3)]).normalized()
 if name=='guard-v2':return Vector((-.13,-.75,.65)).normalized()
 if name=='hit-v3':return Vector((-.70,-.45,.55)).normalized()
 # Blade angles read from the actual fixed-camera heavy-v2 source: lift,
 # overhead load, downward cut, low finish, recovery. Human arm motion is raw.
 times=[0,.25,.5,.75,1,1.25,1.5,1.7,1.85,2.0,2.15,2.3,2.5,2.75,3,3.75,4,4.5,5.13]
 angles=[.5,.10,-.30,-.55,-.6,-.35,0,2.05,1.70,1.10,.45,-.30,-.70,-.70,-.70,-.70,-.65,.05,.35]
 angle=float(np.interp(t,times,angles));return Vector((-.08,-math.cos(angle),math.sin(angle))).normalized()
report={}
for name in ['heavy-v2']:
 a=source[name];end=round(a.frame_range[1]);samples=[];rows=[]
 # Full-turn scalar angle is continuous before temporal regularization. This
 # resolves the underdetermined pronation when shaft and forearm are parallel.
 thetas=[]
 for f in range(end+1):
  pose(a,f);hm=wm(B('RightHand'));fm=wm(B('RightForeArm'));axis=(hm.translation-fm.translation).normalized();shaft=wm(bones['WeaponSocket']).to_quaternion()@Vector((0,0,1));target=desired(name,f/30)
  if target.z<0:
   minz=-max(.02,hm.translation.z-.12)/1.13
   if target.z<minz:target=Vector((target.x,target.y,0)).normalized()*math.sqrt(max(.01,1-minz*minz))+Vector((0,0,minz))
  sp=shaft-axis*shaft.dot(axis);tp=target-axis*target.dot(axis)
  thetas.append(math.atan2(axis.dot(sp.cross(tp)),sp.dot(tp)) if min(sp.length,tp.length)>.02 else (thetas[-1] if thetas else 0))
 thetas=np.unwrap(thetas);kernel=np.array([1,3,6,8,6,3,1],dtype=float);kernel/=kernel.sum();thetas=np.convolve(np.pad(thetas,(3,3),mode='edge'),kernel,mode='valid')
 for f in range(end+1):
  pose(a,f);hand=B('RightHand');fore=B('RightForeArm');socket=bones['WeaponSocket'];hm=wm(hand);fm=wm(fore);socketlocal=hm.inverted()@wm(socket);axis=(hm.translation-fm.translation).normalized();shaft=wm(socket).to_quaternion()@Vector((0,0,1));target=desired(name,f/30)
  if name=='heavy-v2'and target.z<0:
   # The approved1.28m blade is longer than the training prop. Its tip must
   # stop above floor, retaining a downward chop instead of burying the sword.
   minz=-max(.02,hm.translation.z-.12)/1.13
   if target.z<minz:
    xy=Vector((target.x,target.y,0)).normalized();target=xy*math.sqrt(max(.01,1-minz*minz))+Vector((0,0,minz))
  sp=shaft-axis*shaft.dot(axis);tp=target-axis*target.dot(axis)
  theta=float(thetas[f])
  # Forearm axial rotation keeps elbow and wrist positions exactly captured.
  twist=Quaternion(axis,theta);setw(fore,Matrix.LocRotScale(fm.translation,twist@fm.to_quaternion(),fm.to_scale()))
  hm=wm(hand);setw(hand,Matrix.LocRotScale(hm.translation,Quaternion(axis,0)@hm.to_quaternion(),hm.to_scale()))
  hm=wm(hand);shaft=(hm@socketlocal).to_quaternion()@Vector((0,0,1));swing=shaft.rotation_difference(target);palm=wm(B('RightHandMiddle1')).translation-hm.translation;fraction=0
  for v in np.linspace(1,0,41):
   q=Quaternion().slerp(swing,float(v))
   if math.degrees(axis.angle(q@palm))<=48:fraction=float(v);break
  q=Quaternion().slerp(swing,fraction);setw(hand,Matrix.LocRotScale(hm.translation,q@hm.to_quaternion(),hm.to_scale()));setw(socket,wm(hand)@socketlocal)
  actual=wm(socket).to_quaternion()@Vector((0,0,1));rows.append({'frame':f,'forearmPronationDegrees':math.degrees(theta),'wristFlexDegrees':bend(),'bladeDirectionErrorDegrees':math.degrees(actual.angle(target)),'sourceElbowPosition':list(fm.translation),'correctedWristPosition':list(wm(hand).translation)});samples.append(cap())
 out=bpy.data.actions.new('weapon-refined-'+name);rig.animation_data.action=out;previous={}
 for f,s in enumerate(samples):
  for n,(l,q,sc)in s.items():
   q=q.copy()
   if n in previous and q.dot(previous[n])<0:q.negate()
   previous[n]=q.copy();b=bones[n];b.location=l;b.rotation_quaternion=q;b.scale=sc;b.keyframe_insert('location',frame=f);b.keyframe_insert('rotation_quaternion',frame=f);b.keyframe_insert('scale',frame=f)
 for layer in out.layers:
  for strip in layer.strips:
   for bag in strip.channelbags:
    for fc in bag.fcurves:
     for k in fc.keyframe_points:k.interpolation='LINEAR'
 out.use_fake_user=True;rig.animation_data.action=None;tr=next(t for t in rig.animation_data.nla_tracks if t.name==name);st=tr.strips[0];st.action=out;st.action_slot=out.slots[0];st.action_frame_start=0;st.action_frame_end=end;report[name]={'rows':rows};print('WEAPON',name,max(r['wristFlexDegrees']for r in rows),max(r['bladeDirectionErrorDegrees']for r in rows),flush=True)
for b in bones:b.matrix_basis.identity()
bpy.ops.wm.save_as_mainfile(filepath=OUT+'/player-video-weapon-v3-trial.blend');json.dump(report,open(R+'/docs/player-combat-revision/weapon-orientation-v3-trial-report.json','w'),indent=2)
