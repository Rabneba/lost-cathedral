"""Reference-led combat revision. Preserve approved idle/gait and mesh.

Captured body motion drives the performance. Occluded source palms lose their
ordering, so the visible reference supplies a corrected weapon arc. Scythe axial
roll is independent of hand rotation. Export remains a candidate until anatomy,
weapon clearance and target coverage have been reviewed.
"""
import bpy, os, math, json, sys
import numpy as np
from mathutils import Vector, Matrix, Quaternion
from mathutils.bvhtree import BVHTree
sys.path.insert(0,os.path.dirname(__file__))
from boss_grip_constraints import search_grip_targets, shaft_clearance, transported_previous_proposal
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'))
RUN_TAG=os.environ.get('VESPER_GRIP_RUN_TAG','')
OUT=os.path.join(ROOT,'assets/combat-revision/boss',RUN_TAG) if RUN_TAG else os.path.join(ROOT,'assets/combat-revision/boss')
os.makedirs(OUT,exist_ok=True)
FPS=30
SPATIAL=os.environ.get('VESPER_GRIP_PASS')=='spatial'
BACKWARD=os.environ.get('VESPER_GRIP_PASS')=='backward'
SEED_PATH=os.environ.get('VESPER_GRIP_SEED_REPORT','')
SEEDS=json.load(open(SEED_PATH)) if SEED_PATH else {}

def context():
 global scene,rig,body,bones,inv
 scene=bpy.context.scene;scene.render.fps=FPS
 rig=next(o for o in scene.objects if o.type=='ARMATURE')
 body=next(o for o in scene.objects if o.type=='MESH' and any(m.type=='ARMATURE' for m in o.modifiers))
 bones=rig.pose.bones;inv=rig.matrix_world.inverted()
def B(n):return bones['mixamorig:'+n]
def update():bpy.context.view_layer.update()
def world(p):return rig.matrix_world@p.matrix
def pos(p):return world(p).translation.copy()
def grab():return {p.name:p.matrix_basis.copy() for p in bones}
def apply(pose):
 for n,m in pose.items():bones[n].matrix_basis=m.copy()
 update()
def mix(a,b,t):return {n:a[n].lerp(b[n],t) for n in a}
def setworld(p,m):p.matrix=inv@m;update()
def rotate(p,q):
 m=world(p);v=m.translation.copy()
 setworld(p,Matrix.Translation(v)@q.to_matrix().to_4x4()@Matrix.Translation(-v)@m)
def aim(p,child,target):
 a=pos(child)-pos(p);b=target-pos(p)
 if min(a.length,b.length)>1e-6:rotate(p,a.normalized().rotation_difference(b.normalized()))
def chain(side,target,pole,shaft=None,previous=None):
 a,b,c=[B(side+n) for n in ['Arm','ForeArm','Hand']]
 s,e,w=pos(a),pos(b),pos(c);l1,l2=(e-s).length,(w-e).length
 axis=(target-s).normalized();d=max(abs(l1-l2)+.002,min((target-s).length,l1+l2-.008))
 along=(l1*l1-l2*l2+d*d)/(2*d);h=math.sqrt(max(0,l1*l1-along*along))
 bend=pole-s;bend-=axis*bend.dot(axis)
 if bend.length<.0001:bend=Vector((1,0,0)).cross(axis)
 bend.normalize()
 if shaft is not None and h>.0001:
  # Select a reachable elbow plane with a straight wrist. Stay as close as
  # possible to the captured elbow, instead of throwing all error at the hand.
  tangent=axis.cross(bend).normalized();best=None
  for degrees in range(-180,181,2):
   theta=math.radians(degrees);direction=bend*math.cos(theta)+tangent*math.sin(theta)
   elbow=s+axis*along+direction*h;forearm=(target-elbow).normalized()
   wristbend=math.asin(min(1,abs(forearm.dot(shaft))))
   cost=(elbow-pole).length_squared+3*max(0,wristbend-math.radians(32))**2
   if previous is not None:cost+=8*(elbow-previous).length_squared
   if best is None or cost<best[0]:best=(cost,elbow)
  elbow=best[1]
 else:elbow=s+axis*along+bend*h
 aim(a,b,elbow);aim(b,c,target)
