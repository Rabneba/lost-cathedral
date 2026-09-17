"""Preserve the approved idle, retarget three captured whole-body performances.
Contact repairs are baked; the game owns forward travel and action timing.
The approved mesh, bind and two-handed grip calibration are retained.
"""
import bpy,os,json,math,statistics
import numpy as np
from mathutils import Vector,Matrix,Quaternion
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'))
OUT=os.path.join(ROOT,'assets/boss-essential-motion');os.makedirs(OUT,exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=os.path.join(OUT,'boss-sources.blend'))
scene=bpy.context.scene;scene.render.fps=30;FPS=30
rig=next(o for o in scene.objects if o.type=='ARMATURE')
body=next(o for o in scene.objects if o.type=='MESH' and any(m.type=='ARMATURE'for m in o.modifiers))
bones=rig.pose.bones;inv=rig.matrix_world.inverted()
def B(n):return bones['mixamorig:'+n]
def update():bpy.context.view_layer.update()
def world(p):return rig.matrix_world@p.matrix
def pos(p):return world(p).translation.copy()
def setworld(p,m):p.matrix=inv@m;update()
def rotate(p,q):
 m=world(p);v=m.translation.copy();setworld(p,Matrix.Translation(v)@q.to_matrix().to_4x4()@Matrix.Translation(-v)@m)
def aim(p,child,target):
 a=pos(child)-pos(p);b=target-pos(p)
 if min(a.length,b.length)>.00001:rotate(p,a.normalized().rotation_difference(b.normalized()))
def chain(side,target,pole,leg=False):
 a,b,c=[B(side+n)for n in (['UpLeg','Leg','Foot']if leg else ['Arm','ForeArm','Hand'])]
 s,e,w=pos(a),pos(b),pos(c);l1,l2=(e-s).length,(w-e).length;axis=(target-s).normalized()
 d=max(abs(l1-l2)+.001,min((target-s).length,l1+l2-.001));along=(l1*l1-l2*l2+d*d)/(2*d)
 h=math.sqrt(max(0,l1*l1-along*along));bend=pole-s;bend-=axis*bend.dot(axis)
 if bend.length<.0001:bend=Vector((0,-1,.2))
 bend.normalize();aim(a,b,s+axis*along+bend*h);aim(b,c,target)
 return(pos(c)-target).length
def smooth(t):t=max(0,min(1,t));return t*t*(3-2*t)
def grip_anchors(name,t):
 # Slide into a shorter two-hand lever before the overhead blow; the broad
 # idle grip otherwise forces the rear hand behind the neck on a steep cut.
 slide=smooth(t/1.8)*(1-smooth((t-3.6)/2.1))if name=='slam'else 0.
 return {'Right':.6+.20*slide,'Left':1.55-.25*slide}
def grab():return{p.name:p.matrix_basis.copy()for p in bones}
def apply(frame):
 for p in bones:p.matrix_basis=frame[p.name].copy()
 update()
def blend(a,b,t):return{n:a[n].lerp(b[n],t)for n in a}
def grip(side):
 ps=[pos(B(side+'Hand'+d+str(j)))for d in ['Index','Middle','Ring','Pinky']for j in [1,3]]
 return sum(ps,Vector())*(.8/len(ps))+pos(B(side+'HandThumb3'))*.2

rig.animation_data.action=None
tracks=list(rig.animation_data.nla_tracks);raw={};source_actions={}
for track in tracks:
 for t in tracks:t.mute=t!=track
 strip=track.strips[0];frames=[]
 for i in range(round(strip.frame_end-strip.frame_start)+1):
  scene.frame_set(round(strip.frame_start)+i);update();frames.append(grab())
 raw[track.name]=frames;source_actions[track.name]=strip.action
