"""Bake approved Uthana humanoids with two-hand equipment contact in Blender.
Approved geometry and materials are retained. Weight repairs and rig edits are made on copies.
Weapon targets come from the same timed paths as gameplay. Blender solves arms,
plants feet for authored actions, closes fingers and exports real glTF clips.
"""
import bpy,sys,os,json,math
import numpy as np
from mathutils import Vector,Matrix,Quaternion
args=sys.argv[sys.argv.index('--')+1:];kind=args[0];root=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'));boss=kind=='boss';data=json.load(open(root+'/docs/'+kind+'-motion-targets.json'));height=data['height'];out=root+'/assets/production/'+kind+'-combat'
fps=data.get('fps',30);bpy.ops.wm.read_factory_settings(use_empty=True);bpy.context.scene.render.fps=fps
bpy.ops.import_scene.gltf(filepath=root+'/assets/production/'+kind+'-with-locomotion.glb');rig=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE');body=next(o for o in bpy.context.scene.objects if o.type=='MESH' and any(m.type=='ARMATURE' for m in o.modifiers))
# Blender importer uses the scene FPS to place seconds correctly.
sources={a.name:a for a in bpy.data.actions};sourceDur={n:(a.frame_range[1]-a.frame_range[0])/fps for n,a in sources.items()}
for t in list(rig.animation_data.nla_tracks):rig.animation_data.nla_tracks.remove(t)
rig.animation_data.action=None
for pb in rig.pose.bones:pb.matrix_basis.identity()
bpy.context.view_layer.update();coords=[body.matrix_world@Vector(c) for c in body.bound_box];low=Vector(tuple(min(p[i] for p in coords)for i in range(3)));high=Vector(tuple(max(p[i] for p in coords)for i in range(3)));scale=height/(high.z-low.z);center=Vector(((low.x+high.x)/2,(low.y+high.y)/2,low.z));rig.matrix_world=Matrix.Scale(scale,4)@Matrix.Translation(-center)@rig.matrix_world
bpy.context.view_layer.update();inv=rig.matrix_world.inverted();bones=rig.pose.bones
# An exported socket is an ordinary non-deforming bone, animated with the body.
bpy.context.view_layer.objects.active=rig;rig.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
for name in ['WeaponSocket','ShieldSocket']:
 b=rig.data.edit_bones.new(name);b.head=(0,0,0);b.tail=(0,10,0);b.use_deform=False
bpy.ops.object.mode_set(mode='POSE');bpy.ops.object.mode_set(mode='OBJECT')
bones=rig.pose.bones
for p in bones:p.rotation_mode='QUATERNION'
def B(name):return bones['mixamorig:'+name]
def pos(pb):return (rig.matrix_world@pb.matrix).translation.copy()
def worldq(pb):return (rig.matrix_world@pb.matrix).to_quaternion()
def update():bpy.context.view_layer.update()
rest={p.name:p.matrix_basis.copy() for p in bones};restpos={p.name:pos(p)for p in bones};restq={p.name:worldq(p)for p in bones};rigscale=rig.matrix_world.to_scale()
conv=Matrix.Rotation(math.pi/2,4,'X') # glTF x,y,z -> Blender x,-z,y
def from3(a):return Vector((a[0],-a[2],a[1]))
def socketMatrix(f):
 q=f['quaternion'];m=Matrix.LocRotScale(Vector(f['position']),Quaternion((q[3],q[0],q[1],q[2])),Vector((1,1,1)));return conv@m@conv.inverted()
def setworld(pb,m):pb.matrix=inv@m;update()
def rotateworld(pb,q):
 m=rig.matrix_world@pb.matrix;p=m.translation.copy();setworld(pb,Matrix.Translation(p)@q.to_matrix().to_4x4()@Matrix.Translation(-p)@m)
def aim(pb,child,target):
 p=pos(pb);old=pos(child)-p;new=target-p
 if old.length<1e-5 or new.length<1e-5:return
 rotateworld(pb,old.normalized().rotation_difference(new.normalized()))