def smooth(t):t=max(0,min(1,t));return t*t*(3-2*t)
def shaft_frame(axis,blade):
 axis.normalize();blade-=axis*blade.dot(axis);blade.normalize()
 return Matrix((blade,axis.cross(blade).normalized(),axis)).transposed().to_quaternion()
def reference_weapon_rotation(name,t):
 if name=='sweep':
  wind=smooth(t/.85);cut=smooth((t-1.65)/1.15);recover=smooth((t-3.0)/2.55)
  az=-2.65+1.90*cut;axis=Vector((math.cos(az),math.sin(az),-.13*cut))
  blade=Vector((-math.sin(az)*.34,math.cos(az)*.34,-.94))
 else:
  wind=smooth(t/1.55);cut=smooth((t-2.0)/.8);recover=smooth((t-3.7)/1.9)
  angle=.9-2.95*cut;axis=Vector((0,math.sin(angle),math.cos(angle)))
  blade=Vector((0,-math.cos(angle),math.sin(angle)))
 attack=shaft_frame(axis,blade)
 if name=='slam':attack=Quaternion((0,0,1),-.26)@attack
 return ref_weapon.to_quaternion().slerp(attack,wind).slerp(ref_weapon.to_quaternion(),recover)
def grip(side):
 ps=[pos(B(side+'Hand'+d+str(j))) for d in ['Index','Middle','Ring','Pinky'] for j in [1,3]]
 return sum(ps,Vector())*(.8/len(ps))+pos(B(side+'HandThumb3'))*.2
def sample_tracks(names):
 rig.animation_data.action=None;tracks=list(rig.animation_data.nla_tracks);result={}
 for t in tracks:
  if t.name not in names:continue
  for other in tracks:other.mute=other!=t
  strip=t.strips[0];result[t.name]=[]
  for f in range(round(strip.frame_end-strip.frame_start)+1):
   scene.frame_set(round(strip.frame_start)+f);update();result[t.name].append(grab())
 for t in tracks:t.mute=True
 rig.animation_data.action=None
 return result

bpy.ops.wm.open_mainfile(filepath=os.path.join(ROOT,'assets/boss-essential-motion/boss-sources.blend'));context()
sources=sample_tracks(['source-sweep','source-slam'])
bpy.ops.wm.open_mainfile(filepath=os.path.join(ROOT,'assets/production/boss-essential.blend'));context()
idle=sample_tracks(['idle'])['idle'];apply(idle[0])
ref_weapon=world(bones['WeaponSocket']).copy()
local_axis={s:world(B(s+'Hand')).to_quaternion().inverted()@(ref_weapon.to_quaternion()@Vector((0,0,1))) for s in ['Right','Left']}
local_grip={s:world(B(s+'Hand')).to_quaternion().inverted()@(grip(s)-pos(B(s+'Hand'))) for s in local_axis}
# Measured metacarpal frame: knuckle span and wrist-to-middle-finger direction.
# Unlike an equipment-relative quaternion this has anatomical meaning.
hand_axes={'Left':((- .696083,-.023369,-.717581),(.004639,.999303,-.037043)),
           'Right':((.772122,-.020369,-.635147),(.008849,.999734,-.021304))}
hand_frame={}
forearm_normal={}
grip_coefficients={}
idle_hand_across={}
idle_bend_plane={}
for side,(across,longitudinal) in hand_axes.items():
 a=Vector(across).normalized();l=Vector(longitudinal);l=(l-a*l.dot(a)).normalized()
 hand_frame[side]=Matrix((a,l,a.cross(l).normalized())).transposed().to_quaternion()
 grip_coefficients[side]=hand_frame[side].inverted()@local_grip[side]
 idle_hand_across[side]=world(B(side+'Hand')).to_quaternion()@a
 f=(pos(B(side+'Hand'))-pos(B(side+'ForeArm'))).normalized();hq=world(B(side+'Hand')).to_quaternion()
 gamma=math.atan2(f.dot(hq@a.cross(l)),f.dot(hq@a))
 if gamma>math.pi/2:gamma-=math.pi
 if gamma< -math.pi/2:gamma+=math.pi
 idle_bend_plane[side]=math.degrees(gamma)
 rest_relative=B(side+'ForeArm').bone.matrix_local.to_quaternion().inverted()@B(side+'Hand').bone.matrix_local.to_quaternion()
 forearm_normal[side]=rest_relative@(a.cross(l).normalized())
