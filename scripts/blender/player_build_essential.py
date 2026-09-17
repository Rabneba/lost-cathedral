"""Essential player motion: Uthana full-body strike/crouch performances, Blender stance/contact cleanup.
No mesh redesign, no new locomotion generation, no world-space arm locking.
"""
import bpy,math,os,json
from mathutils import Vector,Matrix,Quaternion
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'))
bpy.ops.wm.open_mainfile(filepath=ROOT+'/assets/player-essential-motion/player-retarget-study.blend')
scene=bpy.context.scene;scene.render.fps=30;rig=next(o for o in scene.objects if o.type=='ARMATURE');bones=rig.pose.bones;body=next(o for o in scene.objects if o.type=='MESH' and not o.hide_render)
for t in rig.animation_data.nla_tracks:t.mute=True
old={a.name:a for a in bpy.data.actions};inv=rig.matrix_world.inverted()
def update():bpy.context.view_layer.update()
def B(n):return bones['mixamorig:'+n]
def wm(b):return rig.matrix_world@b.matrix
def reset():
 rig.animation_data.action=None
 for b in bones:b.matrix_basis.identity()
 update()
def pose(a,f):
 rig.animation_data.action=a;rig.animation_data.action_slot=a.slots[0];scene.frame_set(int(f),subframe=f-int(f));update()
 p={b.name:b.matrix_basis.copy()for b in bones};rig.animation_data.action=None
 for b in bones:b.matrix_basis=p[b.name]
 update();return p
reset();rest={b.name:wm(b).copy()for b in bones};restlocal={b.name:b.matrix_basis.copy()for b in bones}
guard=pose(old['essential-strike'],0)
weapOffset=wm(B('RightHand')).inverted()@wm(bones['WeaponSocket']);shieldOffset=wm(B('LeftHand')).inverted()@wm(bones['ShieldSocket'])
guardHip=wm(B('Hips')).to_quaternion();guardHand={side:wm(B(side+'Hand')).to_quaternion()for side in ['Left','Right']}
fingerPose={n:m for n,m in guard.items()if any(k in n for k in ['Thumb','Index','Middle','Ring','Pinky'])}
footgroups={g.index for g in body.vertex_groups if any(n in g.name for n in ['Foot','ToeBase'])};footverts=[v.index for v in body.data.vertices if sum(g.weight for g in v.groups if g.group in footgroups)>.5]
def setworld(b,m):b.matrix=inv@m;update()
def rotateworld(b,q):
 m=wm(b);setworld(b,Matrix.LocRotScale(m.translation,q@m.to_quaternion(),m.to_scale()))
def aim(b,c,target):
 p=wm(b).translation;a=wm(c).translation-p;v=target-p
 if a.length>1e-7 and v.length>1e-7:rotateworld(b,a.normalized().rotation_difference(v.normalized()))
def chain(upper,lower,end,target,pole):
 a,b,c=B(upper),B(lower),B(end);s=wm(a).translation;e=wm(b).translation;w=wm(c).translation
 l1=(e-s).length;l2=(w-e).length;delta=target-s;axis=delta.normalized();d=max(abs(l1-l2)+.001,min(delta.length,l1+l2-.001));along=(l1*l1-l2*l2+d*d)/(2*d);h=math.sqrt(max(0,l1*l1-along*along));p=pole-s;p=(p-axis*p.dot(axis)).normalized();elbow=s+axis*along+p*h;aim(a,b,elbow);aim(b,c,target)
def put(p):
 for n,m in p.items():bones[n].matrix_basis=m.copy()
 update()
def ease(v):v=max(0,min(1,v));return v*v*(3-2*v)
def blend(a,b,t):
 out={}
 for n in a:
  la,qa,sa=a[n].decompose();lb,qb,sb=b[n].decompose();out[n]=Matrix.LocRotScale(la.lerp(lb,t),qa.slerp(qb,t),sa.lerp(sb,t))
 return out
def timecurve(t,knots):
 for i in range(1,len(knots)):
  if t<=knots[i][0]:
   a,b=knots[i-1],knots[i];u=(t-a[0])/(b[0]-a[0]);return a[1]+(b[1]-a[1])*u
 return knots[-1][1]
def attachment():
 for n,m in fingerPose.items():bones[n].matrix_basis=m.copy()
 update();bones['WeaponSocket'].matrix=inv@(wm(B('RightHand'))@weapOffset);bones['ShieldSocket'].matrix=inv@(wm(B('LeftHand'))@shieldOffset);update()
def ground():
 ev=body.evaluated_get(bpy.context.evaluated_depsgraph_get());mesh=ev.to_mesh();z=sorted((ev.matrix_world@mesh.vertices[i].co).z for i in footverts);ev.to_mesh_clear()
 # Ignore isolated auto-weight outliers but retain the visible sole surface.
 floor=z[max(0,int(len(z)*.008))];m=wm(B('Hips'));m.translation.z-=floor-.003;setworld(B('Hips'),m);return floor