def chain(upper,lower,end,target,pole):
 a,b,c=B(upper),B(lower),B(end);s,e,w=pos(a),pos(b),pos(c);l1=(e-s).length;l2=(w-e).length;delta=target-s;d=delta.length;axis=delta.normalized();safe=max(abs(l1-l2)+.001,min(d,l1+l2-.0005));along=(l1*l1-l2*l2+safe*safe)/(2*safe);h=math.sqrt(max(0,l1*l1-along*along));pv=pole-s;pv=(pv-axis*pv.dot(axis)).normalized();elbow=s+axis*along+pv*h;aim(a,b,elbow);aim(b,c,target);return(pos(c)-target).length
# Uthana's T-pose conversion tears the player's very large pauldron. Bind the
# untouched approved A-pose mesh to the same humanoid skeleton instead.
if not boss:
 rotateworld(B('LeftArm'),Quaternion((0,1,0),math.radians(58)))
 rotateworld(B('RightArm'),Quaternion((0,1,0),math.radians(-58)))
 bpy.context.view_layer.objects.active=rig
 bpy.ops.object.mode_set(mode='POSE');bpy.ops.pose.armature_apply(selected=False);bpy.ops.object.mode_set(mode='OBJECT')
 # Align imported hand joints with the approved mesh's glove cross-sections.
 bpy.ops.object.mode_set(mode='EDIT')
 for eb in rig.data.edit_bones:
  if 'Hand' in eb.name:
   sign=1 if 'Right' in eb.name else -1
   delta=inv.to_3x3()@Vector((sign*.04,-.065,0))
   eb.head+=delta;eb.tail+=delta
 bpy.ops.object.mode_set(mode='OBJECT');update()

 oldbody=body;oldbody.hide_render=True;oldbody.hide_set(True)
 before=set(bpy.context.scene.objects)
 bpy.ops.import_scene.gltf(filepath=root+'/assets/production/thorn-exile-body.glb')
 body=next(o for o in bpy.context.scene.objects if o not in before and o.type=='MESH')
 world=body.matrix_world.copy();body.parent=rig;body.matrix_world=world
 mod=body.modifiers.new('Approved mesh humanoid binding','ARMATURE');mod.object=rig
 for pb in bones:
  if pb.name.startswith('mixamorig:'):body.vertex_groups.new(name=pb.name)
 update();rest={p.name:p.matrix_basis.copy()for p in bones};restpos={p.name:pos(p)for p in bones};restq={p.name:worldq(p)for p in bones}
 bpy.context.view_layer.objects.active=rig

# Repair demonstrably distant auto-weights. Large armor flourishes can confuse
# the provider: a torso vertex assigned to the opposite hand becomes a spike.
# Keep geometrically plausible weights; replace only distant assignments.
segment_names=[];segment_a=[];segment_b=[]
for pb in bones:
 if not pb.name.startswith('mixamorig:'):continue
 a=restpos[pb.name];children=list(pb.children)
 preferred=next((c for c in children if any(x in c.name for x in ['Spine','Arm','ForeArm','Middle1','Leg','Foot','Toe'])),children[0] if children else None)
 if preferred:b=restpos[preferred.name]
 elif pb.parent:b=a+(a-restpos[pb.parent.name])*.65
 else:b=a+Vector((0,0,.15))
 if pb.name.endswith('Head'):b=a+Vector((0,0,.16*height))
 segment_names.append(pb.name);segment_a.append(list(a));segment_b.append(list(b))
