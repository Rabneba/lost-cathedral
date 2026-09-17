"""Refine support phases without new generation or changing runtime timing.
A guarded backstep has a brief airborne phase while the controller translates it.
Runs retain brief source-implied flight instead of forcing a boot onto the floor every frame.
"""
import bpy,os,json,math
from mathutils import Matrix,Vector,Quaternion
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'));bpy.ops.wm.open_mainfile(filepath=ROOT+'/assets/player-essential-motion/player-working-before-footfall-review.blend');scene=bpy.context.scene;rig=next(o for o in scene.objects if o.type=='ARMATURE');bones=rig.pose.bones;body=next(o for o in scene.objects if o.type=='MESH' and not o.hide_render);inv=rig.matrix_world.inverted();tracks=list(rig.animation_data.nla_tracks)
for tr in tracks:tr.mute=True
meta=json.load(open(ROOT+'/docs/player-essential-manifest.json'));report={}
def update():bpy.context.view_layer.update()
def B(n):return bones['mixamorig:'+n]
def wm(b):return rig.matrix_world@b.matrix
def setworld(b,m):b.matrix=inv@m;update()
def pose(a,f):
 rig.animation_data.action=a;rig.animation_data.action_slot=a.slots[0];scene.frame_set(int(f),subframe=f-int(f));update();p={b.name:(b.location.copy(),b.rotation_quaternion.copy(),b.scale.copy())for b in bones};rig.animation_data.action=None
 for n,(l,q,s)in p.items():b=bones[n];b.location=l;b.rotation_quaternion=q;b.scale=s
 update();return p
footsets={}
for side in ['Left','Right']:
 groups={g.index for g in body.vertex_groups if side in g.name and any(s in g.name for s in ['Foot','ToeBase'])};footsets[side]=[v.index for v in body.data.vertices if sum(g.weight for g in v.groups if g.group in groups)>.5]
def solefloor():
 ev=body.evaluated_get(bpy.context.evaluated_depsgraph_get());mesh=ev.to_mesh();ys=[]
 for ids in footsets.values():
  z=sorted((ev.matrix_world@mesh.vertices[i].co).z for i in ids);ys.append(z[int(len(z)*.008)])
 ev.to_mesh_clear();return min(ys)
def fitfloor(target):
 z=solefloor();m=wm(B('Hips'));m.translation.z+=target-z;setworld(B('Hips'),m)
def rotateworld(b,q):
 m=wm(b);setworld(b,Matrix.LocRotScale(m.translation,q@m.to_quaternion(),m.to_scale()))
def aim(b,c,p):
 origin=wm(b).translation;old=wm(c).translation-origin;new=p-origin
 if old.length>1e-6 and new.length>1e-6:rotateworld(b,old.normalized().rotation_difference(new.normalized()))
def chain(upper,lower,end,target,pole):
 a,b,c=B(upper),B(lower),B(end);s=wm(a).translation;e=wm(b).translation;w=wm(c).translation;l1=(e-s).length;l2=(w-e).length;v=target-s;axis=v.normalized();d=max(abs(l1-l2)+.001,min(v.length,l1+l2-.001));x=(l1*l1-l2*l2+d*d)/(2*d);h=math.sqrt(max(0,l1*l1-x*x));p=pole-s;p=(p-axis*p.dot(axis)).normalized();aim(a,b,s+axis*x+p*h);aim(b,c,target)
def ease(u):u=max(0,min(1,u));return u*u*(3-2*u)
def curve(t,keys):
 for i in range(1,len(keys)):
  if t<=keys[i][0]:
   a,b=keys[i-1],keys[i];return a[1]+(b[1]-a[1])*ease((t-a[0])/(b[0]-a[0]))
 return keys[-1][1]
