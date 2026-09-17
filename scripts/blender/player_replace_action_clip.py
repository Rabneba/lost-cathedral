"""Replace one action clip (light/heavy/hit) in a player bundle with a Uthana capture.

Same transfer as player_replace_forward_gait.py (armature-space retarget, camera-heading
correction, support-aware grounding, hand-relative sockets) but for a one-shot clip: the
take is trimmed around the motion, not looped, and the manifest gets measured
windup/active/recovery and hit windows from the sword hand's sweep.

Environment:
  VESPER_RAW_GLB, VESPER_RAW_CLIP (default light-raw), VESPER_TARGET (default light)
  VESPER_BASE_BLEND / VESPER_BASE_MANIFEST   bundle to derive from
  VESPER_OUT   output stem; VESPER_SOURCE provenance; VESPER_SOURCE_VIDEO reference path
  VESPER_LEAD / VESPER_TAIL   seconds of guard kept before/after the motion (default .25/.4)
"""
import bpy,os,json,math,hashlib
from mathutils import Matrix,Quaternion,Vector
R=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'))
RAW=os.environ['VESPER_RAW_GLB'];RAW_CLIP=os.environ.get('VESPER_RAW_CLIP','light-raw');TARGET=os.environ.get('VESPER_TARGET','light')
BASE=os.environ['VESPER_BASE_BLEND'];BASE_MANIFEST=os.environ['VESPER_BASE_MANIFEST'];OUT=os.environ['VESPER_OUT'];SOURCE=os.environ.get('VESPER_SOURCE','Uthana capture');SOURCE_VIDEO=os.environ.get('VESPER_SOURCE_VIDEO','')
LEAD=float(os.environ.get('VESPER_LEAD','.55'));TAIL=float(os.environ.get('VESPER_TAIL','.9'));FACING=os.environ.get('VESPER_FACING_YAW');TRIM=os.environ.get('VESPER_TRIM');HEADING=os.environ.get('VESPER_HEADING_MODE','cut');GUARD_WORLD_YAW=float(os.environ.get('VESPER_GUARD_WORLD_YAW','-35'))
FPS=30;bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.open_mainfile(filepath=R+'/'+BASE)
scene=bpy.context.scene;rig=next(o for o in scene.objects if o.type=='ARMATURE');bones=rig.pose.bones;inv=rig.matrix_world.inverted()
body=next(o for o in scene.objects if o.type=='MESH' and not o.hide_render)
tracks=list(rig.animation_data.nla_tracks)
for t in tracks:t.mute=True
def update():bpy.context.view_layer.update()
def wm(n):return rig.matrix_world@bones[n].matrix
def snapshot():return{b.name:(b.location.copy(),b.rotation_quaternion.copy(),b.scale.copy())for b in bones}
def restore(p):
 for n,(l,q,s)in p.items():b=bones[n];b.location=l;b.rotation_quaternion=q;b.scale=s
 update()
old=next(t for t in tracks if t.name==TARGET).strips[0].action
rig.animation_data.action=old;rig.animation_data.action_slot=old.slots[0];scene.frame_set(0);update()
sw=wm('mixamorig:RightHand').inverted()@wm('WeaponSocket');sh=wm('mixamorig:LeftHand').inverted()@wm('ShieldSocket');rig.animation_data.action=None
before=set(bpy.data.objects);bpy.ops.import_scene.gltf(filepath=R+'/'+RAW);imported=[o for o in bpy.data.objects if o not in before]
src=next(o for o in imported if o.type=='ARMATURE')
shared=[b.name for b in rig.data.bones if b.name in src.data.bones]
rest_error=max((rig.data.bones[n].head_local-src.data.bones[n].head_local).length for n in shared if 'Arm' not in n and 'Hand' not in n and 'Shoulder' not in n)
if rest_error>.5:raise SystemExit(f'leg/spine rest pose differs by {rest_error:.2f} cm')
raw=next((a for a in bpy.data.actions if a.name==RAW_CLIP),None) or src.animation_data.action
end=round(raw.frame_range[1]);src.animation_data.action=raw;src.animation_data.action_slot=raw.slots[0]
def depth(b):
 d=0
 while b.parent:b=b.parent;d+=1
 return d
order=sorted(shared,key=lambda n:depth(rig.data.bones[n]))
body.hide_viewport=True
def pelvis_yaw():
 l=src.pose.bones['mixamorig:LeftUpLeg'].head;r=src.pose.bones['mixamorig:RightUpLeg'].head;f=(l-r).cross(Vector((0,1,0)));return math.atan2(f.x,f.z)
