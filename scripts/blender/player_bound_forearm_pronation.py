"""V6 diagnostic: keep captured humerus/elbow and grasp; bound forearm pronation.

Optimize an anatomically bounded continuous pronation path against the prior
blade aim and physical sword floor, rather than forcing limb rotation to props.
"""
import bpy,os,json,math,hashlib,statistics,numpy as np
from mathutils import Vector,Quaternion,Matrix
R=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'));O=R+'/assets/player-combat-revision';bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.open_mainfile(filepath=O+'/player-video-candidate-v5.blend');scene=bpy.context.scene;rig=next(o for o in scene.objects if o.type=='ARMATURE');body=next(o for o in scene.objects if o.type=='MESH'and not o.hide_render);bones=rig.pose.bones;inv=rig.matrix_world.inverted();sources={tr.name:tr.strips[0].action for tr in rig.animation_data.nla_tracks}
for tr in rig.animation_data.nla_tracks:tr.mute=True
rig.animation_data.action=None
def B(n):return bones['mixamorig:'+n]
def wm(b):return rig.matrix_world@b.matrix
def up():bpy.context.view_layer.update()
def cap():return{b.name:(b.location.copy(),b.rotation_quaternion.copy(),b.scale.copy())for b in bones}
def put(p):
 for n,(l,q,s)in p.items():bones[n].location=l;bones[n].rotation_quaternion=q;bones[n].scale=s
 up()
def pose(a,f):
 rig.animation_data.action=a;rig.animation_data.action_slot=a.slots[0];scene.frame_set(f);up();p=cap();rig.animation_data.action=None;put(p);return p
before=set(scene.objects);bpy.ops.import_scene.gltf(filepath=R+'/assets/create-the-exact-isolated-player-sword-s-cmu12ngf.glb');objects=[o for o in scene.objects if o not in before];verts=[];rotation=Matrix.Rotation(-math.pi/2,4,'Z')@Matrix.Rotation(math.pi,4,'Y')
for o in objects:
 o.hide_render=True
 if o.type=='MESH':verts.extend((rotation@o.matrix_world)@v.co for v in o.data.vertices)
