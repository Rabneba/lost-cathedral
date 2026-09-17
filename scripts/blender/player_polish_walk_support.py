"""Derivative only: one clean captured run cycle with explicit flat support and clear swing.
Keep pelvis/chest/arms, equipment hierarchy, geometry, and all timing metadata.
"""
import bpy,os,json,math,shutil
from mathutils import Matrix,Vector,Quaternion
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'))
for ext in ['glb','blend']:
 dst=ROOT+'/assets/player-essential-motion/player-before-material-contact-refinement.'+ext
 if not os.path.exists(dst):shutil.copy2(ROOT+'/assets/production/player-essential.'+ext,dst)
bpy.ops.wm.open_mainfile(filepath=ROOT+'/assets/player-essential-motion/player-all-run-support-study.blend')
scene=bpy.context.scene;rig=next(o for o in scene.objects if o.type=='ARMATURE');body=next(o for o in scene.objects if o.type=='MESH'and not o.hide_render);bones=rig.pose.bones;inv=rig.matrix_world.inverted()
for tr in rig.animation_data.nla_tracks:tr.mute=True
track=next(tr for tr in rig.animation_data.nla_tracks if tr.name=='run-forward');action=track.strips[0].action;meta=json.load(open(ROOT+'/docs/player-essential-manifest.json'));speed=meta['clips']['run-forward']['sourceSpeed'];period=.6;support=.2;endframe=36

def update():bpy.context.view_layer.update()
def B(n):return bones['mixamorig:'+n]
def wm(b):return rig.matrix_world@b.matrix
def snapshot():return{b.name:(b.location.copy(),b.rotation_quaternion.copy(),b.scale.copy())for b in bones}
def restore(p):
 rig.animation_data.action=None
 for n,(l,q,s)in p.items():b=bones[n];b.location=l;b.rotation_quaternion=q;b.scale=s
 update()
def pose(f):
 rig.animation_data.action=action;rig.animation_data.action_slot=action.slots[0];scene.frame_set(int(f),subframe=f-int(f));update();p=snapshot();restore(p);return p

def setworld(b,m):b.matrix=inv@m;update()
def rotateworld(b,q):
 m=wm(b);setworld(b,Matrix.LocRotScale(m.translation,q@m.to_quaternion(),m.to_scale()))
def aim(a,b,p):
 o=wm(a).translation;v=wm(b).translation-o;target=p-o
 if min(v.length,target.length)>1e-6:rotateworld(a,v.normalized().rotation_difference(target.normalized()))
def solve(side,target):
 a,b,c=B(side+'UpLeg'),B(side+'Leg'),B(side+'Foot');pa,pb,pc=[wm(v).translation for v in [a,b,c]];l1=(pb-pa).length;l2=(pc-pb).length;axis=(target-pa).normalized();d=max(abs(l1-l2)+.00001,min((target-pa).length,l1+l2-.00001));along=(l1*l1+d*d-l2*l2)/(2*d);height=math.sqrt(max(0,l1*l1-along*along));plane=Vector((target.x,-1.4,.55))-pa;plane=(plane-axis*plane.dot(axis)).normalized();bend=pa+axis*along+plane*height;aim(a,b,bend);aim(b,c,target)

def footmatrix(side,q):
 m=wm(B(side+'Foot'));setworld(B(side+'Foot'),Matrix.LocRotScale(m.translation,q,m.to_scale()))
sets={}
for side in ['Left','Right']:
 groups={g.index for g in body.vertex_groups if side in g.name and any(x in g.name for x in ['Foot','ToeBase'])};sets[side]=[v.index for v in body.data.vertices if sum(g.weight for g in v.groups if g.group in groups)>.5]
def sole(side):
 ev=body.evaluated_get(bpy.context.evaluated_depsgraph_get());mesh=ev.to_mesh();v=sorted((ev.matrix_world@mesh.vertices[i].co).z for i in sets[side]);ev.to_mesh_clear();return v[0]


# Current forward clip at zero contains the canonical flat boot orientation for
# each side (the right boot is elevated but has zero swing pitch at mid-swing).
pose(0);flat={}
for side in ['Left','Right']:
 fm=wm(B(side+'Foot'));flat[side]={'rotation':fm.to_quaternion(),'height':fm.translation.z-sole(side)+.003,'toe':B(side+'ToeBase').rotation_quaternion.copy()}