# Pass 1 on the source rig: sword-hand speed relative to the hips (rotation-invariant) finds
# the cut; the pelvis heading during the cut is the enemy direction (the performer may hold
# a bladed guard before and after, which is then kept in the clip rather than corrected).
rel=[];yaws=[]
for f in range(end+1):
 scene.frame_set(f);update();rel.append((src.pose.bones['mixamorig:RightHand'].head-src.pose.bones['mixamorig:Hips'].head)*src.matrix_world.to_scale().x);yaws.append(pelvis_yaw())
speed=[0]+[(rel[f]-rel[f-1]).length*FPS for f in range(1,end+1)]
peak=max(speed);pk=speed.index(peak)
a0=pk
while a0>0 and speed[a0-1]>.5*peak:a0-=1
a1=pk
while a1<end and speed[a1+1]>.5*peak:a1+=1
# Heading: 'cut' aims the cut phase at the enemy; 'guard' puts the performer's still guard
# (before any motion) at GUARD_WORLD_YAW, the stance the game idle already holds.
mean_yaw=lambda frames:math.atan2(sum(math.sin(yaws[f]) for f in frames),sum(math.cos(yaws[f]) for f in frames))
still=[f for f in range(0,a0) if speed[f]<.1*peak][:12] or [0]
yaw_fix=math.radians(GUARD_WORLD_YAW)-mean_yaw(still) if HEADING=='guard' else -mean_yaw(range(a0,a1+1))
if TRIM:c0,c1=[int(v) for v in TRIM.split(',')]
else:c0=max(0,a0-round(LEAD*FPS));c1=min(end,a1+round(TAIL*FPS))
# The clip is resampled to DURATION seconds (reference performers move slowly; V6 played its
# 4.7 s source in 1.5 s), so action time equals clip time in the manifest.
# VESPER_SKIP=k0,k1 drops source frames [k0,k1) (a performer holding the end pose before
# recovering); the trimmed take is then resampled as one continuous motion.
# A third value keeps that many clip frames of the skipped span, compressed, so the seam is a
# quick continuous motion instead of a pose jump (VESPER_SKIP=k0,k1,keep).
SKIP=os.environ.get('VESPER_SKIP');skip=[int(v) for v in SKIP.split(',')] if SKIP else [c1,c1,0]
skip0,skip1=skip[0],skip[1];keep=skip[2] if len(skip)>2 else 0
if not (c0<=skip0<=skip1<=c1):raise SystemExit(f'skip {skip0},{skip1} outside trim {c0},{c1}')
L=(c1-c0)-(skip1-skip0)+keep
def src_frame(u):
 a=skip0-c0
 if u<=a:return c0+u
 if u<=a+keep:return skip0+(u-a)*(skip1-skip0)/keep
 return c0+u-keep+(skip1-skip0)
DURATION=float(os.environ.get('VESPER_DURATION') or L/FPS);N=round(DURATION*FPS);DURATION=N/FPS;stretch=L/N  # exact clip length after rounding to whole frames
def retarget():
 desired={n:src.pose.bones[n].matrix.copy() for n in order};posed={}
 hips=desired['mixamorig:Hips'].translation.copy();turn=Matrix.Translation(hips)@Matrix.Rotation(yaw_fix,4,'Y')@Matrix.Translation(-hips)
 for n in order:desired[n]=turn@desired[n]
 for n in order:
  bone=rig.data.bones[n];parent=bone.parent
  base=(posed[parent.name]@parent.matrix_local.inverted()@bone.matrix_local) if parent and parent.name in posed else bone.matrix_local
  basis=base.inverted()@desired[n];pb=bones[n];pb.location,pb.rotation_quaternion,pb.scale=basis.decompose();posed[n]=desired[n]
 update()
samples=[]
for i in range(N+1):
 sf=src_frame(L*i/N);scene.frame_set(int(sf),subframe=sf-int(sf));retarget();samples.append({'pose':snapshot()})
