"""Derivative only: one clean captured run cycle with explicit flat support and clear swing.
Keep pelvis/chest/arms, equipment hierarchy, geometry, and all timing metadata.
"""
import bpy,os,json,math,shutil
from mathutils import Matrix,Vector,Quaternion
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'))
for ext in ['glb','blend']:
 dst=ROOT+'/assets/player-essential-motion/player-before-material-contact-refinement.'+ext
 if not os.path.exists(dst):shutil.copy2(ROOT+'/assets/production/player-essential.'+ext,dst)
bpy.ops.wm.open_mainfile(filepath=ROOT+'/assets/player-essential-motion/player-before-material-contact-refinement.blend')
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

# Capture torso motion from the first useful complete gait cycle; no held tail.
raw=[]
for f in range(19):raw.append(pose((.16+period*f/18)*30))
start,last=raw[0],raw[-1]
for f,p in enumerate(raw):
 u=f/18
 for name,(loc,q,scl)in p.items():
  loc+=(start[name][0]-last[name][0])*u
  correction=start[name][1]@last[name][1].inverted();q2=Quaternion().slerp(correction,u)@q;p[name]=(loc,q2,scl)
raw[-1]={n:(l.copy(),q.copy(),s.copy())for n,(l,q,s)in raw[0].items()}
flat={}
for side,time in [('Right',.225),('Left',.50)]:
 pose(time*30);fm=wm(B(side+'Foot'));height=fm.translation.z-sole(side)+.003
 flat[side]={'rotation':fm.to_quaternion(),'height':height,'toe':B(side+'ToeBase').rotation_quaternion.copy(),'x':fm.translation.x}

samples=[];report=[]
for f in range(endframe+1):
 t=f/30;phase=t%period;index=f%18;restore(raw[index]);hip=wm(B('Hips'));hip.translation.z-=.085;setworld(B('Hips'),hip);data={}
 for side,offset in [('Right',0),('Left',.3)]:
  u=(phase-offset)%period;stance=u<support
  sourceq=wm(B(side+'Foot')).to_quaternion();sourceToe=B(side+'ToeBase').rotation_quaternion.copy();fl=flat[side]
  if stance:
   y=speed*(u-support/2);lift=0;blend=0
  else:
   v=(u-support)/(period-support);d=period-support;back=speed*support/2;front=-back
   y=(2*v**3-3*v*v+1)*back+(v**3-2*v*v+v)*speed*d+(-2*v**3+3*v*v)*front+(v**3-v*v)*speed*d
   lift=.16*math.sin(math.pi*v)**1.4;blend=math.sin(math.pi*v)**2
  pitch=0 if stance else math.radians(18)*math.sin(2*math.pi*v)*math.sin(math.pi*v)
  q=Quaternion((1,0,0),pitch)@fl['rotation'];B(side+'ToeBase').rotation_quaternion=fl['toe'].copy();update()
  target=Vector((fl['x'],y,fl['height']+lift));solve(side,target);footmatrix(side,q)
  # Target actual boot sole height, not an ankle-height proxy. Keep hips unchanged.
  for repeat in range(2):
   error=.003+lift-sole(side)
   if abs(error)<.00003:break
   target=wm(B(side+'Foot')).translation;target.z+=error;solve(side,target);footmatrix(side,q)
  data[side]={'stance':stance,'phase':u,'targetLift':lift,'actualSole':sole(side),'ankle':list(wm(B(side+'Foot')).translation)}
 samples.append(snapshot());report.append({'frame':f,'feet':data})
# Preserve the previous gait's left-support / right-swing initial phase.
samples=[samples[(f+12)%18]for f in range(endframe+1)]
samples[-1]={n:(l.copy(),q.copy(),s.copy())for n,(l,q,s)in samples[0].items()}
rig.animation_data.action=action;rig.animation_data.action_slot=action.slots[0];prev={}
for f,p in enumerate(samples):
 for n,(l,q,s)in p.items():
  if n in prev and prev[n].dot(q)<0:q.negate()
  prev[n]=q.copy();b=bones[n];b.location=l;b.rotation_quaternion=q;b.scale=s;b.keyframe_insert('location',frame=f);b.keyframe_insert('rotation_quaternion',frame=f);b.keyframe_insert('scale',frame=f)
rig.animation_data.action=None
for b in bones:b.matrix_basis.identity()
for tr in rig.animation_data.nla_tracks:tr.mute=False
bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);body.select_set(True);bpy.context.view_layer.objects.active=rig
bpy.ops.wm.save_as_mainfile(filepath=ROOT+'/assets/player-essential-motion/player-material-support-study.blend')
bpy.ops.export_scene.gltf(filepath=ROOT+'/assets/player-essential-motion/player-material-support-study.glb',export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='NLA_TRACKS',export_nla_strips=True,export_frame_range=False,export_force_sampling=True,export_def_bones=False)
json.dump({'frames':report,'flatFootReferences':{k:{'height':v['height'],'x':v['x']}for k,v in flat.items()},'clipDuration':1.2,'sourceCycle':[.16,.76],'cyclePhaseOffset':.4,'pelvisLoweringMeters':.085,'stanceSeconds':support,'speed':speed,'promoted':False},open(ROOT+'/docs/player-material-support-study.json','w'),indent=2)
print('DERIVATIVE FORWARD SUPPORT READY',flush=True)
