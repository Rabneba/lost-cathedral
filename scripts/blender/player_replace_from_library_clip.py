# Replace one player clip with a library animation on a Mixamo-named skeleton (a Mixamo FBX
# downloaded "without skin", or any GLB whose bones are mixamorig:*). The transfer is a
# rest-pose-compensated rotation copy in armature space: each bone receives the source bone's
# rotation *change from its own rest pose*, applied to our rest pose, so differing rest poses
# (Mixamo T-pose vs. the rig's A-pose) and proportions do not distort the result. Root travel
# is dropped (in-place clip); the hips keep our rest height plus the source's vertical bob.
# Env: VESPER_SRC (fbx|glb), VESPER_SRC_CLIP (optional action name), VESPER_TARGET (clip name),
#      VESPER_BASE_BLEND, VESPER_BASE_MANIFEST, VESPER_OUT, VESPER_SOURCE (provenance text),
#      VESPER_LOOP (1 = locomotion loop: drift removal + belt speed), VESPER_TRIM=f0,f1,
#      VESPER_FPS_OUT (default 30), VESPER_MIRROR_YAW (extra yaw in degrees).
import bpy,os,json,math,hashlib,sys
from mathutils import Matrix,Vector,Quaternion
R=os.getcwd();FPS=30
SRC=os.environ['VESPER_SRC'];SRC_CLIP=os.environ.get('VESPER_SRC_CLIP');TARGET=os.environ.get('VESPER_TARGET','run-forward')
BASE=os.environ['VESPER_BASE_BLEND'];BASE_MANIFEST=os.environ['VESPER_BASE_MANIFEST'];OUT=os.environ['VESPER_OUT'];SOURCE=os.environ.get('VESPER_SOURCE','library clip')
LOOP=os.environ.get('VESPER_LOOP','1')=='1';TRIM=os.environ.get('VESPER_TRIM');EXTRA_YAW=math.radians(float(os.environ.get('VESPER_MIRROR_YAW','0')))
bpy.context.preferences.filepaths.save_version=0
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
for b in bones:b.matrix_basis.identity()
update()
before=set(bpy.data.objects)
if SRC.lower().endswith('.fbx'):bpy.ops.import_scene.fbx(filepath=R+'/'+SRC,automatic_bone_orientation=False,ignore_leaf_bones=True)
else:bpy.ops.import_scene.gltf(filepath=R+'/'+SRC)
imported=[o for o in bpy.data.objects if o not in before];src=next(o for o in imported if o.type=='ARMATURE')
def canon(n):return n.replace('mixamorig_','mixamorig:').replace('mixamorig','mixamorig:') if not n.startswith('mixamorig:') and n.startswith('mixamorig') else n
smap={}
for b in src.data.bones:
 c=canon(b.name)
 if c in rig.data.bones:smap[c]=b.name
shared=[n for n in rig.data.bones.keys() if n in smap]
if 'mixamorig:Hips' not in shared:raise SystemExit('source has no mixamorig:Hips; bones: '+', '.join(b.name for b in src.data.bones)[:300])
raw=next((a for a in bpy.data.actions if a.name==SRC_CLIP),None) if SRC_CLIP else (src.animation_data.action if src.animation_data else None)
if raw is None:raise SystemExit('no action on the source; actions: '+', '.join(a.name for a in bpy.data.actions))
src.animation_data.action=raw
if hasattr(raw,'slots') and len(raw.slots):src.animation_data.action_slot=raw.slots[0]
f0,f1=(int(v) for v in TRIM.split(',')) if TRIM else (int(raw.frame_range[0]),int(raw.frame_range[1]))
src_fps=scene.render.fps if scene.render.fps else 30
def depth(b):
 d=0
 while b.parent:b=b.parent;d+=1
 return d