src.animation_data.action=None;body.hide_viewport=False
windup=(a0-c0)/stretch/FPS;activeSeconds=(a1-a0+1)/stretch/FPS;recovery=DURATION-windup-activeSeconds
guard_yaw=math.degrees(mean_yaw(still)+yaw_fix);start_yaw=math.degrees(yaws[c0]+yaw_fix);cut_yaw=math.degrees(mean_yaw(range(a0,a1+1))+yaw_fix)
footgroups={g.index for g in body.vertex_groups if any(n in g.name for n in ['Foot','ToeBase'])};footverts=[v.index for v in body.data.vertices if sum(g.weight for g in v.groups if g.group in footgroups)>.5]
def lowest_foot():
 ev=body.evaluated_get(bpy.context.evaluated_depsgraph_get());mesh=ev.to_mesh();zs=sorted((ev.matrix_world@mesh.vertices[i].co).z for i in footverts);ev.to_mesh_clear();return zs[int(len(zs)*.008)]
poses=[];lows=[]
for i in range(N+1):restore(samples[i]['pose']);poses.append(snapshot());lows.append(lowest_foot())
floor_z=min(lows);support=[z<floor_z+.025 for z in lows];planted=[-(z-.003) for z in lows];fix=[None]*(N+1);idx=[i for i in range(N+1) if support[i]]
for i in range(N+1):
 if support[i]:fix[i]=planted[i];continue
 prev=max((j for j in idx if j<i),default=None);nxt=min((j for j in idx if j>i),default=None)
 if prev is None:fix[i]=planted[nxt]
 elif nxt is None:fix[i]=planted[prev]
 else:t=(i-prev)/(nxt-prev);fix[i]=planted[prev]*(1-t)+planted[nxt]*t
 fix[i]=max(fix[i],planted[i])
# Blade model (VESPER_BLADE_MODEL=1). Monocular capture keeps the wrist plausible (swing under
# 30 degrees) but the forearm pronation is unreliable, so the blade, which sits about 70 degrees
# off the forearm in this grip, can point anywhere on that cone, often backward through a cut.
# The fix keeps the grip: the forearm is twisted about its own axis so the blade comes as close
# as its cone allows to the aim point (the opponent's chest, 1.4 m ahead of the hips along the
# cut heading), then the hand adds at most VESPER_BLADE_SWING degrees of wrist toward it. The
# aim fades in across the windup and out over 0.4 s after the active phase; the captured grip is
# kept before and after. The tip is finally kept above the floor.
BLADE=os.environ.get('VESPER_BLADE_MODEL')=='1';SWING_MAX=math.radians(float(os.environ.get('VESPER_BLADE_SWING','25')))
# The rig has no forearm twist bone, so a large twist wrings the forearm skin at the elbow.
# VESPER_FOREARM_TWIST_MAX caps the forearm's share; the remainder rolls the sword in the fist
# (the WeaponSocket turns about the forearm axis) so the arm itself stays as captured.
FORE_MAX=math.radians(float(os.environ.get('VESPER_FOREARM_TWIST_MAX','60')));socket_roll=[]
def smooth01(x,a,b):
 t=min(1,max(0,(x-a)/(b-a)));return t*t*(3-2*t)
aims=[];weights=[]
if BLADE:
 a0c=(a0-c0)/stretch;a1c=(a1-c0)/stretch
 fwd_sum=Vector((0,0,0));hips_list=[]
 for i in range(N+1):
  restore(poses[i]);hm=wm('mixamorig:Hips');hm.translation.z+=fix[i];bones['mixamorig:Hips'].matrix=inv@hm;update()
  hips_list.append(wm('mixamorig:Hips').translation.copy())
  if a0c<=i<=a1c:
   f=(wm('mixamorig:LeftUpLeg').translation-wm('mixamorig:RightUpLeg').translation).cross(Vector((0,0,1)));fwd_sum+=Vector((f.x,f.y,0)).normalized()
 fwd=fwd_sum.normalized() if fwd_sum.length>1e-6 else Vector((0,-1,0))
 for i in range(N+1):
  aims.append(hips_list[i]+fwd*1.4+Vector((0,0,.3)))
  weights.append(min(smooth01(i/max(1,a0c),0,1),1-smooth01((i-a1c)/(.4*FPS),0,1)))
