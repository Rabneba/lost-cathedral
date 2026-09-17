"""Keep the real separate sword clear of the floor after lowering gait support.
Raise the carrying hand only as needed, preserve wrist rotation and rigid sockets.
"""
import bpy,os,json,math,statistics
from mathutils import Matrix,Vector
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'))
bpy.ops.wm.open_mainfile(filepath=ROOT+'/assets/player-essential-motion/player-sixteen-gait-support-study.blend')
scene=bpy.context.scene;rig=next(o for o in scene.objects if o.type=='ARMATURE');body=next(o for o in scene.objects if o.type=='MESH'and not o.hide_render);bones=rig.pose.bones;inv=rig.matrix_world.inverted()
for tr in rig.animation_data.nla_tracks:tr.mute=True
# Match actual runtime weapon normalization; this copy is not exported.
before=set(scene.objects);bpy.ops.import_scene.gltf(filepath=ROOT+'/assets/create-the-exact-isolated-player-sword-s-cmu12ngf.glb');props=[o for o in scene.objects if o not in before and o.type=='MESH'];verts=[]
rotation=Matrix.Rotation(-math.pi/2,4,'Z')@Matrix.Rotation(math.pi,4,'Y')
for o in props:
 matrix=rotation@o.matrix_world
 for v in o.data.vertices:v.co=matrix@v.co
 o.parent=None;o.matrix_world.identity();verts.extend(v.co.copy()for v in o.data.vertices);o.hide_render=True
lo=Vector([min(p[i]for p in verts)for i in range(3)]);hi=Vector([max(p[i]for p in verts)for i in range(3)]);center=Vector(((lo.x+hi.x)/2,(lo.y+hi.y)/2,lo.z));scale=1.28/(hi.z-lo.z)
for o in props:
 for v in o.data.vertices:v.co=(v.co-center)*scale
handle=[v.co for o in props for v in o.data.vertices if .08<v.co.z<.25];center=Vector((statistics.median(v.x for v in handle),statistics.median(v.y for v in handle),0))
for o in props:
 for v in o.data.vertices:v.co-=center
weapon=[v.co.copy()for o in props for v in o.data.vertices]
def update():bpy.context.view_layer.update()
def B(n):return bones['mixamorig:'+n]
def wm(b):return rig.matrix_world@b.matrix
def snapshot():return{b.name:(b.location.copy(),b.rotation_quaternion.copy(),b.scale.copy())for b in bones}
def restore(p):
 rig.animation_data.action=None
 for n,(l,q,s)in p.items():b=bones[n];b.location=l;b.rotation_quaternion=q;b.scale=s
 update()
def pose(a,f):
 rig.animation_data.action=a;rig.animation_data.action_slot=a.slots[0];scene.frame_set(f);update();p=snapshot();restore(p);return p

def setworld(b,m):b.matrix=inv@m;update()
def rotate(b,q):
 m=wm(b);setworld(b,Matrix.LocRotScale(m.translation,q@m.to_quaternion(),m.to_scale()))
def aim(a,b,p):
 o=wm(a).translation;v=wm(b).translation-o;target=p-o
 if min(v.length,target.length)>1e-6:rotate(a,v.normalized().rotation_difference(target.normalized()))
def raise_hand(rise):
 a,b,c=B('RightArm'),B('RightForeArm'),B('RightHand');pa,pb,pc=[wm(v).translation for v in [a,b,c]];q=wm(c).to_quaternion();target=pc+Vector((0,0,rise));l1=(pb-pa).length;l2=(pc-pb).length;axis=(target-pa).normalized();d=max(abs(l1-l2)+.00001,min((target-pa).length,l1+l2-.00001));along=(l1*l1+d*d-l2*l2)/(2*d);height=math.sqrt(max(0,l1*l1-along*along));plane=pb-pa;plane=(plane-axis*plane.dot(axis)).normalized();aim(a,b,pa+axis*along+plane*height);aim(b,c,target);m=wm(c);setworld(c,Matrix.LocRotScale(m.translation,q,m.to_scale()))
def clearance():
 m=wm(bones['WeaponSocket']);return min((m@v).z for v in weapon)
report={}
for tr in rig.animation_data.nla_tracks:
 if not tr.name.startswith(('run-','walk-')):continue
 a=tr.strips[0].action;end=round(a.frame_range[1]);raw=[];before=[]
 for f in range(end+1):raw.append(pose(a,f));before.append(clearance())
 rise=max(0,.07-min(before));samples=[];after=[]
 for f,p in enumerate(raw):restore(p);raise_hand(rise) if rise>0 else None;samples.append(snapshot());after.append(clearance())
 samples[-1]={n:(l.copy(),q.copy(),s.copy())for n,(l,q,s)in samples[0].items()}
 rig.animation_data.action=a;rig.animation_data.action_slot=a.slots[0];prev={}
 for f,p in enumerate(samples):
  for name,(l,q,s)in p.items():
   if name in prev and prev[name].dot(q)<0:q.negate()
   prev[name]=q.copy();b=bones[name];b.location=l;b.rotation_quaternion=q;b.scale=s;b.keyframe_insert('location',frame=f);b.keyframe_insert('rotation_quaternion',frame=f);b.keyframe_insert('scale',frame=f)
 rig.animation_data.action=None;report[tr.name]={'minimumSwordBefore':min(before),'minimumSwordAfter':min(after),'handRise':rise};print('SWORD CLEARANCE',tr.name,report[tr.name],flush=True)
rig.animation_data.action=None
for b in bones:b.matrix_basis.identity()
for tr in rig.animation_data.nla_tracks:tr.mute=False
bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);body.select_set(True);bpy.context.view_layer.objects.active=rig
bpy.ops.wm.save_as_mainfile(filepath=ROOT+'/assets/player-essential-motion/player-gait-support-final.blend')
bpy.ops.export_scene.gltf(filepath=ROOT+'/assets/player-essential-motion/player-gait-support-final.glb',export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='NLA_TRACKS',export_nla_strips=True,export_frame_range=False,export_force_sampling=True,export_def_bones=False)
json.dump(report,open(ROOT+'/docs/player-gait-weapon-clearance.json','w'),indent=2)
print('GAIT SUPPORT FINAL STAGE READY',flush=True)