vp=np.array([list(body.matrix_world@v.co)for v in body.data.vertices]);aa=np.array(segment_a);bb=np.array(segment_b);ab=bb-aa
ap=vp[:,None,:]-aa[None,:,:];tt=np.clip(np.sum(ap*ab[None,:,:],axis=2)/np.maximum(np.sum(ab*ab,axis=1),1e-10),0,1)
dist=np.linalg.norm(ap-tt[:,:,None]*ab[None,:,:],axis=2);nearest=np.argmin(dist,axis=1)
groupidx={g.index:segment_names.index(g.name)for g in body.vertex_groups if g.name in segment_names};names_to_group={g.name:g for g in body.vertex_groups}
repaired=0;pruned=0
for vert in body.data.vertices:
 weights=[(groupidx[g.group],g.weight)for g in vert.groups if g.group in groupidx and g.weight>.00001]
 main=max(weights,key=lambda g:g[1])[0] if weights else -1;best=int(nearest[vert.index]);drow=dist[vert.index]
 if not weights or (drow[main]>.105*height and drow[best]<drow[main]*.65):
  candidates=np.argsort(drow)[:3];vals=1/np.maximum(drow[candidates],.018*height)**5;vals/=vals.sum();new=[(int(i),float(w))for i,w in zip(candidates,vals)];repaired+=1
 else:
  new=[(i,w)for i,w in weights if drow[i]<max(.14*height,drow[best]*2.4)]
  if not new:new=weights
  if len(new)==len(weights):continue
  total=sum(w for i,w in new);new=[(i,w/total)for i,w in new];pruned+=1
 for g in list(vert.groups):body.vertex_groups[g.group].remove([vert.index])
 for i,w in new:names_to_group[segment_names[i]].add([vert.index],w,'REPLACE')
print('WEIGHT_REPAIR',repaired,'reassigned',pruned,'pruned out of',len(body.data.vertices),flush=True)

feet={side:restpos['mixamorig:'+side+'Foot'].copy()for side in ['Left','Right']}
def plantfeet(drop=0):
 for side,sign in [('Left',1),('Right',-1)]:
  target=feet[side].copy();target.x+=sign*.035;target.y+=sign*.07
  chain(side+'UpLeg',side+'Leg',side+'Foot',target,Vector((sign*.25,-1.4,.6)))
  pb=B(side+'Foot');q=restq[pb.name];m=rig.matrix_world@pb.matrix;m=Matrix.LocRotScale(m.translation,q,m.to_scale());setworld(pb,m)
# Source clips retain their lower-body animation; equipment poses are corrected.
for name,dur in sourceDur.items():
 idle=data['clips']['idle']['frames'][0];data['clips'][name]={'duration':dur,'frames':[dict(idle,time=min(i/fps,dur))for i in range(math.ceil(dur*fps)+1)]}