for t in list(rig.animation_data.nla_tracks):rig.animation_data.nla_tracks.remove(t)
rig.animation_data.action=None
for p in bones:p.rotation_mode='QUATERNION'
idle=raw['idle'];apply(idle[0]);ref={p.name:world(p).copy()for p in bones}
ref_weapon=world(bones['WeaponSocket']).copy();ref_chest=world(B('Spine2')).copy()
ref_grip={s:grip(s)for s in ['Left','Right']}
hand_relative={s:ref_weapon.to_quaternion().inverted()@world(B(s+'Hand')).to_quaternion()for s in ref_grip}
grip_local={s:world(B(s+'Hand')).to_quaternion().inverted()@(ref_grip[s]-pos(B(s+'Hand')))for s in ref_grip}
finger_names=[p.name for p in bones if any(d in p.name for d in ['Thumb','Index','Middle','Ring','Pinky'])]
footq={s:world(B(s+'Foot')).to_quaternion()for s in ref_grip}
footz={s:pos(B(s+'Foot')).z for s in ref_grip}
foot_indices={}
for side in ref_grip:
 ids={g.index for g in body.vertex_groups if side+'Foot'in g.name or side+'ToeBase'in g.name}
 foot_indices[side]=[v.index for v in body.data.vertices if sum(g.weight for g in v.groups if g.group in ids)>.6]
def soles():
 ev=body.evaluated_get(bpy.context.evaluated_depsgraph_get())
 return{s:min((body.matrix_world@ev.data.vertices[i].co).z for i in ids)for s,ids in foot_indices.items()}
def floor_correct():
 values=soles();hip=world(B('Hips'));hip.translation.z-=min(values.values());setworld(B('Hips'),hip)