corrected=[];blade_turn=[];forearm_twist=[];prev_theta=None
for i in range(N+1):
 restore(poses[i]);hm=wm('mixamorig:Hips');hm.translation.z+=fix[i];bones['mixamorig:Hips'].matrix=inv@hm;update()
 if BLADE and weights[i]>1e-3:
  w=weights[i];fore_m=wm('mixamorig:RightForeArm');hand_m=wm('mixamorig:RightHand');A=(hand_m.translation-fore_m.translation).normalized()
  bones['WeaponSocket'].matrix=inv@(hand_m@sw);update();B=wm('WeaponSocket').to_3x3().col[2].normalized()
  T=(aims[i]-hand_m.translation).normalized()
  bp=B-A*B.dot(A);tp=T-A*T.dot(A)
  if bp.length>1e-4 and tp.length>1e-4:
   raw_theta=math.atan2(A.dot(bp.cross(tp)),bp.dot(tp))
   # Unwrap over time: near 180 degrees the sign of the twist flips between frames, which is
   # harmless for a full twist but, once the forearm share is capped, turns into a real flip.
   if prev_theta is not None:raw_theta=min((raw_theta+k*2*math.pi for k in (-1,0,1)),key=lambda v:abs(v-prev_theta))
   # When the aim lies close to the forearm axis the twist is ill-conditioned (the chop bottom):
   # hold the previous twist there, and never let it change faster than 25 degrees a frame.
   conf=smooth01(tp.length,.15,.4)
   if prev_theta is not None:
    raw_theta=prev_theta+(raw_theta-prev_theta)*conf;step=math.radians(25);raw_theta=prev_theta+max(-step,min(step,raw_theta-prev_theta))
   prev_theta=raw_theta;theta=raw_theta*w;fore_part=max(-FORE_MAX,min(FORE_MAX,theta));residual=theta-fore_part;forearm_twist.append(math.degrees(fore_part));socket_roll.append(math.degrees(residual));e=fore_m.translation.copy()
   bones['mixamorig:RightForeArm'].matrix=inv@(Matrix.Translation(e)@Matrix.Rotation(fore_part,4,A)@Matrix.Translation(-e)@fore_m);update()
  else:residual=0.0
  def seat(hm):
   # hand-relative socket, rolled about the forearm axis by the residual the forearm could not take
   return Matrix.Translation(hm.translation)@Matrix.Rotation(residual,4,A)@Matrix.Translation(-hm.translation)@(hm@sw)
  hand_m=wm('mixamorig:RightHand');bones['WeaponSocket'].matrix=inv@seat(hand_m);update();B=wm('WeaponSocket').to_3x3().col[2].normalized()
  ang=B.angle(T) if B.dot(T)>-.999 else math.pi
  if ang>1e-4:
   rot=B.rotation_difference(T);part=Quaternion((1,0,0,0)).slerp(rot,min(1,SWING_MAX*w/ang));hp=hand_m.translation.copy();blade_turn.append(math.degrees(part.angle))
   bones['mixamorig:RightHand'].matrix=inv@(Matrix.Translation(hp)@part.to_matrix().to_4x4()@Matrix.Translation(-hp)@hand_m);update()
  # Floor: lift the blade with a small extra wrist rotation if the tip would go under.
  hand_m=wm('mixamorig:RightHand');bones['WeaponSocket'].matrix=inv@seat(hand_m);update();B=wm('WeaponSocket').to_3x3().col[2].normalized();hp=hand_m.translation.copy()
  if hp.z+B.z*1.27<.06 and hp.z>.08:
   gz=(.06-hp.z)/1.27;h=math.sqrt(max(1e-6,1-gz*gz));xy=Vector((B.x,B.y));xy=(xy.normalized() if xy.length>1e-6 else Vector((fwd.x,fwd.y)).normalized())*h;goal=Vector((xy.x,xy.y,gz)).normalized()
   rot=B.rotation_difference(goal);bones['mixamorig:RightHand'].matrix=inv@(Matrix.Translation(hp)@rot.to_matrix().to_4x4()@Matrix.Translation(-hp)@hand_m);update()
 bones['WeaponSocket'].matrix=inv@(seat(wm('mixamorig:RightHand')) if (BLADE and weights[i]>1e-3) else (wm('mixamorig:RightHand')@sw));bones['ShieldSocket'].matrix=inv@(wm('mixamorig:LeftHand')@sh);update()
 if BLADE:
  # Exact floor guard on the seated sword: turn the sword in the fist just enough to keep the tip up.
  sm=wm('WeaponSocket');B=sm.to_3x3().col[2].normalized();sp=sm.translation.copy()
  if sp.z+B.z*1.27<.06 and sp.z>.08:
   gz=(.06-sp.z)/1.27;h=math.sqrt(max(1e-6,1-gz*gz));xy=Vector((B.x,B.y));xy=(xy.normalized() if xy.length>1e-6 else Vector((0,-1))).copy()*h;goal=Vector((xy.x,xy.y,gz)).normalized()
   bones['WeaponSocket'].matrix=inv@(Matrix.Translation(sp)@B.rotation_difference(goal).to_matrix().to_4x4()@Matrix.Translation(-sp)@sm);update()
 corrected.append(snapshot())