def travel(t):u=max(0,min(1,(t-.12)/.48));return 1.2*(1-(1-u)**2)
def capture():return {b.name:(b.location.copy(),b.rotation_quaternion.copy(),b.scale.copy())for b in bones}
for track in tracks:
 name=track.name
 if name!='dodge' and not name.startswith('run-'):continue
 action=track.strips[0].action;end=round(action.frame_range[1]);duration=end/30
 pose(action,0);sw=wm(B('RightHand')).inverted()@wm(bones['WeaponSocket']);sh=wm(B('LeftHand')).inverted()@wm(bones['ShieldSocket']);guardHip=wm(B('Hips')).translation.z
 feet={s:wm(B(s+'Foot')).copy()for s in ['Left','Right']}
 samples=[];clearances=[]
 if name.startswith('run-'):
  original=bpy.data.actions['armed_'+name];rawfloors=[]
  for f in range(end+1):pose(original,original.frame_range[1]*f/end);rawfloors.append(solefloor())
  rawfloors=[v+(rawfloors[0]-rawfloors[-1])*i/end for i,v in enumerate(rawfloors)];vals=sorted(rawfloors);threshold=vals[int((len(vals)-1)*.70)];ceiling=max(vals)
 for f in range(end+1):
  t=f/30;pose(action,f)
  if name=='dodge':
   jump=curve(t,[(0,0),(.085,0),(.12,.025),(.20,.090),(.31,.145),(.40,.12),(.49,.037),(.54,0),(duration,0)])
   hipoff=curve(t,[(0,0),(.08,-.07),(.12,-.025),(.21,.065),(.32,.095),(.43,.040),(.55,-.065),(.63,-.085),(.79,-.022),(duration,0)])
   hm=wm(B('Hips'));hm.translation.z=guardHip+hipoff;setworld(B('Hips'),hm)
   land=(1.2-travel(t))*ease((t-.44)/.10) if t<.6 else 0
   for s in ['Left','Right']:
    fm=feet[s];p=fm.translation.copy();p.z+=jump;p.y+=land+(.055 if s=='Left' else .035)*(jump/.145);p.x*=1-.10*(jump/.145)
    chain(s+'UpLeg',s+'Leg',s+'Foot',p,Vector((p.x,-1.4,.55)))
    current=wm(B(s+'Foot'));q=Quaternion((1,0,0),math.radians(8)*(jump/.145))@fm.to_quaternion();setworld(B(s+'Foot'),Matrix.LocRotScale(current.translation,q,current.to_scale()));B(s+'ToeBase').matrix_basis.identity()
   update();floorTarget=.003+jump
  else:
   u=max(0,min(1,(rawfloors[f]-threshold)/max(ceiling-threshold,.001)));flight=.038*ease(u);floorTarget=.003+flight
  fitfloor(floorTarget);bones['WeaponSocket'].matrix=inv@(wm(B('RightHand'))@sw);bones['ShieldSocket'].matrix=inv@(wm(B('LeftHand'))@sh);update();samples.append(capture());clearances.append(solefloor())
 # Preserve exact shared guard endpoints for the dodge; preserved gait endpoints
 # are cyclic because their flight weight is periodic.
 if name=='dodge':
  pose(action,0);samples[0]=capture();pose(action,end);samples[-1]=capture()
 rig.animation_data.action=action;rig.animation_data.action_slot=action.slots[0]
 prev={}
 for f,sample in enumerate(samples):
  for n,(loc,q,scl)in sample.items():
   if n in prev and prev[n].dot(q)<0:q.negate()
   prev[n]=q.copy();b=bones[n];b.location=loc;b.rotation_quaternion=q;b.scale=scl;b.keyframe_insert('location',frame=f);b.keyframe_insert('rotation_quaternion',frame=f);b.keyframe_insert('scale',frame=f)
 report[name]={'maxMinimumSoleClearance':max(clearances),'airborneFrames':sum(z>.018 for z in clearances),'totalFrames':end+1,'durationUnchanged':duration,'timingMetadataChanged':False};print('REFINED',name,report[name],flush=True)
rig.animation_data.action=None
for b in bones:b.matrix_basis.identity()
for tr in tracks:tr.mute=False
bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);body.select_set(True);bpy.context.view_layer.objects.active=rig
bpy.ops.wm.save_as_mainfile(filepath=ROOT+'/assets/player-essential-motion/player-footfall-study.blend')
bpy.ops.export_scene.gltf(filepath=ROOT+'/assets/player-essential-motion/player-footfall-study.glb',export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='NLA_TRACKS',export_nla_strips=True,export_frame_range=False,export_force_sampling=True,export_def_bones=False)
json.dump(report,open(ROOT+'/docs/player-footfall-refinement.json','w'),indent=2)
print('STAGED_FOOTFALL_REFINEMENT_COMPLETE',flush=True)