metrics={};baked={'idle':idle}
for name in ['walk-forward','sweep','slam']:
 frames=raw['source-'+name];samples=[]
 for i,frame in enumerate(frames):
  # Three-frame filtering damps extraction chatter without slowing the action.
  filtered=blend(blend(frames[max(0,i-1)],frames[min(len(frames)-1,i+1)],.5),frame,.5)
  apply(filtered);ss=soles();floor=min(ss.values())
  samples.append({'pose':grab(),'soles':ss,'floor':floor,'hips':pos(B('Hips')),
   'feet':{s:world(B(s+'Foot')).copy()for s in ref_grip},
   'knees':{s:pos(B(s+'Leg'))for s in ref_grip},
   'hands':{s:pos(B(s+'Hand'))for s in ref_grip}})
 # Local root translation from Uthana includes the source armature origin.
 # Subtract actual sole support height, not a guessed constant ankle height.
 floors=[s['floor']for s in samples]
 filtered_floors=[sum(floors[max(0,min(len(floors)-1,i+k))]*w for k,w in [(-2,1),(-1,2),(0,3),(1,2),(2,1)])/9 for i in range(len(samples))]
 selection=[0,len(samples)-1];source_speed=None
 if name=='walk-forward':
  # Video-side reconstruction produced a lateral stride. Rotate its principal
  # trajectory into the character's forward axis, retaining cadence/foot lift.
  xy={side:np.array([[s['feet'][side].translation.x,s['feet'][side].translation.y]for s in samples])for side in ref_grip}
  means={side:xy[side].mean(axis=0)for side in ref_grip}
  centered=np.concatenate([xy[s]-means[s]for s in ref_grip]);values,vectors=np.linalg.eigh(np.cov(centered.T));axis=vectors[:,-1]
  if axis[0]<0:axis=-axis
  across=np.array([-axis[1],axis[0]])
  for i,s in enumerate(samples):
   s['gaitFeet']={};s['clearance']={}
   for side,sign in [('Left',1),('Right',-1)]:
    v=xy[side][i]-means[side];clearance=max(0,s['soles'][side]-s['floor'])
    s['clearance'][side]=clearance
    s['gaitFeet'][side]=Vector((sign*.29+float(v@across)*.12,-float(v@axis)*.86,footz[side]+clearance*.85))
  # Pick a complete stride with matching endpoint pose and velocity.
  best=None
  for start in range(3,min(38,len(samples)-80)):
   for end in range(start+78,min(start+136,len(samples)-3)):
    cost=0
    for side in ref_grip:
     a=samples[start]['gaitFeet'][side];b=samples[end]['gaitFeet'][side]
     va=samples[start+2]['gaitFeet'][side]-samples[start-2]['gaitFeet'][side]
     vb=samples[end+2]['gaitFeet'][side]-samples[end-2]['gaitFeet'][side]
     cost+=(a-b).length_squared+3*(va-vb).length_squared
    if best is None or cost<best[0]:best=(cost,start,end)
  selection=[best[1],best[2]]
  speed_samples=[]
  for i in range(selection[0]+1,selection[1]):
   for side in ref_grip:
    speed=(samples[i+1]['gaitFeet'][side].y-samples[i-1]['gaitFeet'][side].y)*FPS/2
    if samples[i]['clearance'][side]<.04 and .08<speed<1.5:speed_samples.append(speed)
  source_speed=max(.25,min(.9,statistics.median(speed_samples)if speed_samples else .5))
  # The extraction lifts each boot after its forward slide has already begun.
  # Reconstruct support/swing from the captured stride cadence. During support
  # the sole moves back exactly at runtime travel speed; swing clears the floor.
  # Hips, torso, head and their weight transfer remain the captured performance.
  period=(selection[1]-selection[0])/FPS;stance=.62
  length=source_speed*period*stance
  for i,s in enumerate(samples):
   for side,sign,offset in [('Left',1,.115),('Right',-1,.615)]:
    phase=((i-selection[0])/FPS/period+offset)%1
    if phase<stance:
     forward=length*.5-source_speed*phase*period;lift=0.;sideways=0.
    else:
     u=(phase-stance)/(1-stance);duration=period*(1-stance)
     # Hermite trajectory leaves and arrives at the same support velocity.
     h00=2*u**3-3*u*u+1;h10=u**3-2*u*u+u
     h01=-2*u**3+3*u*u;h11=u**3-u*u
     forward=h00*(-length*.5)+h10*(-source_speed*duration)+h01*(length*.5)+h11*(-source_speed*duration)
     lift=.14*math.sin(math.pi*u)**1.2;sideways=.025*math.sin(math.pi*u)
    s['gaitFeet'][side]=Vector((sign*(.29+sideways),-forward,footz[side]+lift));s['clearance'][side]=lift
  metrics[name]={'sourceAxis':axis.tolist(),'sourceFrames':selection,'loopMatchCost':best[0],'sourceSpeed':source_speed,'contactRepair':'captured cadence with constant-speed support and lifted swing','stanceFraction':stance,'footPhaseOffsets':{'Left':.115,'Right':.615}}
 else:metrics[name]={'sourceFrames':selection}
 output=[];checks=[];last_wq=None
 for fi in range(selection[0],selection[1]+1):
  anchors=grip_anchors(name,fi/FPS)
  s=samples[fi];apply(s['pose']);hip=world(B('Hips'));hip.translation.x-=samples[0]['hips'].x;hip.translation.y-=samples[0]['hips'].y
  hip.translation.z-=filtered_floors[fi];setworld(B('Hips'),hip)
  # All three three-quarter video extractions carry an approximately 50-degree
  # facing offset relative to the approved guard. Calibrate the whole skeleton
  # before contacts, so a forward gait does not twist under a sideways torso.
  rotate(B('Hips'),Quaternion((0,0,1),math.radians(-50)))
  # The same provider-to-mesh posture calibration that the user approved for
  # idle: remove the retargeted spine/neck over-fold, in the body's own plane.
  pitch_axis=(pos(B('LeftUpLeg'))-pos(B('RightUpLeg'))).normalized()
  for joint,degrees in [('Spine',-18),('Spine1',-6),('Neck',-12)]:
   rotate(B(joint),Quaternion(pitch_axis,math.radians(degrees)))
  if name=='walk-forward':
   for side,sign in [('Left',1),('Right',-1)]:
    target=s['gaitFeet'][side];chain(side,target,Vector((sign*.42,-1.3,.65)),True)
    # Mostly flat armored soles. A small toe lift on swing avoids a rigid march.
    q=footq[side].copy();lift=min(1,s['clearance'][side]/.12)
    q=Quaternion((1,0,0),-.12*lift)@q
    setworld(B(side+'Foot'),Matrix.LocRotScale(pos(B(side+'Foot')),q,ref[B(side+'Foot').name].to_scale()))
    B(side+'ToeBase').matrix_basis=idle[0][B(side+'ToeBase').name].copy()
   update();floor_correct()
  else:
   # Keep the source pivots/steps, flatten the supporting boot gradually.
   for side in ref_grip:
    fm=world(B(side+'Foot'));clear=max(0,s['soles'][side]-s['floor']);weight=(1-smooth(clear/.10))*.8
    refdir=(ref[B(side+'ToeBase').name].translation-ref[B(side+'Foot').name].translation)
    direction=pos(B(side+'ToeBase'))-pos(B(side+'Foot'))
    yaw=math.atan2(direction.y,direction.x)-math.atan2(refdir.y,refdir.x)
    flat=Quaternion((0,0,1),yaw)@footq[side]
    setworld(B(side+'Foot'),Matrix.LocRotScale(fm.translation,fm.to_quaternion().slerp(flat,weight),fm.to_scale()))
   floor_correct()
  for n in finger_names:bones[n].matrix_basis=idle[0][n].copy()
  update()
  if name=='walk-forward':
   # A guarded walk carries the same scythe hold with the animated torso.
   wm=world(B('Spine2'))@ref_chest.inverted()@ref_weapon
  else:
   right,left=pos(B('RightHand')),pos(B('LeftHand'));center=(right+left)*.5;t=fi/FPS
   # Video-to-motion tracks the body, not the separate weapon. Occluded wrists
   # reverse the reconstructed shaft direction at impact. Reconstruct the
   # approved attack arc explicitly, driven by the captured body/hand center.
   if name=='sweep':
    wind=smooth(t/1.65);strike=smooth((t-1.65)/1.25);recover=smooth((t-2.9)/2.8)
    # The extracted wrists sit against the breastplate. Carry the shaft in
    # front of the ribs and below shoulder level through the lateral cut.
    center.y-=.34*(1-recover);center.z-=.22*(1-recover)
    az=-3.4+3.6*strike;axis=Vector((math.cos(az),math.sin(az),.10)).normalized()
    blade=Vector((0,0,-1));blade-=axis*blade.dot(axis);blade.normalize()
    depth=axis.cross(blade).normalized();attackq=Matrix((blade,depth,axis)).transposed().to_quaternion()
    wq=ref_weapon.to_quaternion().slerp(attackq,wind).slerp(ref_weapon.to_quaternion(),recover)
   else:
    wind=smooth(t/2.0);strike=smooth((t-2.0)/.8);recover=smooth((t-3.6)/2.1)
    center.y-=.32*(1-recover);center.z-=.40*strike*(1-recover)
    # The fitted blade curves .30m sideways from its handle. Aim the blade's
    # cutting plane down the target line, rather than aiming only the shaft.
    center.x=center.x*recover+(.42+pos(B('Spine2')).x*.10)*(1-recover)
    center=center.lerp(Vector((.42,-.52,pos(B('Spine2')).z-.14)),strike*(1-recover))
    angle=.28+(2.30-.28)*strike
    axis=Vector((0,-math.sin(angle),math.cos(angle)))
    blade=Vector((0,-axis.z,axis.y));depth=Vector((1,0,0))
    # Carry the butt beside the hood and aim the descending blade inward.
    # A centerline shaft would drive its long rear end through the hood.
    attackq=Quaternion((0,0,1),-.30)@Matrix((blade,depth,axis)).transposed().to_quaternion()
    wq=ref_weapon.to_quaternion().slerp(attackq,wind).slerp(ref_weapon.to_quaternion(),recover)
   axis=wq@Vector((0,0,1))
   if last_wq and wq.dot(last_wq)<0:wq.negate()
   last_wq=wq.copy();wm=Matrix.LocRotScale(center-axis*((anchors['Left']+anchors['Right'])*.5),wq,Vector((1,1,1)))
  # Project the rigid grip pair into both arms' reach; never stretch bones.
  for iteration in range(10):
   for side,z in anchors.items():
    q=wm.to_quaternion()@hand_relative[side]
    target=wm@Vector((0,0,z))-q@grip_local[side]
    shoulder=pos(B(side+'Arm'));reach=(pos(B(side+'ForeArm'))-shoulder).length+(pos(B(side+'Hand'))-pos(B(side+'ForeArm'))).length-.006
    delta=target-shoulder
    if delta.length>reach:wm.translation-=delta.normalized()*(delta.length-reach)
  errors=[]
  for side,sign in [('Right',-1),('Left',1)]:
   z=anchors[side]
   q=wm.to_quaternion()@hand_relative[side];g=wm@Vector((0,0,z));target=g-q@grip_local[side]
   pole=pos(B(side+'ForeArm'))+Vector((sign*.12,.10,0))
   errors.append(chain(side,target,pole))
   hm=world(B(side+'Hand'));setworld(B(side+'Hand'),Matrix.LocRotScale(hm.translation,q,hm.to_scale()))
  setworld(bones['WeaponSocket'],wm);update()
  checks.append({'time':len(output)/FPS,'gripError':max((grip(side)-(wm@Vector((0,0,z)))).length for side,z in anchors.items()),'floor':min(soles().values())})
  output.append(grab())
 if name=='walk-forward':
  # Symmetric periodic seam: distribute the small endpoint mismatch over the
  # last ten frames, rather than resetting at a visibly different pose.
  for i in range(max(0,len(output)-11),len(output)):
   output[i]=blend(output[i],output[0],smooth((i-(len(output)-11))/10))
 else:
  # Start/end on the approved guard. These are movement transitions, not hard
  # rest-pose resets; the captured windup/impact/follow-through remain intact.
  count=min(12,len(output)//8)
  for i in range(count):output[i]=blend(idle[0],output[i],smooth(i/count))
  return_frames=18
  last=output[-1]
  for i in range(1,return_frames+1):output.append(blend(last,idle[0],smooth(i/return_frames)))
 baked[name]=output
 metrics[name].update({'duration':(len(output)-1)/FPS,'frames':len(output),'maxGripError':max(s['gripError']for s in checks),'floorRange':[min(s['floor']for s in checks),max(s['floor']for s in checks)]})
 print('CORRECTED',name,metrics[name],flush=True)

# Compact authored support actions reuse the approved pose and actual skeleton.
# No prop-only motion and no rigid whole-character rotation.
for name,duration in [('hit',.6),('awaken',2.6),('death',3.6)]:
 poses=[]
 for f in range(round(duration*FPS)+1):
  t=f/FPS;apply(idle[min(len(idle)-1,round(t*FPS))]);weapon=world(bones['WeaponSocket']).copy();chest=world(B('Spine2')).copy()
  if name=='hit':
   pulse=math.sin(min(1,t/duration)*math.pi);rotate(B('Spine'),Quaternion((1,0,0),-.12*pulse));rotate(B('Spine1'),Quaternion((0,0,1),.10*pulse))
   wm=world(B('Spine2'))@chest.inverted()@weapon;setworld(bones['WeaponSocket'],wm)
  elif name=='awaken':
   pulse=math.sin(t/duration*math.pi);rotate(B('Spine1'),Quaternion((1,0,0),-.06*pulse));rotate(B('Head'),Quaternion((1,0,0),-.12*pulse))
   wm=world(B('Spine2'))@chest.inverted()@weapon;setworld(bones['WeaponSocket'],wm)
  else:
   collapse=smooth(t/2.4);hip=world(B('Hips'));hip.translation.z-=.76*collapse;hip.translation.y-=.20*collapse;setworld(B('Hips'),hip)
   rotate(B('Spine'),Quaternion((1,0,0),.56*collapse));rotate(B('Neck'),Quaternion((1,0,0),.25*collapse))
   for side,sign in [('Left',1),('Right',-1)]:
    target=ref[B(side+'Foot').name].translation.copy();target.y+=.15*collapse;chain(side,target,Vector((sign*.32,-1.5,.25)),True)
    fm=world(B(side+'Foot'));setworld(B(side+'Foot'),Matrix.LocRotScale(fm.translation,footq[side],fm.to_scale()))
   wm=world(B('Spine2'))@chest.inverted()@weapon;setworld(bones['WeaponSocket'],wm)
  poses.append(grab())
 baked[name]=poses;metrics[name]={'duration':duration,'source':'authored support pose on approved rig'}

# The generated reference deliberately exposes the anticipation and recovery.
# Bake practical game cadence into the two attacks, so review and runtime agree.
for name,target_duration in [('sweep',3.7),('slam',4.2)]:
 original=baked[name];count=round(target_duration*FPS)
 resampled=[]
 for i in range(count+1):
  at=i/count*(len(original)-1);a=min(len(original)-1,int(at));b=min(len(original)-1,a+1)
  resampled.append(blend(original[a],original[b],at-a))
 baked[name]=resampled;metrics[name]['duration']=count/FPS;metrics[name]['frames']=len(resampled)

# A quaternion crossfade does not by itself maintain rigid prop contact or
# plant soles. Re-solve those constraints after seam/recovery interpolation.
for name,frames in baked.items():
 if name=='idle':continue
 for i,frame in enumerate(frames):
  apply(frame);wm=world(bones['WeaponSocket']).copy()
  if name=='walk-forward':
   # Restore analytical contact after the whole-body loop seam crossfade.
   period=metrics[name]['duration'];stance=metrics[name]['stanceFraction'];speed=metrics[name]['sourceSpeed'];stride=speed*period*stance
   for side,sign in [('Left',1),('Right',-1)]:
    phase=(i/FPS/period+metrics[name]['footPhaseOffsets'][side])%1
    if phase<stance:forward=stride*.5-speed*phase*period;lift=0.;sideways=0.
    else:
     u=(phase-stance)/(1-stance);d=period*(1-stance)
     forward=(2*u**3-3*u*u+1)*(-stride*.5)+(u**3-2*u*u+u)*(-speed*d)+(-2*u**3+3*u*u)*(stride*.5)+(u**3-u*u)*(-speed*d)
     lift=.14*math.sin(math.pi*u)**1.2;sideways=.025*math.sin(math.pi*u)
    chain(side,Vector((sign*(.29+sideways),-forward,footz[side]+lift)),Vector((sign*.42,-1.3,.65)),True)
    q=Quaternion((1,0,0),-.12*min(1,lift/.12))@footq[side]
    setworld(B(side+'Foot'),Matrix.LocRotScale(pos(B(side+'Foot')),q,ref[B(side+'Foot').name].to_scale()))
    B(side+'ToeBase').matrix_basis=idle[0][B(side+'ToeBase').name].copy()
   update()
  floor=min(soles().values())
  hip=world(B('Hips'));hip.translation.z-=floor;setworld(B('Hips'),hip);wm.translation.z-=floor
  anchors=grip_anchors(name,(i/FPS)/4.2*(215/30))if name=='slam'else grip_anchors(name,0)
  for side,z in anchors.items():
   q=wm.to_quaternion()@hand_relative[side];target=wm@Vector((0,0,z))-q@grip_local[side]
   chain(side,target,pos(B(side+'ForeArm')))
   hm=world(B(side+'Hand'));setworld(B(side+'Hand'),Matrix.LocRotScale(hm.translation,q,hm.to_scale()))
  setworld(bones['WeaponSocket'],wm);frames[i]=grab()

for t in list(rig.animation_data.nla_tracks):rig.animation_data.nla_tracks.remove(t)
rig.animation_data.action=None
for name,frames in baked.items():
 action=bpy.data.actions.new('essential-'+name);rig.animation_data.action=action
 previous={}
 for f,frame in enumerate(frames):
  for n,m in frame.items():
   p=bones[n];loc,q,scale=m.decompose()
   if n in previous and q.dot(previous[n])<0:q.negate()
   previous[n]=q.copy();p.location=loc;p.rotation_quaternion=q;p.scale=scale
   for channel in ['location','rotation_quaternion','scale']:p.keyframe_insert(channel,frame=f)
 rig.animation_data.action=None;t=rig.animation_data.nla_tracks.new();t.name=name;t.strips.new(name,0,action);t.mute=True
 print('BAKED',name,len(frames),flush=True)
apply(idle[0]);scene.frame_start=0;scene.frame_end=round(26.2666667*FPS);scene.frame_set(0);update()
bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);body.select_set(True);bpy.context.view_layer.objects.active=rig
for o in scene.objects:
 if o not in [rig,body]:o.hide_render=True
for t in rig.animation_data.nla_tracks:t.mute=False
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT,'assets/production/boss-essential.blend'))
bpy.ops.export_scene.gltf(filepath=os.path.join(ROOT,'assets/production/boss-essential.glb'),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='NLA_TRACKS',export_nla_strips=True,export_frame_range=False,export_force_sampling=True,export_def_bones=False)
json.dump(metrics,open(os.path.join(ROOT,'docs/boss-essential-bake.json'),'w'),indent=2)
print('BOSS_ESSENTIAL_COMPLETE',flush=True)