def stance(t,name,dur):
 attack=name in ['light','heavy'];dodge=name=='dodge';u=t/dur
 if attack:
  # Left step leads the swing. Rear foot supports the pelvis during contact.
  step=ease(t/(.46 if name=='light' else .7));back=ease((t-(dur-.35))/.35);step*=1-back
  shift=math.sin(math.pi*u)*.065;z=.925-math.sin(math.pi*u)*.028
 elif dodge:
  step=0;shift=-.015*math.sin(math.pi*u);z=.925-.16*math.sin(math.pi*min(1,max(0,(u-.12)/.73)))
 else:step=0;shift=0;z=.925+math.sin(t*math.tau/6)*.003
 m=wm(B('Hips'));m.translation=Vector((.012+shift,-.015-(.045*step if attack else 0),z));setworld(B('Hips'),m)
 # Clear support pattern. The provider supplied a suspended split stance;
 # targets restore heel/sole support while pelvis/chest keep the performance.
 for side,x,y in [('Left',.18,-.15),('Right',-.16,.11)]:
  lift=0
  if attack and side=='Left':
   phase=t/(.46 if name=='light' else .7);lift=.052*math.sin(math.pi*max(0,min(1,phase)));y-=.13*step
  if dodge:
   if side=='Right':p=(u-.12)/.34
   else:p=(u-.28)/.39
   lift=.055*math.sin(math.pi*max(0,min(1,p)))
   # Local foot travel accompanies the controller's backward displacement.
   y+=.10*math.sin(math.pi*max(0,min(1,p)))
  target=Vector((x,y,rest['mixamorig:'+side+'Foot'].translation.z+lift))
  chain(side+'UpLeg',side+'Leg',side+'Foot',target,Vector((x,-1.5,.55)))
  fm=wm(B(side+'Foot'));setworld(B(side+'Foot'),Matrix.LocRotScale(fm.translation,rest['mixamorig:'+side+'Foot'].to_quaternion(),fm.to_scale()))
  B(side+'ToeBase').matrix_basis.identity()
 update()

spec={
 'idle':{'duration':6,'loop':True,'blendIn':.2,'source':'strike first guard pose + Blender planted breathing stance'},
 'light':{'duration':1.4,'windup':.57,'active':.23,'recovery':.60,'hitWindows':[[.56,.68]],'blendIn':.12,'sourceFrames':[0,66],'source':'Uthana mdhYiFYRoTFc with step/sole cleanup and guard recovery'},
 'heavy':{'duration':1.9,'windup':.88,'active':.27,'recovery':.75,'hitWindows':[[.88,1.00]],'blendIn':.16,'sourceFrames':[0,66],'source':'same single Uthana strike, slower anticipation and heavier settling; not a distinct generated attack'},
 'block':{'duration':2,'loop':True,'blendIn':.18,'source':'guard with raised shield and planted knees'},
 'dodge':{'duration':.94,'travelDuration':.48,'distance':1.20,'travelStart':.12,'invulnerable':[.12,.49],'blendIn':.10,'direction':'backward','sourceFrames':[60,120],'source':'Uthana mSAWs64bB7jD crouch with grounded backstep cleanup and guard recovery'},
}
baked=[];audit={};lastsource=pose(old['essential-strike'],66)
for name,meta in spec.items():
 dur=meta['duration'];count=round(dur*30)+1;samples=[];floors=[]
 for fi in range(count):
  t=dur if fi==count-1 else min(dur,fi/30)
  if name in ['light','heavy']:
   if name=='light':knots=[(0,0),(.15,7),(.57,40),(.80,61),(1.0,66)]
   else:knots=[(0,0),(.23,7),(.88,40),(1.15,61),(1.40,66)]
   p=pose(old['essential-strike'],timecurve(t,knots))
   recoveryStart=1.0 if name=='light' else 1.40
   if t>recoveryStart:p=blend(p,guard,ease((t-recoveryStart)/(dur-recoveryStart)))
   put(p)
  elif name=='dodge':
   p=pose(old['essential-dodge'],timecurve(t,[(0,60),(.2,72),(.43,91),(.70,113),(.94,120)]))
   # Keep the defensive weapon hold; retain the captured spine compression.
   for n in p:
    if any(k in n for k in ['Shoulder','Arm','Hand']):p[n]=guard[n].copy()
   # Face the same opponent throughout the evade; raw capture was side-on.
   p['mixamorig:Hips']=guard['mixamorig:Hips'].copy()
   put(blend(guard,p,ease(t/.15)*(1-ease((t-.68)/.26))))
  else:
   put(guard)
   rotateworld(B('Spine'),Quaternion((1,0,0),math.sin(t*math.tau/6)*.007))
   rotateworld(B('Spine1'),Quaternion((0,0,1),math.sin(t*math.tau/6)*.006))
  rotateworld(B('Spine'),Quaternion((1,0,0),.065))
  stance(t,name,dur)
  if name=='block':
   hand=B('LeftHand');target=wm(hand).translation+Vector((-.035,-.14,.08));q=wm(hand).to_quaternion();chain('LeftArm','LeftForeArm','LeftHand',target,Vector((.8,.2,1)));hm=wm(hand);setworld(hand,Matrix.LocRotScale(hm.translation,q,hm.to_scale()))
  floors.append(ground());attachment()
  samples.append({b.name:(b.location.copy(),b.rotation_quaternion.copy(),b.scale.copy())for b in bones})
 rig.animation_data.action=None;a=bpy.data.actions.new('final_'+name);rig.animation_data.action=a
 prev={}
 for fi,sample in enumerate(samples):
  for n,(loc,q,scl) in sample.items():
   if n in prev and prev[n].dot(q)<0:q.negate()
   prev[n]=q.copy();b=bones[n];b.location=loc;b.rotation_quaternion=q;b.scale=scl;b.keyframe_insert('location',frame=fi);b.keyframe_insert('rotation_quaternion',frame=fi);b.keyframe_insert('scale',frame=fi)
 a.use_fake_user=True;baked.append((name,a,count));audit[name]={'frames':count,'duration':(count-1)/30,'groundCorrectionRange':[min(floors),max(floors)]};print('BAKED',name,flush=True)
