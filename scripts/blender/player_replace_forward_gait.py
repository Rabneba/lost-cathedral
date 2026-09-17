"""Replace one locomotion clip in the selected player bundle with a Uthana capture.

Derivative only: V6 stays untouched. The raw take (already bound to the base rig by
scripts/combine-rig-motions.mjs) is transferred by bone name, one clean stride cycle is
chosen from foot contacts, end-pose drift is removed across the cycle, soles are grounded
through the actual skinned foot vertices, and the sockets follow the hands. Every other
clip, the mesh, materials and skin weights are exported unchanged.

Environment:
  VESPER_RAW_GLB   raw skinned artifact, e.g. assets/player-locomotion-revision/jog-video-raw-skinned.glb
  VESPER_RAW_CLIP  clip name inside it (default run-forward-raw)
  VESPER_TARGET    clip to replace (default run-forward)
  VESPER_OUT       output stem (default assets/player-locomotion-revision/player-video-candidate-v7)
  VESPER_SOURCE    provenance sentence recorded in the manifest
  VESPER_BASE_BLEND / VESPER_BASE_MANIFEST  bundle to derive from (default V6)
"""
import bpy,os,json,math,hashlib
from mathutils import Matrix,Quaternion,Vector
R=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'))
RAW=os.environ['VESPER_RAW_GLB'];RAW_CLIP=os.environ.get('VESPER_RAW_CLIP','run-forward-raw');TARGET=os.environ.get('VESPER_TARGET','run-forward')
OUT=os.environ.get('VESPER_OUT','assets/player-locomotion-revision/player-video-candidate-v7');SOURCE=os.environ.get('VESPER_SOURCE','Uthana capture')
FPS=30;bpy.context.preferences.filepaths.save_version=0
BASE=os.environ.get('VESPER_BASE_BLEND','assets/player-combat-revision/player-video-candidate-v6.blend');BASE_MANIFEST=os.environ.get('VESPER_BASE_MANIFEST','docs/player-combat-revision/player-video-candidate-v6-manifest.json')
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
# Hand-relative socket offsets from the clip being replaced, so the grip stays identical.
old=next(t for t in tracks if t.name==TARGET).strips[0].action
rig.animation_data.action=old;rig.animation_data.action_slot=old.slots[0];scene.frame_set(0);update()
sw=wm('mixamorig:RightHand').inverted()@wm('WeaponSocket');sh=wm('mixamorig:LeftHand').inverted()@wm('ShieldSocket');rig.animation_data.action=None
# Import the raw take and check it shares this skeleton's rest pose.
before=set(bpy.data.objects);bpy.ops.import_scene.gltf(filepath=R+'/'+RAW);imported=[o for o in bpy.data.objects if o not in before]
src=next(o for o in imported if o.type=='ARMATURE')
# Legs, spine and head share the rest pose; the arm chain was re-rested when the approved
# mesh was rebound, so bone-local values cannot be copied. Retarget in armature space:
# each bone takes the source bone's armature-space matrix, which is the visual invariant
# for identical hierarchies and bone lengths.
shared=[b.name for b in rig.data.bones if b.name in src.data.bones]
rest_error=max((rig.data.bones[n].head_local-src.data.bones[n].head_local).length for n in shared if 'Arm' not in n and 'Hand' not in n and 'Shoulder' not in n)
if rest_error>.5:raise SystemExit(f'leg/spine rest pose differs from the selected rig by {rest_error:.2f} cm')
raw=next((a for a in bpy.data.actions if a.name==RAW_CLIP),None) or src.animation_data.action
if raw is None:raise SystemExit('raw action not found')
end=round(raw.frame_range[1]);src.animation_data.action=raw;src.animation_data.action_slot=raw.slots[0]
def depth(b):
 d=0
 while b.parent:b=b.parent;d+=1
 return d
order=sorted(shared,key=lambda n:depth(rig.data.bones[n]))
body.hide_viewport=True
# Uthana returns the take facing the video's camera heading. Measure the mean pelvis
# facing in armature space (model forward is +Z there) and turn every frame about the
# vertical axis through the hips so the character faces forward.
def pelvis_yaw():
 l=src.pose.bones['mixamorig:LeftUpLeg'].head;r=src.pose.bones['mixamorig:RightUpLeg'].head;f=(l-r).cross(Vector((0,1,0)));return math.atan2(f.x,f.z)
yaws=[]
for f in range(end+1):scene.frame_set(f);update();yaws.append(pelvis_yaw())
yaw_fix=-math.atan2(sum(math.sin(y) for y in yaws),sum(math.cos(y) for y in yaws))
def retarget():
 desired={n:src.pose.bones[n].matrix.copy() for n in order};posed={}
 hips=desired['mixamorig:Hips'].translation.copy();turn=Matrix.Translation(hips)@Matrix.Rotation(yaw_fix,4,'Y')@Matrix.Translation(-hips)
 for n in order:desired[n]=turn@desired[n]
 for n in order:
  bone=rig.data.bones[n];parent=bone.parent
  base=(posed[parent.name]@parent.matrix_local.inverted()@bone.matrix_local) if parent and parent.name in posed else bone.matrix_local
  basis=base.inverted()@desired[n];pb=bones[n];pb.location,pb.rotation_quaternion,pb.scale=basis.decompose();posed[n]=desired[n]
 update()
