"""Video-derived idle. Preserve captured upper-body/hand motion; calibrate
posture to the approved reference, stabilize feet, and fit a rigid scythe to
captured grip centers. Original production and provider assets stay untouched.
"""
import bpy,os,json,math,statistics
from mathutils import Vector,Matrix,Quaternion
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'));OUT=os.path.join(ROOT,'assets/idle-video-motion')
bpy.ops.wm.open_mainfile(filepath=os.path.join(ROOT,'assets/production/boss-combat.blend'))
scene=bpy.context.scene;scene.render.fps=30
rig=next(o for o in scene.objects if o.type=='ARMATURE');body=next(o for o in scene.objects if o.type=='MESH' and not o.hide_render)
for t in rig.animation_data.nla_tracks:t.mute=True
rig.animation_data.action=None
for p in rig.pose.bones:p.matrix_basis.identity();p.rotation_mode='QUATERNION'
bpy.context.view_layer.update();bones=rig.pose.bones;inv=rig.matrix_world.inverted()
def B(n):return bones['mixamorig:'+n]
def update():bpy.context.view_layer.update()
def world(p):return rig.matrix_world@p.matrix
def pos(p):return world(p).translation.copy()
def setworld(p,m):p.matrix=inv@m;update()
def rotate(p,q):
 m=world(p);v=m.translation.copy();setworld(p,Matrix.Translation(v)@q.to_matrix().to_4x4()@Matrix.Translation(-v)@m)
def aim(p,child,target):rotate(p,(pos(child)-pos(p)).normalized().rotation_difference((target-pos(p)).normalized()))
def solve_chain(side,target,pole,leg=True):
 a,b,c=(B(side+n)for n in (['UpLeg','Leg','Foot'] if leg else ['Arm','ForeArm','Hand']));s,e,w=pos(a),pos(b),pos(c);l1,l2=(e-s).length,(w-e).length;axis=(target-s).normalized();d=max(abs(l1-l2)+.001,min((target-s).length,l1+l2-.001));along=(l1*l1-l2*l2+d*d)/(2*d);h=math.sqrt(max(0,l1*l1-along*along));bend=pole-s;bend-=axis*bend.dot(axis);bend.normalize();aim(a,b,s+axis*along+bend*h);aim(b,c,target);return(pos(c)-target).length
rest={p.name:p.matrix_basis.copy()for p in bones};restworld={p.name:world(p).copy()for p in bones}
before=set(scene.objects);bpy.ops.import_scene.gltf(filepath=os.path.join(OUT,'boss-source.glb'))
source_objects=[o for o in scene.objects if o not in before];source=next(o for o in source_objects if o.type=='ARMATURE')
strip=source.animation_data.nla_tracks[0].strips[0];duration=(strip.frame_end-strip.frame_start)/30
# The importer uses a one-frame strip origin. Sample the actual source action
# starting at strip.frame_start; preserve the delivered 6.5667-second duration.
source_samples=[];landmarks=[]
end=round(duration*30)
for f in range(end+1):
 scene.frame_set(f+int(strip.frame_start));update()
 source_samples.append({p.name:p.matrix_basis.copy()for p in source.pose.bones if p.name.startswith('mixamorig:')})
 landmarks.append({n:(source.matrix_world@source.pose.bones['mixamorig:'+n].matrix).translation.copy()for n in ['RightFoot','LeftFoot','RightToeBase','LeftToeBase']})
for o in source_objects:bpy.data.objects.remove(o,do_unlink=True)
ground=json.load(open(os.path.join(ROOT,'docs/boss-video-raw-audit.json')))['constantGroundOffset']
feet={};footq={}
for side in ['Right','Left']:
 p=Vector([statistics.median(s[side+'Foot'][i]for s in landmarks)for i in range(3)])
 p.z=restworld[B(side+'Foot').name].translation.z;feet[side]=p
 direction=sum((s[side+'ToeBase']-s[side+'Foot']for s in landmarks),Vector())
 restdir=restworld[B(side+'ToeBase').name].translation-restworld[B(side+'Foot').name].translation
 yaw=math.atan2(direction.y,direction.x)-math.atan2(restdir.y,restdir.x)
 footq[side]=Quaternion((0,0,1),yaw)@restworld[B(side+'Foot').name].to_quaternion()

def grip(side):
 # Use the captured curled finger geometry, not a fixed wrist rotation or
 # fabricated finger curl. The center lies inside the C-shaped grasp.
 points=[pos(B(side+'Hand'+digit+str(j)))for digit in ['Index','Middle','Ring','Pinky']for j in [1,3]]
 return sum(points,Vector())/len(points)*.8+pos(B(side+'HandThumb3'))*.2