# Reuse the approved gait set. Keep its moving pelvis/legs and torso, while
# guarding arms follow the animated chest instead of frozen world positions.
for n,a in old.items():
 if not n.startswith('armed_'):continue
 name=n.removeprefix('armed_');dur=(a.frame_range[1]-a.frame_range[0])/60;count=round(dur*30)+1;samples=[]
 for fi in range(count):
  t=fi/30;p=pose(a,min(a.frame_range[1],t*60))
  for bn in p:
   if any(k in bn for k in ['Shoulder','Arm','Hand']):p[bn]=guard[bn].copy()
  put(p);ground();attachment();samples.append({b.name:(b.location.copy(),b.rotation_quaternion.copy(),b.scale.copy())for b in bones})
 rig.animation_data.action=None;new=bpy.data.actions.new('final_'+name);rig.animation_data.action=new
 for fi,sample in enumerate(samples):
  for bn,(loc,q,scl) in sample.items():
   b=bones[bn];b.location=loc;b.rotation_quaternion=q;b.scale=scl;b.keyframe_insert('location',frame=fi);b.keyframe_insert('rotation_quaternion',frame=fi);b.keyframe_insert('scale',frame=fi)
 new.use_fake_user=True;baked.append((name,new,count));spec[name]={'duration':(count-1)/30,'loop':True,'blendIn':.22,'sourceSpeed':3.35 if name.startswith('run')else 1.35,'source':'existing Uthana 16-way locomotion; guard arms follow torso'};print('REUSED',name,flush=True)
# Existing utility actions retain their identity; they are not claimed as new captured performance.
for name in ['hit','heal','death']:
 a=old[name];count=round(a.frame_range[1]/2)+1
 copied=a.copy();copied.name='retained_'+name
 for layer in copied.layers:
  for strip in layer.strips:
   for bag in strip.channelbags:
    for fc in bag.fcurves:
     for k in fc.keyframe_points:k.co.x/=2;k.handle_left.x/=2;k.handle_right.x/=2
 copied.use_fake_user=True;baked.append((name,copied,count));spec[name]={'duration':(count-1)/30,'blendIn':.16,'source':'retained previous utility action, not regenerated'}
reset()
for t in list(rig.animation_data.nla_tracks):rig.animation_data.nla_tracks.remove(t)
for n,a,count in baked:
 t=rig.animation_data.nla_tracks.new();t.name=n;st=t.strips.new(n,0,a);st.action_frame_start=0;st.action_frame_end=count-1;t.mute=False
bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);body.select_set(True);bpy.context.view_layer.objects.active=rig;scene.frame_start=0;scene.frame_end=180
bpy.ops.wm.save_as_mainfile(filepath=ROOT+'/assets/production/player-essential.blend')
bpy.ops.export_scene.gltf(filepath=ROOT+'/assets/production/player-essential.glb',export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='NLA_TRACKS',export_nla_strips=True,export_frame_range=False,export_force_sampling=True,export_def_bones=False)
manifest={'asset':'assets/production/player-essential.glb','characterId':'cmu1g9dee049k2pnw1spkx8ku','generationCount':2,'locomotionSpeed':3.35,'clips':spec,'sourceJobs':{'strike':'cmu1sg1yb00952wp607u8p8zg','dodge':'cmu1sg1vb007h2po0ktip7jix'},'audit':audit,'limitations':['Heavy derives from the same captured strike, with different timing; it is not a second unique performance.','Video extraction froze root height and raised both soles; Blender support-foot targets and root grounding repair those errors.','Dodge is a grounded backward evasive step, not a roll.','Hit, healing and death are retained previous utility clips; locomotion is reused with torso-relative guard arms.']}
json.dump(manifest,open(ROOT+'/docs/player-essential-manifest.json','w'),indent=2)
print('PLAYER_ESSENTIAL_COMPLETE',flush=True)