def foot(side):
 f=wm('mixamorig:'+side+'Foot').translation;t=wm('mixamorig:'+side+'ToeBase').translation
 forward=(bones['mixamorig:'+side+'Foot'].matrix.translation-bones['mixamorig:Hips'].matrix.translation).z*rig.matrix_world.to_scale().x
 return min(f.z,t.z),Vector((f.x,f.y,0)),forward
samples=[]
for f in range(end+1):
 scene.frame_set(f);retarget();samples.append({'pose':snapshot(),'hips':wm('mixamorig:Hips').translation.copy(),'L':foot('Left'),'R':foot('Right')})
src.animation_data.action=None;body.hide_viewport=False
# Stride period from the autocorrelation of the left-minus-right foot offset along the
# model's forward axis (armature +Z after the heading correction). A cycle starts at a
# left-foot peak-forward pose; among candidates the one with the least endpoint drift wins.
def fwd(f,side):return samples[f][side][2]
period,best=None,-1
sig=[fwd(f,'L')-fwd(f,'R') for f in range(end+1)];mean=sum(sig)/len(sig);sig=[v-mean for v in sig]
# VESPER_MAX_PERIOD (s) widens the stride search for slow walks (a toward-camera walk cycled in 2 s).
MAX_PERIOD=float(os.environ.get('VESPER_MAX_PERIOD','1.4'))
for lag in range(int(.4*FPS),int(MAX_PERIOD*FPS)+1):
 num=sum(sig[i]*sig[i+lag] for i in range(end+1-lag));den=sum(v*v for v in sig);r=num/den if den else 0
 if r>best:best,period=r,lag
peaks=[f for f in range(2,end-1) if fwd(f,'L')>=fwd(f-1,'L') and fwd(f,'L')>=fwd(f+1,'L') and fwd(f,'L')>fwd(f-2,'L') and fwd(f,'L')>fwd(f+2,'L')]
def drift(c0):
 p0,p1=samples[c0]['pose'],samples[c0+period]['pose'];return max(p0[n][1].rotation_difference(p1[n][1]).angle for n in p0)
cands=[c for c in peaks if c+period<=end and c>=int(.3*FPS)]
if not cands and not os.environ.get('VESPER_CYCLE_FRAMES'):raise SystemExit(f'no usable stride; period {period}, peaks {peaks}')
if not cands:cands=[0]
c0=min(cands,key=lambda c:(round(drift(c),2),abs(c+period/2-end/2)));c1=c0+period
# VESPER_CYCLE_FRAMES=c0,c1 forces one stride when the autocorrelation picks a false period.
if os.environ.get('VESPER_CYCLE_FRAMES'):c0,c1=[int(v) for v in os.environ['VESPER_CYCLE_FRAMES'].split(',')];period=c1-c0
# VESPER_CYCLE_SECONDS resamples the stride to a faster cadence (slow reference performers);
# the belt speed scales with it so the runtime rate stays inside its clamp.
CYCLE=os.environ.get('VESPER_CYCLE_SECONDS');N=round(float(CYCLE)*FPS) if CYCLE else period
def pose_at(sf):
 f0=int(math.floor(sf));f1=min(f0+1,end);u=sf-f0;p0=samples[f0]['pose'];p1=samples[f1]['pose']
 return {n:(p0[n][0].lerp(p1[n][0],u),p0[n][1].slerp(p1[n][1],u),p0[n][2].lerp(p1[n][2],u)) for n in p0}
# Belt speed: the planted foot sweeps backward; take the median backward velocity of a low foot.
low=min(samples[f][side][0] for f in range(end+1) for side in 'LR');speeds=[]
for f in range(1,end+1):
 for side in 'LR':
  v=(fwd(f-1,side)-fwd(f,side))*FPS
  if samples[f][side][0]<low+.08 and v>.3:speeds.append(v)
# Instantaneous backward velocity dips at touchdown and toe-off; the 80th percentile tracks the belt.
speeds.sort();speed=(speeds[int(len(speeds)*.8)] if speeds else 0)*period/N
contacts=peaks
# Keep the pose at contact and remove drift linearly across the cycle so it loops.
footgroups={g.index for g in body.vertex_groups if any(n in g.name for n in ['Foot','ToeBase'])};footverts=[v.index for v in body.data.vertices if sum(g.weight for g in v.groups if g.group in footgroups)>.5]
start,last=samples[c0]['pose'],samples[c1]['pose'];corrected=[];lift=[]
def lowest_foot():
 ev=body.evaluated_get(bpy.context.evaluated_depsgraph_get());mesh=ev.to_mesh();zs=sorted((ev.matrix_world@mesh.vertices[i].co).z for i in footverts);ev.to_mesh_clear();return zs[int(len(zs)*.008)]