def anatomical_hand(side,shaft,sign):
 across=shaft*sign;longitudinal=(pos(B(side+'Hand'))-pos(B(side+'ForeArm'))).normalized()
 longitudinal-=across*longitudinal.dot(across)
 if longitudinal.length<.00001:longitudinal=Vector((0,0,1)).cross(across)
 longitudinal.normalize()
 return Matrix((across,longitudinal,across.cross(longitudinal).normalized())).transposed().to_quaternion()@hand_frame[side].inverted()
finger_names=[p.name for p in bones if any(d in p.name for d in ['Thumb','Index','Middle','Ring','Pinky'])]
foot_indices={}
for side in local_axis:
 ids={g.index for g in body.vertex_groups if side+'Foot' in g.name or side+'ToeBase' in g.name}
 foot_indices[side]=[v.index for v in body.data.vertices if sum(g.weight for g in v.groups if g.group in ids)>.6]
def sole_height():
 ev=body.evaluated_get(bpy.context.evaluated_depsgraph_get())
 return min((body.matrix_world@ev.data.vertices[i].co).z for indices in foot_indices.values() for i in indices)

groups={g.index:g.name for g in body.vertex_groups}
regions={'hood':{'mixamorig:Head','mixamorig:Neck'},'torso':{'mixamorig:Hips','mixamorig:Spine','mixamorig:Spine1','mixamorig:Spine2'}}
mask={name:{v.index for v in body.data.vertices if sum(g.weight for g in v.groups if groups[g.group]in names)>.25}for name,names in regions.items()}
region_polygons={name:[list(p.vertices)for p in body.data.polygons if any(i in ids for i in p.vertices)]for name,ids in mask.items()}
shaft_sections=[(Vector(c),r) for c,r in json.load(open(os.path.join(ROOT,'docs/combat-revision/boss-shaft-clearance-v6.json')))['shaftSections']]
def body_trees():
 ev=body.evaluated_get(bpy.context.evaluated_depsgraph_get());vertices=[body.matrix_world@v.co for v in ev.data.vertices]
 return {n:BVHTree.FromPolygons(vertices,p,all_triangles=False)for n,p in region_polygons.items()}