new=bpy.data.actions.new('video-v4-'+TARGET);rig.animation_data.action=new;rig.animation_data.action_slot=new.slots[0] if len(new.slots) else None
for i,p in enumerate(corrected):
 for n,(loc,q,scl)in p.items():
  b=bones[n];b.location=loc;b.rotation_quaternion=q;b.scale=scl;b.keyframe_insert('location',frame=i);b.keyframe_insert('rotation_quaternion',frame=i);b.keyframe_insert('scale',frame=i)
new.use_fake_user=True;rig.animation_data.action=None
for b in bones:b.matrix_basis.identity()
track=next(t for t in tracks if t.name==TARGET);strip=track.strips[0];track.strips.remove(strip);track.strips.new(TARGET,0,new)
for o in imported:bpy.data.objects.remove(o,do_unlink=True)
for t in tracks:t.mute=False
bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);body.select_set(True);bpy.context.view_layer.objects.active=rig
dest=R+'/'+OUT;os.makedirs(os.path.dirname(dest),exist_ok=True);bpy.ops.wm.save_as_mainfile(filepath=dest+'.blend')
bpy.ops.export_scene.gltf(filepath=dest+'.glb',use_selection=True,export_format='GLB',export_animations=True,export_animation_mode='NLA_TRACKS',export_nla_strips=True,export_frame_range=False,export_force_sampling=True,export_skins=True,export_materials='EXPORT')
meta=json.load(open(R+'/'+BASE_MANIFEST))
meta.update({'asset':OUT+'.glb','revision':'video-action-candidate-2026-09-15','previousCandidateSha256':meta['sha256'],'sha256':hashlib.sha256(open(dest+'.glb','rb').read()).hexdigest(),'reviewStatus':'candidate: '+TARGET+' replaced by a video-directed capture; studio review, blade-contact test and runtime playtest required'})
prev=meta['clips'].get(TARGET,{})
meta['clips'][TARGET]={'duration':DURATION,'blendIn':prev.get('blendIn',.1),'sourceFrames':[c0,c1],'source':SOURCE,'sourceVideo':SOURCE_VIDEO,'windup':round(windup,4),'active':round(activeSeconds,4),'recovery':round(recovery,4),'hitWindows':[[round(windup,4),round(windup+activeSeconds,4)]],**({'facingYawDegrees':float(FACING)} if FACING not in (None,'','0') else ({'facingYawDegrees':prev['facingYawDegrees']} if FACING is None and 'facingYawDegrees' in prev else {}))}
json.dump(meta,open(R+'/'+OUT+'-manifest.json','w'),indent=1)
json.dump({'raw':RAW,'target':TARGET,'rawFrames':end+1,'trim':[c0,c1],'skip':[skip0,skip1,keep],'bladeModel':({'swingLimitDegrees':math.degrees(SWING_MAX),'maxWristTurnDegrees':max(blade_turn) if blade_turn else 0,'maxForearmTwistDegrees':max(abs(v) for v in forearm_twist) if forearm_twist else 0,'maxSocketRollDegrees':max(abs(v) for v in socket_roll) if socket_roll else 0,'forearmTwistPerFrame':[round(v) for v in forearm_twist],'socketRollPerFrame':[round(v) for v in socket_roll],'framesAimed':len(blade_turn)} if BLADE else None),'seconds':DURATION,'handPeakSpeed':peak,'activeFrames':[a0,a1],'windup':windup,'active':activeSeconds,'recovery':recovery,'cameraHeadingCorrectionDegrees':math.degrees(yaw_fix),'guardYawInClipDegrees':guard_yaw,'startYawDegrees':start_yaw,'cutYawDegrees':cut_yaw,'sourceStretch':stretch,'headingMode':HEADING,'supportFrames':sum(support),'restPoseError':rest_error},open(R+'/'+OUT+'-report.json','w'),indent=1)
print('ACTION_REPLACED',TARGET,'trim',c0,c1,'windup',round(windup,2),'active',round(activeSeconds,2),'recovery',round(recovery,2),flush=True)
