"""Correct attack blade orientation/floor and death entry; preserve accepted clips."""
import bpy,os,json,math,hashlib,statistics,numpy as np
from mathutils import Matrix,Vector,Quaternion
R=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'));O=R+'/assets/player-combat-revision';bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.open_mainfile(filepath=O+'/player-video-candidate-v2.blend');scene=bpy.context.scene;rig=next(o for o in scene.objects if o.type=='ARMATURE');body=next(o for o in scene.objects if o.type=='MESH'and not o.hide_render);bones=rig.pose.bones;inv=rig.matrix_world.inverted();old={tr.name:tr.strips[0].action for tr in rig.animation_data.nla_tracks};rig.animation_data.action=None
for tr in rig.animation_data.nla_tracks:tr.mute=True
wanted=['weapon-refined-heavy-v2']
with bpy.data.libraries.load(O+'/player-video-weapon-v3-trial.blend',link=False)as(src,dst):dst.actions=wanted
sources={'heavy':dst.actions[0]}
def B(n):return bones['mixamorig:'+n]
def wm(b):return rig.matrix_world@b.matrix
def up():bpy.context.view_layer.update()
def cap():return {b.name:(b.location.copy(),b.rotation_quaternion.copy(),b.scale.copy())for b in bones}
def put(p):
 for n,(l,q,s)in p.items():bones[n].location=l;bones[n].rotation_quaternion=q;bones[n].scale=s
 up()
def pose(a,f):
 rig.animation_data.action=a;rig.animation_data.action_slot=a.slots[0];scene.frame_set(int(f),subframe=f-int(f));up();p=cap();rig.animation_data.action=None;put(p);return p
base=pose(old['idle'],0);offset=wm(B('RightHand')).inverted()@wm(bones['WeaponSocket'])
def equip():bones['WeaponSocket'].matrix=inv@(wm(B('RightHand'))@offset);up()
def blend(p,q,w):return {n:(l.lerp(q[n][0],w),r.slerp(q[n][1],w),s.lerp(q[n][2],w))for n,(l,r,s)in p.items()}
def smooth(x):x=max(0,min(1,x));return x*x*(3-2*x)
footgroups={g.index for g in body.vertex_groups if any(n in g.name for n in ['Foot','ToeBase'])};footids=[v.index for v in body.data.vertices if sum(g.weight for g in v.groups if g.group in footgroups)>.5]
def ground():
 ev=body.evaluated_get(bpy.context.evaluated_depsgraph_get());me=ev.to_mesh();low=min((ev.matrix_world@me.vertices[i].co).z for i in footids);ev.to_mesh_clear();m=wm(B('Hips'));m.translation.z+=.003-low;B('Hips').matrix=inv@m;up()
before=set(scene.objects);bpy.ops.import_scene.gltf(filepath=R+'/assets/create-the-exact-isolated-player-sword-s-cmu12ngf.glb');objects=[o for o in scene.objects if o not in before];verts=[];rotation=Matrix.Rotation(-math.pi/2,4,'Z')@Matrix.Rotation(math.pi,4,'Y')
for o in objects:
 o.hide_render=True
 if o.type=='MESH':verts.extend((rotation@o.matrix_world)@v.co for v in o.data.vertices)
lo=Vector([min(v[i]for v in verts)for i in range(3)]);hi=Vector([max(v[i]for v in verts)for i in range(3)]);center=Vector(((lo.x+hi.x)/2,(lo.y+hi.y)/2,lo.z));verts=[(v-center)*1.28/(hi.z-lo.z)for v in verts];h=[v for v in verts if .08<v.z<.25];center=Vector((statistics.median(v.x for v in h),statistics.median(v.y for v in h),0));verts=np.array([v-center for v in verts])
def minimum(m):m=np.array(m);return float(np.min(verts@m[2,:3]+m[2,3]))
def safe_floor():
 equip();hand=B('RightHand');hm=wm(hand);source=minimum(hm@offset)
 if source>=.045:return source,source,0,'none'
 shaft=(hm@offset).to_quaternion()@Vector((0,0,1));axis=shaft.cross(Vector((0,0,1))).normalized();arm=(hm.translation-wm(B('RightForeArm')).translation).normalized();palm=wm(B('RightHandMiddle1')).translation-hm.translation;chosen=0
 for angle in np.linspace(0,math.radians(60),121):
  q=Quaternion(axis,float(angle));m=Matrix.LocRotScale(hm.translation,q@hm.to_quaternion(),hm.to_scale());low=minimum(m@offset)
  if low>=.045 and math.degrees(arm.angle(q@palm))<60:chosen=float(angle);hand.matrix=inv@m;up();break
 equip();method='wrist'
 if minimum(wm(bones['WeaponSocket']))<.04:
  armBone=B('RightArm');am=wm(armBone);local=am.inverted()@wm(bones['WeaponSocket']);solved=False
  for deg in np.arange(.5,12,.5):
   for az in np.arange(0,360,30):
    axis=Vector((math.cos(math.radians(az)),math.sin(math.radians(az)),0));q=Quaternion(axis,math.radians(float(deg)));test=Matrix.LocRotScale(am.translation,q@am.to_quaternion(),am.to_scale())
    if minimum(test@local)>=.045:
     armBone.matrix=inv@test;up();equip();chosen=math.radians(float(deg));method='whole-arm';solved=True;break
   if solved:break
 return source,minimum(wm(bones['WeaponSocket'])),math.degrees(chosen),method