def constrained_grips(center,q,spacing,rear,arms,previous,previous_reference,frame,clip):
 # A fixed proposal cloud transported along the reference arc avoids fresh
 # random noise per frame. Exact arms reject impossible targets, rather than
 # bending a wrist or allowing a grip to drift to make the pose fit.
 trees=body_trees();proposals=[(center,q,spacing)]
 seed_center,seed_q,seed_spacing=center,q,spacing
 if previous:
  seed_center,seed_q,seed_spacing=transported_previous_proposal(center,q,*previous_reference,previous)
  proposals.extend([(seed_center,seed_q,seed_spacing),(previous['center'],previous['quaternion'],previous['spacing'])])
 if clip in SEEDS:
  seeded=SEEDS[clip]['samples'][frame]
  proposals.append((Vector(seeded['center']),Quaternion(seeded['weaponQuaternion']),seeded['spacing']))
  # A fixed full-curve seed can prepare the hand configuration before a
  # bottleneck; transport nearby future/past corrections onto this reference.
  for offset in [-6,-3,3,6]:
   other=SEEDS[clip]['samples'][max(0,min(len(SEEDS[clip]['samples'])-1,frame+offset))]
   correction=Vector(other['center'])-Vector(other['referenceCenter'])
   delta=Quaternion(other['referenceQuaternion']).inverted()@Quaternion(other['weaponQuaternion'])
   proposals.append((center+correction,q@delta,other['spacing']))
 for space in [.28,.34,.40,.46,spacing]:proposals.extend([(center,q,space),(seed_center,seed_q,space)])
 rng=np.random.default_rng(30114)
 axis=q@Vector((0,0,1));side=axis.cross(Vector((0,0,1)))
 if side.length<.05:side=axis.cross(Vector((1,0,0)))
 side.normalize();other=axis.cross(side).normalized()
 def candidates(count,spread,angular=.23):
  for i in range(count):
   around=seed_center if i%2 else center;orientation=seed_q if i%2 else q
   shift=Vector(rng.normal(0,spread,3));angles=rng.uniform(-angular,angular,2)
   candidate_q=Quaternion(side,float(angles[0]))@Quaternion(other,float(angles[1]))@orientation
   yield around+shift,candidate_q,float(rng.uniform(.20,.50))
 test=lambda C,Q,S:shaft_clearance(C,Q,S,rear,trees,shaft_sections,minimum_gap=.015)
 def bounded(proposals,temporal=True):
  for C,Q,S in proposals:
   angle=q.rotation_difference(Q).angle;angle=min(angle,2*math.pi-angle)
   if (C-center).length>.24 or angle>.36 or not .20<=S<=spacing+.04:continue
   if previous and temporal:
    turn=previous['quaternion'].rotation_difference(Q).angle;turn=min(turn,2*math.pi-turn)
    if (C-previous['center']).length>.085 or turn>.22:continue
   yield C,Q,S
 proposals.extend(candidates(350,.025,.065));proposals.extend(candidates(700,.075))
 # The actual stroke rotates the whole hand faster than breathing/recovery.
 # Keep wrist flexion change bounded while allowing that coherent arm motion.
 hand_step=18 if 50<=frame<=92 else 12
 limits={} if SPATIAL else {'maximum_elbow_step':.079,'maximum_hand_angle_step':hand_step,'maximum_bend_step_degrees':5}
 result=search_grip_targets(center,q,spacing,arms,test,bounded(proposals,not SPATIAL),previous,**limits)
 if result is None:result=search_grip_targets(center,q,spacing,arms,test,bounded(candidates(5000,.14),not SPATIAL),previous,**limits)
 if result is None:
  probes=list(candidates(9000,.12))
  for label,elbow,hand,bend,temporal in [('hand18',.079,18,5,True),('no-hand',.079,None,5,True),('no-bend',.079,12,None,True),('no-elbow',None,12,5,True),('no-temporal',None,None,None,False)]:
   diagnostic=search_grip_targets(center,q,spacing,arms,test,bounded(probes,temporal),previous,maximum_elbow_step=elbow,maximum_hand_angle_step=hand,maximum_bend_step_degrees=bend)
   print('BINDING',frame,label,'feasible',diagnostic is not None,flush=True)
  raise RuntimeError('No clear, anatomically feasible grip at frame '+str(frame))
 return result