order=sorted(shared,key=lambda n:depth(rig.data.bones[n]))
# rest rotations in armature space
rest_ours={n:rig.data.bones[n].matrix_local.to_3x3() for n in order}
rest_src={n:src.data.bones[smap[n]].matrix_local.to_3x3() for n in order}
src_scale=src.matrix_world.to_scale().x;ours_scale=rig.matrix_world.to_scale().x
hips_rest_src=src.data.bones[smap['mixamorig:Hips']].matrix_local.translation.copy();hips_rest_ours=rig.data.bones['mixamorig:Hips'].matrix_local.translation.copy()
leg_src=(src.data.bones[smap['mixamorig:LeftUpLeg']].matrix_local.translation-src.data.bones[smap['mixamorig:LeftFoot']].matrix_local.translation).length
leg_ours=(rig.data.bones['mixamorig:LeftUpLeg'].matrix_local.translation-rig.data.bones['mixamorig:LeftFoot'].matrix_local.translation).length
leg_ratio=leg_ours/leg_src if leg_src>1e-6 else 1
body.hide_viewport=True
def retarget():
 posed={}
 srot={n:src.pose.bones[smap[n]].matrix.to_3x3() for n in order}
 turn=Matrix.Rotation(EXTRA_YAW,3,'Z') if abs(EXTRA_YAW)>1e-9 else None
 for n in order:
  bone=rig.data.bones[n];parent=bone.parent
  base=(posed[parent.name]@parent.matrix_local.inverted()@bone.matrix_local) if parent and parent.name in posed else bone.matrix_local.copy()
  delta=srot[n]@rest_src[n].inverted()
  if turn is not None:delta=turn@delta
  rot=(delta@rest_ours[n]).to_4x4()
  if n=='mixamorig:Hips':
   sp=src.pose.bones[smap[n]].matrix.translation;dz=(sp.z-hips_rest_src.z)*leg_ratio
   t=Vector((hips_rest_ours.x,hips_rest_ours.y,hips_rest_ours.z+dz))
  else:t=base.translation.copy()
  desired=Matrix.Translation(t)@rot
  basis=base.inverted()@desired;pb=bones[n];pb.location,pb.rotation_quaternion,pb.scale=basis.decompose();pb.scale=Vector((1,1,1));posed[n]=desired
 update()
samples=[];feet=[]
def foot(side):
 f=wm('mixamorig:'+side+'Foot').translation;t=wm('mixamorig:'+side+'ToeBase').translation if 'mixamorig:'+side+'ToeBase' in bones else f
 fwd=(bones['mixamorig:'+side+'Foot'].matrix.translation-bones['mixamorig:Hips'].matrix.translation)
 return min(f.z,t.z),fwd
n_out=max(2,round((f1-f0)/src_fps*FPS))
for i in range(n_out+1):
 sf=f0+(f1-f0)*i/n_out;scene.frame_set(int(sf),subframe=sf-int(sf));retarget();samples.append({'pose':snapshot(),'L':foot('Left'),'R':foot('Right')})
src.animation_data.action=None;body.hide_viewport=False
N=n_out
# forward axis after retarget: pelvis
scene.frame_set(0);restore(samples[0]['pose'])
fwd_axis=(wm('mixamorig:LeftUpLeg').translation-wm('mixamorig:RightUpLeg').translation).cross(Vector((0,0,1))).normalized()
# belt speed for loops: backward sweep of the low foot along the forward axis
speed=0
if LOOP:
 speeds=[]
 low=min(s[side][0] for s in samples for side in 'LR')
 for i in range(1,N+1):
  for side in 'LR':
   v=((samples[i-1][side][1]-samples[i][side][1]).dot(fwd_axis))*ours_scale*FPS
   if samples[i][side][0]<low+.08 and v>.3:speeds.append(v)
  speeds.sort();speed=speeds[int(len(speeds)*.8)] if speeds else 0
# drift removal for loops + grounding
footgroups={g.index for g in body.vertex_groups if any(n in g.name for n in ['Foot','ToeBase'])};footverts=[v.index for v in body.data.vertices if sum(g.weight for g in v.groups if g.group in footgroups)>.5]
def lowest_foot():
 ev=body.evaluated_get(bpy.context.evaluated_depsgraph_get());mesh=ev.to_mesh();zs=sorted((ev.matrix_world@mesh.vertices[i].co).z for i in footverts);ev.to_mesh_clear();return zs[int(len(zs)*.008)]