lo=Vector([min(v[i]for v in verts)for i in range(3)]);hi=Vector([max(v[i]for v in verts)for i in range(3)]);center=Vector(((lo.x+hi.x)/2,(lo.y+hi.y)/2,lo.z));verts=[(v-center)*1.28/(hi.z-lo.z)for v in verts];h=[v for v in verts if .08<v.z<.25];center=Vector((statistics.median(v.x for v in h),statistics.median(v.y for v in h),0));verts=np.array([v-center for v in verts]);audit=json.load(open(R+'/docs/player-combat-revision/player-upperarm-v5-audit.json'));report={}
for name in['light','heavy','hit']:
 source=sources[name];rows=audit['clips'][name]['rows'];poses=[];clouds=[];axes=[];origins=[];phis=np.array([r['Right']['geometricPronation']for r in rows]);sourcephi=np.array([r['Right']['sourceGeometricPronation']for r in rows]);grid=np.arange(-80,80.001,2);data=[]
 for f,row in enumerate(rows):
  poses.append(pose(source,f));elbow=wm(B('RightForeArm')).translation;axis=(wm(B('RightHand')).translation-elbow).normalized();m=np.array(wm(bones['WeaponSocket']));cloud=verts@m[:3,:3].T+m[:3,3]-np.array(elbow);clouds.append(cloud);axes.append(axis.copy());origins.append(elbow.copy());cost=[]
  for theta in grid:
   q=Quaternion(axis,math.radians(float(theta-phis[f])));rotation=np.array(q.to_matrix());low=float(np.min(cloud@rotation[2,:])+elbow.z);delta=math.radians(theta-phis[f]);v=6*(1-math.cos(delta))+.3*((theta-sourcephi[f])/90)**2+2500*(max(0,.025-low)/.1)**2;cost.append(v)
  data.append(cost)
 data=np.array(data);transition=.25*((grid[:,None]-grid[None,:])/10)**2
 # Match inherited guard boundaries while keeping the whole path continuous.
 data[0]+=((grid-phis[0])/2)**2*100;data[-1]+=((grid-phis[-1])/2)**2*100;dp=data[0].copy();backs=[]
 for f in range(1,len(rows)):
  z=dp[:,None]+transition;back=np.argmin(z,axis=0);dp=data[f]+z[back,np.arange(len(grid))];backs.append(back)
 index=int(np.argmin(dp));indices=[index]
 for back in reversed(backs):index=int(back[index]);indices.append(index)
 targets=grid[list(reversed(indices))];targets=np.convolve(np.pad(targets,(1,1),mode='edge'),np.array([.2,.6,.2]),mode='valid');targets[0]=phis[0];targets[-1]=phis[-1];samples=[];details=[]
 for f,theta in enumerate(targets):
  put(poses[f]);b=B('RightForeArm');m=wm(b);q=Quaternion(axes[f],math.radians(float(theta-phis[f])));b.matrix=inv@Matrix.LocRotScale(m.translation,q@m.to_quaternion(),m.to_scale());up();samples.append(cap());low=float(np.min(clouds[f]@np.array(q.to_matrix())[2,:])+origins[f].z);details.append({'frame':f,'time':f/30,'originalGeometricPronation':float(phis[f]),'targetGeometricPronation':float(theta),'swordMinimum':low})
 action=bpy.data.actions.new('anatomy-v6-'+name);rig.animation_data.action=action;previous={}
 for f,p in enumerate(samples):
  for n,(l,q,s)in p.items():
   q=q.copy()
   if n in previous and q.dot(previous[n])<0:q.negate()
   previous[n]=q.copy();b=bones[n];b.location=l;b.rotation_quaternion=q;b.scale=s;b.keyframe_insert('location',frame=f);b.keyframe_insert('rotation_quaternion',frame=f);b.keyframe_insert('scale',frame=f)
 for layer in action.layers:
  for strip in layer.strips:
   for bag in strip.channelbags:
    for fc in bag.fcurves:
     for k in fc.keyframe_points:k.interpolation='LINEAR'
 action.use_fake_user=True;rig.animation_data.action=None;tr=next(t for t in rig.animation_data.nla_tracks if t.name==name);st=tr.strips[0];st.action=action;st.action_slot=action.slots[0];st.action_frame_start=0;st.action_frame_end=len(rows)-1;report[name]={'rows':details,'minimumSword':min(r['swordMinimum']for r in details),'maxTargetStepDegrees':float(np.max(np.abs(np.diff(targets))))};print('V6',name,report[name]['minimumSword'],report[name]['maxTargetStepDegrees'],flush=True)
scene.frame_set(0)
for b in bones:b.matrix_basis.identity()
bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);body.select_set(True);bpy.context.view_layer.objects.active=rig;dest=O+'/player-video-candidate-v6';bpy.ops.wm.save_as_mainfile(filepath=dest+'.blend')
for tr in rig.animation_data.nla_tracks:tr.mute=False
bpy.ops.export_scene.gltf(filepath=dest+'.glb',use_selection=True,export_format='GLB',export_animations=True,export_animation_mode='NLA_TRACKS',export_nla_strips=True,export_frame_range=False,export_force_sampling=True,export_skins=True,export_materials='EXPORT')
m=json.load(open(R+'/docs/player-combat-revision/player-video-candidate-v5-manifest.json'));m['previousCandidateSha256']=m['sha256'];m['asset']='assets/player-combat-revision/player-video-candidate-v6.glb';m['sha256']=hashlib.sha256(open(dest+'.glb','rb').read()).hexdigest();m['reviewStatus']='V6 diagnostic candidate: bounded actual forearm pronation; changed blade world trajectory requires new contact/visual approval. Do not promote automatically.';json.dump(m,open(R+'/docs/player-combat-revision/player-video-candidate-v6-manifest.json','w'),indent=2);json.dump(report,open(R+'/docs/player-combat-revision/player-forearm-v6-report.json','w'),indent=2)