reports={};candidates={}
for name,frames in sources.items():
 name=name.replace('source-','');poses=[None]*len(frames);samples=[None]*len(frames);lastq=None;signs={};previous_elbows={};previous_result=None;previous_reference=None
 frame_order=range(len(frames)-1,-1,-1) if BACKWARD else range(len(frames))
 for f in frame_order:
  raw=frames[f]
  filtered=mix(mix(frames[max(0,f-1)],frames[min(len(frames)-1,f+1)],.5),raw,.5)
  apply(filtered)
  hip=world(B('Hips'));hip.translation.x=0;hip.translation.y=0;setworld(B('Hips'),hip)
  rotate(B('Hips'),Quaternion((0,0,1),math.radians(-50)))
  pitch=(pos(B('LeftUpLeg'))-pos(B('RightUpLeg'))).normalized()
  for joint,degrees in [('Spine',-18),('Spine1',-6),('Neck',-12)]:rotate(B(joint),Quaternion(pitch,math.radians(degrees)))
  hip=world(B('Hips'));hip.translation.z-=sole_height();setworld(B('Hips'),hip)
  source_weight=smooth(f/18)*(1-smooth((f-(len(frames)-31))/30))
  apply(mix(idle[0],grab(),source_weight))
  # Interpolated joint rotations need their own ground solve, even when both
  # endpoint poses have a planted boot. Do this before computing the grips.
  hip=world(B('Hips'));hip.translation.z-=sole_height();setworld(B('Hips'),hip)
  for n in finger_names:bones[n].matrix_basis=idle[0][n].copy()
  update()
  original={s:{'q':world(B(s+'Hand')).to_quaternion(),'wrist':pos(B(s+'Hand')),'elbow':pos(B(s+'ForeArm')),'grip':grip(s)} for s in local_axis}
  q=reference_weapon_rotation(name,f/FPS)
  axis=q@Vector((0,0,1))
  # Keep each captured hand's closest possible orientation about the shaft.
  # Prop blade roll below never contributes to these rotations.
  for s in local_axis:
   if s not in signs:
    signs[s]=min([1,-1],key=lambda sign:original[s]['q'].rotation_difference(anatomical_hand(s,axis,sign)).angle)
  handq={s:anatomical_hand(s,axis,signs[s]) for s in local_axis}
  center=(original['Left']['grip']+original['Right']['grip'])*.5
  # Video tracking loses the hand separation/order when the hands overlap.
  # The actual reference shaft arc above resolves that ambiguity. Keep its
  # center with the captured body but outside the armor, with humane reach.
  across=pos(B('LeftArm'))-pos(B('RightArm'));across.z=0;across.normalize()
  forward=across.cross(Vector((0,0,1))).normalized();chest=pos(B('Spine2'))
  if name=='slam':
   carry=chest+forward*.44+across*.28
   carry.z=chest.z+max(-.20,min(.65,center.z-chest.z))
  else:
   carry=chest+forward*.50+across*(.28*abs(axis.dot(forward))**4)
   carry.z=chest.z+max(-.22,min(.28,center.z-chest.z))
  center=center.lerp(carry,source_weight)
  spacing=.95+(.40-.95)*source_weight
  # Slide the grip toward the butt while attacking. The surplus rear handle
  # previously passed through armor even with healthy arms.
  rear=.6+(.04-.6)*source_weight
  arms={s:{'shoulder':pos(B(s+'Arm')),
   'upper_length':(pos(B(s+'ForeArm'))-pos(B(s+'Arm'))).length,
   'forearm_length':(pos(B(s+'Hand'))-pos(B(s+'ForeArm'))).length,
   'grip_coefficients':grip_coefficients[s],
   'captured_elbow':original[s]['elbow'],'captured_wrist':original[s]['wrist'],
   'captured_long':original[s]['q']@(hand_frame[s]@Vector((0,1,0))),
   'captured_normal':original[s]['q']@(hand_frame[s]@Vector((0,0,1))),
   'across_reference_axis':ref_weapon.to_quaternion()@Vector((0,0,1)),
   'across_reference':idle_hand_across[s],'across_weight':source_weight,
   'bend_plane_degrees':idle_bend_plane[s]*(1-source_weight),
   'across_sign':signs[s]} for s in local_axis}
  reference=(center.copy(),q.copy())
  result=constrained_grips(center,q,spacing,rear,arms,previous_result,previous_reference,f,name)
  center,q,axis,spacing=result['center'],result['quaternion'],result['axis'],result['spacing']
  previous_result=result;previous_reference=reference
  anchors={'Right':rear,'Left':rear+spacing}
  targets={s:center+axis*(z-sum(anchors.values())*.5)for s,z in anchors.items()}
  handq={}
  for s,sol in result['hands'].items():
   handq[s]=Matrix((sol['across'],sol['long'],sol['normal'])).transposed().to_quaternion()@hand_frame[s].inverted()
   aim(B(s+'Arm'),B(s+'ForeArm'),sol['elbow']);aim(B(s+'ForeArm'),B(s+'Hand'),sol['wrist'])
   hm=world(B(s+'Hand'));setworld(B(s+'Hand'),Matrix.LocRotScale(hm.translation,handq[s],hm.to_scale()))
  for s in local_axis:
   # Share axial pronation with the forearm. Position-only IK preserves a
   # stale forearm roll, otherwise the wrist seam absorbs every turn.
   fore=B(s+'ForeArm');roll_axis=(pos(B(s+'Hand'))-pos(fore)).normalized()
   a=world(fore).to_quaternion()@forearm_normal[s]
   b=handq[s]@(hand_frame[s]@Vector((0,0,1)))
   a-=roll_axis*a.dot(roll_axis);b-=roll_axis*b.dot(roll_axis)
   if min(a.length,b.length)>.0001:
    a.normalize();b.normalize();angle=math.atan2(roll_axis.dot(a.cross(b)),a.dot(b))
    hm=world(B(s+'Hand')).copy();rotate(fore,Quaternion(roll_axis,angle*source_weight));setworld(B(s+'Hand'),hm)
  previous_elbows={s:pos(B(s+'ForeArm')) for s in local_axis}
  if lastq and lastq.dot(q)<0:q.negate()
  lastq=q.copy()
  wm=Matrix.LocRotScale(center-axis*sum(anchors.values())*.5,q,Vector((1,1,1)))
  setworld(bones['WeaponSocket'],wm)
  if f==0 or f==len(frames)-1:
   apply(idle[0]);previous_result['quaternion']=ref_weapon.to_quaternion()
   previous_result['center']=(grip('Left')+grip('Right'))*.5
   for s in local_axis:
    hq=world(B(s+'Hand')).to_quaternion();frameq=hq@hand_frame[s]
    previous_result['hands'][s].update({'elbow':pos(B(s+'ForeArm')),'wrist':pos(B(s+'Hand')),
     'across':frameq@Vector((1,0,0)),'long':frameq@Vector((0,1,0)),'normal':frameq@Vector((0,0,1))})
  samples[f]={'t':f/FPS,'spacing':spacing,'shaft':list(axis),'center':list(center),
   'weaponQuaternion':list(q),'rearAnchor':rear,
   'referenceCenter':list(reference[0]),'referenceShaft':list(reference[1]@Vector((0,0,1))),
   'referenceQuaternion':list(reference[1]),
   'referenceAngleCorrection':math.degrees(reference[1].rotation_difference(q).angle),
   'gripError':max((grip(s)-targets[s]).length for s in local_axis),
   'wristCorrectionDegrees':{s:math.degrees(original[s]['q'].rotation_difference(handq[s]).angle) for s in local_axis},
   'wristShift':{s:(pos(B(s+'Hand'))-original[s]['wrist']).length for s in local_axis}}
  poses[f]=grab()
  if f%15==0:print('SOLVED',name,f,'gap',result['minimumShaftSurfaceGap'],'grip',samples[f]['gripError'],flush=True)
 # Preserve source speed for diagnosis. No new anticipation/strike timing
 # until the actual extracted performance has been inspected.
 candidates[name]=poses;reports[name]={'sourceDuration':(len(poses)-1)/FPS,'samples':samples}
 for t in list(rig.animation_data.nla_tracks):
  if t.name==name:rig.animation_data.nla_tracks.remove(t)
 action=bpy.data.actions.new('combat-revision-'+name);rig.animation_data.action=action;previous={}
 for f,pose in enumerate(poses):
  for n,m in pose.items():
   p=bones[n];loc,q,sc=m.decompose()
   if n in previous and previous[n].dot(q)<0:q.negate()
   previous[n]=q.copy();p.location=loc;p.rotation_quaternion=q;p.scale=sc
   for channel in ['location','rotation_quaternion','scale']:p.keyframe_insert(channel,frame=f)
 rig.animation_data.action=None;t=rig.animation_data.nla_tracks.new();t.name=name;t.strips.new(name,0,action);t.mute=True
 print('CANDIDATE',name,len(poses),'maximum grip error',max(s['gripError'] for s in samples),flush=True)

apply(idle[0]);scene.frame_start=0;scene.frame_end=788;scene.frame_set(0);update()
bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);body.select_set(True);bpy.context.view_layer.objects.active=rig
for o in scene.objects:
 if o not in [rig,body]:o.hide_render=True
for t in rig.animation_data.nla_tracks:t.mute=False
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT,'boss-combat-candidate.blend'))
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT,'boss-combat-candidate.glb'),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='NLA_TRACKS',export_nla_strips=True,export_frame_range=False,export_force_sampling=True,export_def_bones=False)
REPORT_PATH=os.path.join(ROOT,'docs/combat-revision/boss-candidate-bake-'+RUN_TAG+'.json') if RUN_TAG else os.path.join(ROOT,'docs/combat-revision/boss-candidate-anatomy.json')
json.dump(reports,open(REPORT_PATH,'w'),indent=2)
print('CANDIDATE_READY',flush=True)