start,last=samples[0]['pose'],samples[N]['pose'];poses=[];lows=[]
for i in range(N+1):
 u=i/N if LOOP else 0;p=samples[i]['pose']
 for n,(loc,q,scl)in p.items():
  if LOOP:
   l0,q0,s0=start[n];le,qe,se=last[n];fix=Quaternion().slerp(q0@qe.inverted(),u);b=bones[n];b.location=loc+(l0-le)*u;b.rotation_quaternion=fix@q;b.scale=scl
  else:b=bones[n];b.location=loc;b.rotation_quaternion=q;b.scale=scl
 update();poses.append(snapshot());lows.append(lowest_foot())
floor_z=min(lows);support=[z<floor_z+.025 for z in lows];planted=[-(z-.003) for z in lows];fix=[None]*(N+1);idx=[i for i in range(N+1) if support[i]] or [0]
for i in range(N+1):
 if support[i]:fix[i]=planted[i];continue
 prev=max((j for j in idx if j<i),default=None);nxt=min((j for j in idx if j>i),default=None)
 if prev is None:prev=max(idx)-(N+1)
 if nxt is None:nxt=min(idx)+(N+1)
 t=(i-prev)/(nxt-prev) if nxt!=prev else 0;fix[i]=planted[prev%(N+1)]*(1-t)+planted[nxt%(N+1)]*t;fix[i]=max(fix[i],planted[i])
corrected=[]
for i in range(N+1):
 restore(poses[i]);hm=wm('mixamorig:Hips');hm.translation.z+=fix[i];bones['mixamorig:Hips'].matrix=inv@hm;update()
 bones['WeaponSocket'].matrix=inv@(wm('mixamorig:RightHand')@sw);bones['ShieldSocket'].matrix=inv@(wm('mixamorig:LeftHand')@sh);update()
 corrected.append(snapshot())
airborne=sum(1 for i in range(N+1) if lows[i]+fix[i]>.02)
new=bpy.data.actions.new('library-'+TARGET);rig.animation_data.action=new;rig.animation_data.action_slot=new.slots[0] if len(new.slots) else None
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
meta.update({'asset':OUT+'.glb','revision':'library-clip-candidate-2026-09-15','previousCandidateSha256':meta['sha256'],'sha256':hashlib.sha256(open(dest+'.glb','rb').read()).hexdigest(),'reviewStatus':'candidate: '+TARGET+' replaced by a library clip; studio review required'})
entry={'duration':N/FPS,'source':SOURCE+f'; source frames {f0}-{f1} at {src_fps} fps, rest-pose-compensated rotation transfer, soles grounded through skinned foot vertices, sockets hand-relative'}
if LOOP:entry.update({'loop':True,'sourceSpeed':round(speed,3)})
old_entry=meta['clips'].get(TARGET,{});[entry.setdefault(k,v) for k,v in old_entry.items() if k not in ('duration','loop','sourceSpeed','source','note','gait')]
meta['clips'][TARGET]=entry
json.dump(meta,open(R+'/'+OUT+'-manifest.json','w'),indent=1)
json.dump({'src':SRC,'srcClip':raw.name,'target':TARGET,'frames':[f0,f1],'srcFps':src_fps,'outFrames':N,'sharedBones':len(shared),'legRatio':leg_ratio,'beltSpeed':speed,'supportFrames':sum(support),'airborneFrames':airborne,'endpointDriftDegrees':max(start[n][1].rotation_difference(last[n][1]).angle*180/math.pi for n in start) if LOOP else None},open(R+'/'+OUT+'-report.json','w'),indent=1)
print('LIBRARY_REPLACED',TARGET,'frames',f0,f1,'->',N,'speed',round(speed,3),flush=True)