samples=[];metrics=[];grip_frames={};scene.frame_start=0;scene.frame_end=end
def apply_pose(f,capture=True):
 scene.frame_set(f)
 for p in bones:p.matrix_basis=rest[p.name].copy()
 sample=source_samples[f]
 # A short end correction closes only the loop seam.
 blend=max(0,(f-(end-12))/12);blend=blend*blend*(3-2*blend)
 for n,m in sample.items():bones[n].matrix_basis=m.lerp(source_samples[0][n],blend)
 update()
 hip=B('Hips');m=world(hip);m.translation.z+=.12-ground;setworld(hip,m)
 captured_hands={side:world(B(side+'Hand')).copy()for side in ['Right','Left']}
 # Constant alignment corrections recover the upright guard in the video.
 # Every captured variation remains beneath these offsets.
 rotate(B('Spine'),Quaternion((1,0,0),math.radians(-18)))
 rotate(B('Spine1'),Quaternion((1,0,0),math.radians(-6)))
 rotate(B('Neck'),Quaternion((1,0,0),math.radians(-12)))
 # Preserve the captured hand height/orientation while lifting the torso.
 for side in ['Right','Left']:
  hand=B(side+'Hand');after=world(hand);before=captured_hands[side]
  target=after.translation.lerp(before.translation,.7);q=after.to_quaternion().slerp(before.to_quaternion(),.7)
  solve_chain(side,target,pos(B(side+'ForeArm')),False)
  setworld(hand,Matrix.LocRotScale(pos(hand),q,after.to_scale()))
 errors=[]
 for side,sign in [('Right',-1),('Left',1)]:
  knee=pos(B(side+'Leg'));pole=knee+Vector((0,-.5,0))
  errors.append(solve_chain(side,feet[side],pole))
  fm=world(B(side+'Foot'));setworld(B(side+'Foot'),Matrix.LocRotScale(feet[side],footq[side],fm.to_scale()))
  B(side+'ToeBase').matrix_basis=rest[B(side+'ToeBase').name].copy()
 update()
 rg,lg=grip('Right'),grip('Left');axis=(lg-rg).normalized()
 # Remove small tracking drift along the shaft while retaining captured elbows.
 center=(rg+lg)*.5;fixed={'Right':center-axis*.475,'Left':center+axis*.475}
 for side,g in [('Right',rg),('Left',lg)]:
  h=B(side+'Hand');hm=world(h);target=hm.translation+fixed[side]-g
  solve_chain(side,target,pos(B(side+'ForeArm')),False)
  setworld(h,Matrix.LocRotScale(pos(h),hm.to_quaternion(),hm.to_scale()))
 rg,lg=fixed['Right'],fixed['Left'];axis=(lg-rg).normalized()
 blade=Vector((1,0,0));blade-=axis*blade.dot(axis);blade.normalize();depth=axis.cross(blade).normalized()
 wm=Matrix((blade,depth,axis)).transposed().to_4x4();wm.translation=rg-axis*.6
 # A rigid two-hand grasp cannot inherit the provider's 90-degree wrist
 # tracking flip. Keep the captured first-frame grip relative to the shaft;
 # preserve every captured finger joint rotation beneath the stabilized wrist.
 for side,g in [('Right',rg),('Left',lg)]:
  h=B(side+'Hand');hm=world(h)
  if side not in grip_frames:grip_frames[side]=wm.to_quaternion().inverted()@hm.to_quaternion()
  q=wm.to_quaternion()@grip_frames[side]
  setworld(h,Matrix.LocRotScale(hm.translation,q,hm.to_scale()))
  target=pos(h)+g-grip(side)
  solve_chain(side,target,pos(B(side+'ForeArm')),False)
  setworld(h,Matrix.LocRotScale(pos(h),q,hm.to_scale()))
 setworld(bones['WeaponSocket'],wm)
 update()
 if not capture:return
 samples.append({p.name:(p.location.copy(),p.rotation_quaternion.copy(),p.scale.copy())for p in bones})
 metrics.append({'time':f/30,'footError':max(errors),'handSpacing':(lg-rg).length,'rightGrip':list(rg),'leftGrip':list(lg),'hips':list(pos(hip)),'chest':list(pos(B('Spine2'))),'head':list(pos(B('Head')))})
# Ground each rigid boot from its actual skinned sole, rather than assuming
# the imported ankle landmark is an identical height on both feet.
for iteration in range(2):
 apply_pose(0,False)
 evaluated=body.evaluated_get(bpy.context.evaluated_depsgraph_get())
 for side in ['Right','Left']:
  group_ids={g.index for g in body.vertex_groups if side+'Foot' in g.name or side+'ToeBase' in g.name}
  sole=[(body.matrix_world@evaluated.data.vertices[v.index].co).z for v in body.data.vertices if sum(g.weight for g in v.groups if g.group in group_ids)>.6]
  if sole:feet[side].z-=min(sole)
for f in range(end+1):apply_pose(f)
action=bpy.data.actions.new('idle-video');rig.animation_data.action=action
for f,sample in enumerate(samples):
 for n,(location,rotation,scale)in sample.items():
  p=bones[n];p.location=location;p.rotation_quaternion=rotation;p.scale=scale
  for channel in ['location','rotation_quaternion','scale']:p.keyframe_insert(channel,frame=f)
rig.animation_data.action=None
for t in list(rig.animation_data.nla_tracks):rig.animation_data.nla_tracks.remove(t)
t=rig.animation_data.nla_tracks.new();t.name='idle-video';t.strips.new('idle-video',0,action)
for p in bones:p.matrix_basis=rest[p.name].copy()
scene.frame_set(0);update();bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);body.select_set(True);bpy.context.view_layer.objects.active=rig
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT,'boss-idle-video.blend'))
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT,'boss-idle-video.glb'),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='NLA_TRACKS',export_nla_strips=True,export_frame_range=False,export_force_sampling=True,export_def_bones=False)
with open(os.path.join(ROOT,'docs/boss-video-idle-bake.json'),'w')as f:json.dump({'duration':end/30,'fps':30,'sourceJob':'cmu1pj1hk005h2wp6hjbb0e60','postureOffsetsDegrees':{'Spine':-18,'Spine1':-6,'Neck':-12},'hipRaise':.12,'maxFootError':max(s['footError']for s in metrics),'handSpacingRange':[min(s['handSpacing']for s in metrics),max(s['handSpacing']for s in metrics)],'samples':metrics},f)
print('VIDEO_IDLE_EXPORTED',OUT,flush=True)