poses=[];lows=[]
for i in range(N+1):
 u=i/N;p=pose_at(c0+period*u)
 for n,(loc,q,scl)in p.items():
  l0,q0,s0=start[n];le,qe,se=last[n];fix=Quaternion().slerp(q0@qe.inverted(),u);b=bones[n];b.location=loc+(l0-le)*u;b.rotation_quaternion=fix@q;b.scale=scl+(s0-se)*u
 update();poses.append(snapshot());lows.append(lowest_foot())
# Plant the support frames on the floor and carry the hips correction smoothly across the
# flight frames, so the jog keeps its airborne phase instead of being flattened to the ground.
floor_z=min(lows);support=[z<floor_z+.025 for z in lows];planted=[-(z-.003) for z in lows];fix=[None]*(N+1)
idx=[i for i in range(N+1) if support[i]]
if not idx:raise SystemExit('no support frames in the chosen cycle')
for i in range(N+1):
 if support[i]:fix[i]=planted[i];continue
 prev=max((j for j in idx if j<i),default=None);nxt=min((j for j in idx if j>i),default=None)
 if prev is None:prev=max(idx)-(N+1)
 if nxt is None:nxt=min(idx)+(N+1)
 t=(i-prev)/(nxt-prev);fix[i]=planted[prev%(N+1)]*(1-t)+planted[nxt%(N+1)]*t
 fix[i]=max(fix[i],planted[i])# never let a swinging foot sink below the floor
# VESPER_SPINE_PITCH_DEGREES tilts the upper body about the pelvis' lateral axis (negative =
# straighten up), for captures whose camera perspective bends the torso forward.
SPINE_PITCH=math.radians(float(os.environ.get('VESPER_SPINE_PITCH_DEGREES','0')))
for i in range(N+1):
 restore(poses[i]);hm=wm('mixamorig:Hips');hm.translation.z+=fix[i];bones['mixamorig:Hips'].matrix=inv@hm;update();lift.append(fix[i])
 if abs(SPINE_PITCH)>1e-6:
  lateral=(wm('mixamorig:LeftUpLeg').translation-wm('mixamorig:RightUpLeg').translation).normalized();sm=wm('mixamorig:Spine');sp=sm.translation.copy()
  bones['mixamorig:Spine'].matrix=inv@(Matrix.Translation(sp)@Matrix.Rotation(SPINE_PITCH,4,lateral)@Matrix.Translation(-sp)@sm);update()
 bones['WeaponSocket'].matrix=inv@(wm('mixamorig:RightHand')@sw);bones['ShieldSocket'].matrix=inv@(wm('mixamorig:LeftHand')@sh);update()
 corrected.append(snapshot())
airborne=sum(1 for i in range(N+1) if lows[i]+fix[i]>.02)
new=bpy.data.actions.new('video-jog-'+TARGET);rig.animation_data.action=new;rig.animation_data.action_slot=new.slots[0] if len(new.slots) else None
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
meta.update({'asset':OUT+'.glb','revision':'video-locomotion-candidate-2026-09-15','previousCandidateSha256':meta['sha256'],'sha256':hashlib.sha256(open(dest+'.glb','rb').read()).hexdigest(),'reviewStatus':'candidate: '+TARGET+' replaced by a video-directed capture; studio review, gait audits and runtime playtest required'})
meta['clips'][TARGET]={'duration':N/FPS,'loop':True,'sourceSpeed':round(speed,3),'source':SOURCE+f'; one left-foot cycle, source frames {c0}-{c1} of {end}, linear end-drift removal, soles grounded through skinned foot vertices, sockets hand-relative'}
json.dump(meta,open(R+'/'+OUT+'-manifest.json','w'),indent=1)
json.dump({'raw':RAW,'rawClip':RAW_CLIP,'target':TARGET,'rawFrames':end+1,'leftFootPeaks':contacts,'stridePeriodFrames':period,'periodCorrelation':best,'cycle':[c0,c1],'cycleSeconds':N/FPS,'sourceCycleSeconds':period/FPS,'stanceSlideSpeed':speed,'restPoseError':rest_error,'cameraHeadingCorrectionDegrees':math.degrees(yaw_fix),'hipsLiftRange':[min(lift),max(lift)],'supportFrames':sum(support),'airborneFrames':airborne,'endpointDriftDegrees':max(start[n][1].rotation_difference(last[n][1]).angle*180/math.pi for n in start)},open(R+'/'+OUT+'-report.json','w'),indent=1)
print('GAIT_REPLACED',TARGET,'cycle',c0,c1,'seconds',N/FPS,'speed',round(speed,3),flush=True)