reports={};baked=[]
for name,clip in data['clips'].items():
 source=sources.get(name);frames=clip['frames'];captured=[];errs=[];sourceHeightBias=None
 for fi,f in enumerate(frames):
  rig.animation_data.action=None
  for pb in bones:pb.matrix_basis=rest[pb.name].copy()
  if source:
   rig.animation_data.action=source;rig.animation_data.action_slot=source.slots[0];bpy.context.scene.frame_set(fi);update()
   sourcepose={p.name:p.matrix_basis.copy()for p in bones}
   rig.animation_data.action=None
   for p in bones:p.matrix_basis=sourcepose[p.name]
   update()
   # Root translation remains in place; the game owns displacement.
   hip=B('Hips');wm=rig.matrix_world@hip.matrix;rp=restpos[hip.name];wm.translation.x=rp.x;wm.translation.y=rp.y
   if sourceHeightBias is None:sourceHeightBias=wm.translation.z-rp.z
   wm.translation.z-=sourceHeightBias+.055
   setworld(hip,wm)
   # Retain gait torso but restore arms before the grip solve.
   for pb in bones:
    if any(s in pb.name for s in ['Shoulder','Arm','Hand']):pb.matrix_basis=rest[pb.name].copy()
  else:
   bpy.context.scene.frame_set(fi);update()
   hip=B('Hips');wm=rig.matrix_world@hip.matrix
   drop=.085 if boss else .045
   if name=='dodge':drop+=math.sin(min(1,f['time']/.64)*math.pi)*.4
   if name=='death':drop+=min(1,f['time']/1.25)*(.82 if boss else .6)
   if name=='awaken':drop+=math.sin(f['time']/clip['duration']*math.pi)*.12
   wm.translation.z-=drop;setworld(hip,wm);plantfeet(drop)
  update()
  # Weight and shoulders participate in the windup, rather than just the arms.
  t=f['time'];breath=math.sin(t*math.pi)*( .013 if name=='idle' else .003)
  rotateworld(B('Spine'),Quaternion((1,0,0),(.12 if boss else .045)+breath))
  yaw=f['rotation'][1] if boss else f['rotation'][1]*.3
  if not source:rotateworld(B('Spine1'),Quaternion((0,0,1),-yaw*.16))
  if name=='death':
   frot=min(1,max(0,(t-.6)/1.8));rotateworld(B('Spine'),Quaternion((1,0,0),frot*.95));rotateworld(B('Neck'),Quaternion((1,0,0),frot*.4))
  if name=='dodge':
   # Tuck the torso and arms; the controller supplies the ground travel.
   rotateworld(B('Spine'),Quaternion((1,0,0),math.sin(t/.64*math.pi)*.65))
  if name=='hit':rotateworld(B('Spine'),Quaternion((1,0,0),-math.sin(t/.4*math.pi)*.3))
  wm=socketMatrix(f)
  if boss and name in ['sweep','slam','combo']:
   # Project the shared weapon position into both arms' reachable volumes.
   # The shaft remains rigid and both grips move together; never stretch bones.
   rot0=conv.to_3x3()@Quaternion((f['quaternion'][3],*f['quaternion'][:3])).to_matrix()
   forward0=(rot0@Vector((0,0,-1))).normalized()
   for iteration in range(24):
    for side in ['Right','Left']:
     hand=B(side+'Hand');palm=(restpos['mixamorig:'+side+'HandMiddle1']-restpos[hand.name]).length*.62
     shoulder=pos(B(side+'Arm'));elbow=pos(B(side+'ForeArm'));wrist0=pos(hand)
     reach=(elbow-shoulder).length+(wrist0-elbow).length-.008
     target=wm@from3((0,.6 if side=='Right' else 1.16,0))-forward0*palm
     delta=target-shoulder
     if delta.length>reach:wm.translation-=delta.normalized()*(delta.length-reach)
  setworld(bones['WeaponSocket'],wm)
  q=wm.to_quaternion();shaft=(q@Vector((0,0,1))).normalized() # converted local Y is world Z
  # Weapon frame columns determine hand orientation in the original glTF basis.
  threeq=Quaternion((f['quaternion'][3],*f['quaternion'][:3]));rot=conv.to_3x3()@threeq.to_matrix()
  axis=(rot@Vector((0,1,0))).normalized();finger=(rot@Vector((0,0,-1))).normalized()
  for side,sign in [('Right',-1),('Left',1)]:
   hand=B(side+'Hand');length=(restpos['mixamorig:'+side+'HandMiddle1']-restpos[hand.name]).length*.62
   if boss:
    grip=wm@from3((0,.6 if side=='Right' else 1.16,0))
    # Wrist is behind the palm; fingers wrap around the shaft at the grip.
    xaxis=axis*sign;yaxis=finger;zaxis=xaxis.cross(yaxis).normalized();yaxis=zaxis.cross(xaxis).normalized();hq=Matrix((xaxis,yaxis,zaxis)).transposed().to_quaternion();wrist=grip-yaxis*length
   elif side=='Right':
    grip=wm@from3((0,.16,0));xaxis=axis*sign;yaxis=finger;zaxis=xaxis.cross(yaxis).normalized();yaxis=zaxis.cross(xaxis).normalized();hq=Matrix((xaxis,yaxis,zaxis)).transposed().to_quaternion();wrist=grip-yaxis*length
   else:
    wrist=from3((.32,(1.15 if name=='block' else 1.08)-(min(1,t/2)*.7 if name=='death' else 0),.3 if name=='block' else .10));hq=restq[hand.name].copy();grip=wrist
   err=chain(side+'Arm',side+'ForeArm',side+'Hand',wrist,Vector((sign*1.3,.6,1.05 if boss else .8)))
   if not boss and side=='Right':
    # Match the actual rest-pose palm frame; imported bone local Y is not
    # necessarily the direction from wrist to knuckles.
    rf=(restpos['mixamorig:'+side+'HandMiddle1']-restpos[hand.name]).normalized()
    rx=(restpos['mixamorig:'+side+'HandIndex1']-restpos['mixamorig:'+side+'HandPinky1']).normalized()
    rz=rx.cross(rf).normalized();rx=rf.cross(rz).normalized()
    rq=Matrix((rx,rf,rz)).transposed().to_quaternion()
    hq=hq@rq.inverted()@restq[hand.name]
   m=rig.matrix_world@hand.matrix;setworld(hand,Matrix.LocRotScale(m.translation,hq,m.to_scale()));errs.append(err)
   if err>.02 and fi%30==0:print('GRIP_DIAG',name,fi,side,'shoulder',list(pos(B(side+'Arm'))),'wrist',list(pos(hand)),'target',list(wrist),'error',err,flush=True)
   for fingername in ['Index','Middle','Ring','Pinky']:
    for j in [1,2,3]:
     p=B(side+'Hand'+fingername+str(j))
     if boss:p.rotation_quaternion=Quaternion((1,0,0),-.8 if j==1 else -1.0)
     elif side=='Right':rotateworld(p,Quaternion(-axis,.7 if j==1 else .95))
   if not boss and side=='Left':
    shield=Matrix.LocRotScale(from3((.39,(.94 if name=='block' else .80)-(min(1,t/2)*.65 if name=='death' else 0),.43 if name=='block' else .17)),Quaternion((1,0,0),0),Vector((1,1,1)));setworld(bones['ShieldSocket'],shield)
  update();captured.append({p.name:(p.location.copy(),p.rotation_quaternion.copy(),p.scale.copy())for p in bones})
 rig.animation_data.action=None
 action=bpy.data.actions.new('combat_'+name);rig.animation_data.action=action
 for i,sample in enumerate(captured):
  for n,(loc,rot,sc) in sample.items():
   p=bones[n];p.location=loc;p.rotation_quaternion=rot;p.scale=sc;p.keyframe_insert('location',frame=i);p.keyframe_insert('rotation_quaternion',frame=i);p.keyframe_insert('scale',frame=i)
 action.name=name if name not in sources else 'armed_'+name;action.use_fake_user=True;baked.append((name,action,len(captured)))
 reports[name]={'duration':clip['duration'],'frames':len(captured),'maxWristTargetErrorMeters':max(errs) if errs else 0};print('BAKED',name,reports[name],flush=True)
rig.animation_data.action=None
for name,action,count in baked:
 tr=rig.animation_data.nla_tracks.new();tr.name=name;strip=tr.strips.new(name,0,action);strip.action_frame_start=0;strip.action_frame_end=count-1;tr.mute=True
for p in bones:p.matrix_basis=rest[p.name].copy()
# Select only the real actor and rig; importer bone-display widgets are excluded.
bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);body.select_set(True);bpy.context.view_layer.objects.active=rig
for o in bpy.context.scene.objects:
 if o not in [rig,body]:o.hide_render=True
bpy.context.scene.frame_start=0;bpy.context.scene.frame_end=90;bpy.context.scene.frame_set(0);update()
for tr in rig.animation_data.nla_tracks:tr.mute=False
bpy.ops.wm.save_as_mainfile(filepath=out+'.blend')
bpy.ops.export_scene.gltf(filepath=out+'.glb',export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='NLA_TRACKS',export_nla_strips=True,export_frame_range=False,export_force_sampling=True,export_def_bones=False)
json.dump(reports,open(root+'/docs/'+kind+'-animation-audit.json','w'),indent=2)
print('COMPLETED',out,flush=True)