sources={tr.name:tr.strips[0].action.copy()for tr in rig.animation_data.nla_tracks if tr.name.startswith('walk-')}
tracks={tr.name:tr for tr in rig.animation_data.nla_tracks};allReports={}
for name in sources:
 targetAction=tracks[name].strips[0].action
 # The provider's lateral labels use the opposite X convention. Preserve the
 # runtime's anatomical-left +X contract by choosing the matching torso source.
 sourceName=name.replace('left','RIGHT').replace('right','left').replace('RIGHT','right')
 action=sources[sourceName];endframe=round(targetAction.frame_range[1]);half=endframe/2;period=half/30;duration=endframe/30;support=period*.56;speed=meta['clips'][name]['sourceSpeed']
 movement=Vector((1 if 'left'in name else -1 if 'right'in name else 0,-1 if 'forward'in name else 1 if 'back'in name else 0,0)).normalized();opposite=-movement;pitchAxis=Vector((0,0,1)).cross(movement).normalized()
 sourceDuration=action.frame_range[1]/30;sourcePeriod=sourceDuration/2;candidates=[]
 for i in range(half.__ceil__()+1):
  t=sourcePeriod*i/half.__ceil__();pose(t*30);right=sole('Right');left=sole('Left');candidates.append((right<.035 and left>.025,wm(B('RightFoot')).translation.z,t))
 eligible=[x for x in candidates if x[0]] or candidates;flatTime=min(eligible,key=lambda x:x[1])[2];sourceStart=flatTime-sourcePeriod*.28
 def body_at(u):return pose(((sourceStart+u*sourcePeriod)%sourceDuration)*30)
 start=body_at(0);last=body_at(1);raw=[]
 for f in range(endframe+1):
  u=(f/half+.78)%1;p=body_at(u)
  for boneName,(loc,q,scl)in p.items():
   loc+=(start[boneName][0]-last[boneName][0])*u;correction=start[boneName][1]@last[boneName][1].inverted();p[boneName]=(loc,Quaternion().slerp(correction,u)@q,scl)
  raw.append(p)
 samples=[];report=[];drop=.18 if name=='walk-forward-left'else .14
 for f in range(endframe+1):
  phase=((f/half+.78)%1)*period;restore(raw[f]);hip=wm(B('Hips'));hip.translation.z-=drop;setworld(B('Hips'),hip);data={}
  for side,offset in [('Right',0),('Left',period/2)]:
   u=(phase-offset)%period;stance=u<support;fl=flat[side]
   if stance:travel=speed*(u-support/2);lift=0;pitch=0
   else:
    v=(u-support)/(period-support);d=period-support;back=speed*support/2;front=-back
    travel=(2*v**3-3*v*v+1)*back+(v**3-2*v*v+v)*speed*d+(-2*v**3+3*v*v)*front+(v**3-v*v)*speed*d
    lift=.055*math.sin(math.pi*v)**1.4;pitch=math.radians(8)*math.sin(2*math.pi*v)*math.sin(math.pi*v)
   sign=1 if side=='Left'else-1;center=Vector((sign*(.07+.14*abs(movement.x)),-sign*.1*abs(movement.x),fl['height']+lift));target=center+opposite*travel
   q=Quaternion(pitchAxis,pitch)@fl['rotation'];B(side+'ToeBase').rotation_quaternion=fl['toe'].copy();update();solve(side,target);footmatrix(side,q)
   for repeat in range(2):
    error=.003+lift-sole(side)
    if abs(error)<.00003:break
    target=wm(B(side+'Foot')).translation;target.z+=error;solve(side,target);footmatrix(side,q)
   a,b,c=[wm(B(side+x)).translation for x in ['UpLeg','Leg','Foot']];flex=(b-a).angle(c-b)*180/math.pi
   data[side]={'stance':stance,'sole':sole(side),'flexion':flex,'ankle':list(c)}
  samples.append(snapshot());report.append({'frame':f,'feet':data})
 samples[-1]={n:(l.copy(),q.copy(),s.copy())for n,(l,q,s)in samples[0].items()}
 rig.animation_data.action=targetAction;rig.animation_data.action_slot=targetAction.slots[0];prev={}
 for f,p in enumerate(samples):
  for boneName,(l,q,scl)in p.items():
   if boneName in prev and prev[boneName].dot(q)<0:q.negate()
   prev[boneName]=q.copy();b=bones[boneName];b.location=l;b.rotation_quaternion=q;b.scale=scl;b.keyframe_insert('location',frame=f);b.keyframe_insert('rotation_quaternion',frame=f);b.keyframe_insert('scale',frame=f)
 rig.animation_data.action=None
 allReports[name]={'sourceTorso':sourceName,'sourceCycle':[sourceStart,sourceStart+sourcePeriod],'duration':duration,'period':period,'phaseOffset':.78,'speed':speed,'pelvisDrop':drop,'movement':list(movement),'minKneeFlexion':min(x['feet'][s]['flexion']for x in report for s in ['Left','Right']),'maxKneeFlexion':max(x['feet'][s]['flexion']for x in report for s in ['Left','Right']),'frames':report}
 print('DIRECTION POLISHED',name,allReports[name]['minKneeFlexion'],allReports[name]['maxKneeFlexion'],flush=True)
rig.animation_data.action=None
for b in bones:b.matrix_basis.identity()
for tr in rig.animation_data.nla_tracks:tr.mute=False
bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);body.select_set(True);bpy.context.view_layer.objects.active=rig
bpy.ops.wm.save_as_mainfile(filepath=ROOT+'/assets/player-essential-motion/player-sixteen-gait-support-study.blend')
bpy.ops.export_scene.gltf(filepath=ROOT+'/assets/player-essential-motion/player-sixteen-gait-support-study.glb',export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='NLA_TRACKS',export_nla_strips=True,export_frame_range=False,export_force_sampling=True,export_def_bones=False)
json.dump(allReports,open(ROOT+'/docs/player-all-walk-support-study.json','w'),indent=2)
print('SIXTEEN GAIT SUPPORT DERIVATIVE READY',flush=True)