reports={}
for name in ['heavy']:
 duration={'light':1.5,'heavy':1.9,'death':2.8}[name];end=round(duration*30);samples=[];rows=[]
 for f in range(end+1):
  t=f/30
  if name=='death':
   p=pose(old[name],f)
   if t<.23:p=blend(base,p,smooth(t/.23))
  else:
   sf=(140 if name=='light'else 154)*t/duration;p=pose(sources[name],sf)
   if t<.16:p=blend(base,p,smooth(t/.16))
   recovery=.24 if name=='light'else .28
   if t>duration-recovery:p=blend(p,base,smooth((t-duration+recovery)/recovery))
  put(p)
  if name!='death' or t<.24:ground()
  equip();before,after,angle,method=safe_floor();samples.append(cap());rows.append({'frame':f,'time':t,'swordMinimumBefore':before,'swordMinimumAfter':after,'extraArmOrWristFloorCorrectionDegrees':angle,'floorCorrectionMethod':method})
 a=bpy.data.actions.new('video-v3-'+name);rig.animation_data.action=a;previous={}
 for f,p in enumerate(samples):
  for n,(l,q,s)in p.items():
   q=q.copy()
   if n in previous and q.dot(previous[n])<0:q.negate()
   previous[n]=q.copy();b=bones[n];b.location=l;b.rotation_quaternion=q;b.scale=s;b.keyframe_insert('location',frame=f);b.keyframe_insert('rotation_quaternion',frame=f);b.keyframe_insert('scale',frame=f)
 for layer in a.layers:
  for strip in layer.strips:
   for bag in strip.channelbags:
    for fc in bag.fcurves:
     for k in fc.keyframe_points:k.interpolation='LINEAR'
 a.use_fake_user=True;rig.animation_data.action=None;tr=next(tr for tr in rig.animation_data.nla_tracks if tr.name==name);st=tr.strips[0];st.action=a;st.action_slot=a.slots[0];st.action_frame_start=0;st.action_frame_end=end;reports[name]={'rows':rows};print('ATTACK_V2',name,min(r['swordMinimumAfter']for r in rows),max(r['extraArmOrWristFloorCorrectionDegrees']for r in rows),flush=True)
scene.frame_set(0)
for b in bones:b.matrix_basis.identity()
bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);body.select_set(True);bpy.context.view_layer.objects.active=rig;dest=O+'/player-video-candidate-v3';bpy.ops.wm.save_as_mainfile(filepath=dest+'.blend')
for tr in rig.animation_data.nla_tracks:tr.mute=False
bpy.ops.export_scene.gltf(filepath=dest+'.glb',use_selection=True,export_format='GLB',export_animations=True,export_animation_mode='NLA_TRACKS',export_nla_strips=True,export_frame_range=False,export_force_sampling=True,export_skins=True,export_materials='EXPORT')
m=json.load(open(R+'/docs/player-combat-revision/player-video-candidate-v2-manifest.json'));m['asset']='assets/player-combat-revision/player-video-candidate-v3.glb';m['sha256']=hashlib.sha256(open(dest+'.glb','rb').read()).hexdigest();m['previousCandidateSha256']='7832539766fbf2d9e2429d1602e8921528e25803dd128fcf2b85a2b02763a3fb';m['clips']['light'].update(windup=.46,active=.26,recovery=.78,hitWindows=[[.49,.68]]);m['clips']['death']['source']='Retained death body with captured new-guard entry and physical sword-floor cleanup';m['reviewStatus']='v3 candidate; heavy blade descent synchronized to arm drop and temporally regularized; runtime/visual review pending';json.dump(m,open(R+'/docs/player-combat-revision/player-video-candidate-v3-manifest.json','w'),indent=2);json.dump(reports,open(R+'/docs/player-combat-revision/attack-v3-floor-correction-report.json','w'),indent=2)
