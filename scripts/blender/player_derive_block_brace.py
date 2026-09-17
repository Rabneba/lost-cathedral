"""A distinct defensive brace from the reviewed captured guard, no new motion.

Retain breathing and arm anatomy. Move the shield toward an incoming strike,
compress knees slightly against the same planted feet, and lean the torso.
Only the block action is replaced; all other actions remain untouched.
"""
import bpy,os,sys,json,hashlib,math,numpy as np
from mathutils import Matrix,Vector,Quaternion
R=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'));O=R+'/assets/player-combat-revision'
args=sys.argv[sys.argv.index('--')+1:];srcstem=args[0];deststem=args[1]
bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.open_mainfile(filepath=O+'/'+srcstem+'.blend');scene=bpy.context.scene;rig=next(o for o in scene.objects if o.type=='ARMATURE');body=next(o for o in scene.objects if o.type=='MESH'and not o.hide_render);bones=rig.pose.bones;inv=rig.matrix_world.inverted();actions={t.name:t.strips[0].action for t in rig.animation_data.nla_tracks};rig.animation_data.action=None
for tr in rig.animation_data.nla_tracks:tr.mute=True

def B(n):return bones['mixamorig:'+n]
def wm(b):return rig.matrix_world@b.matrix
def up():bpy.context.view_layer.update()
def setw(b,m):b.matrix=inv@m;up()
def cap():return {b.name:(b.location.copy(),b.rotation_quaternion.copy(),b.scale.copy())for b in bones}
def put(p):
 for n,(l,q,s)in p.items():bones[n].location=l;bones[n].rotation_quaternion=q;bones[n].scale=s
 up()
def pose(a,f):
 rig.animation_data.action=a;rig.animation_data.action_slot=a.slots[0];scene.frame_set(f);up();p=cap();rig.animation_data.action=None;put(p)
def aim(b,c,target):
 m=wm(b);q=(wm(c).translation-m.translation).rotation_difference(target-m.translation);setw(b,Matrix.LocRotScale(m.translation,q@m.to_quaternion(),m.to_scale()))
def solve(names,target,pole):
 a,b,c=[B(n)for n in names];p,e,w=[wm(x).translation for x in[a,b,c]];l1=(e-p).length;l2=(w-e).length;v=target-p;axis=v.normalized();d=min(l1+l2-.001,max(abs(l1-l2)+.001,v.length));along=(l1*l1-l2*l2+d*d)/(2*d);h=math.sqrt(max(0,l1*l1-along*along));bend=pole-p;bend-=axis*bend.dot(axis)
 if bend.length<.001:bend=Vector((0,-1,0))
 bend.normalize();aim(a,b,p+axis*along+bend*h);aim(b,c,target)
footgroups={g.index for g in body.vertex_groups if any(n in g.name for n in['Foot','ToeBase'])};footids=[v.index for v in body.data.vertices if sum(g.weight for g in v.groups if g.group in footgroups)>.5]
def minimum():
 ev=body.evaluated_get(bpy.context.evaluated_depsgraph_get());me=ev.to_mesh();low=min((ev.matrix_world@me.vertices[i].co).z for i in footids);ev.to_mesh_clear();return low
source=actions['idle'];end=round(source.frame_range[1]);samples=[];rows=[]
for f in range(end+1):
 pose(source,f);feet={s:wm(B(s+'Foot')).copy()for s in['Left','Right']};knees={s:wm(B(s+'Leg')).translation.copy()for s in feet};hand=wm(B('LeftHand')).copy();elbow=wm(B('LeftForeArm')).translation.copy();shieldOffset=hand.inverted()@wm(bones['ShieldSocket']);rightOffset=wm(B('RightHand')).inverted()@wm(bones['WeaponSocket'])
 hips=wm(B('Hips'));hips.translation+=Vector((0,-.02,-.03));setq=Quaternion((1,0,0),math.radians(3));setw(B('Hips'),Matrix.LocRotScale(hips.translation,setq@hips.to_quaternion(),hips.to_scale()))
 for side,m in feet.items():
  solve([side+'UpLeg',side+'Leg',side+'Foot'],m.translation,knees[side]);n=wm(B(side+'Foot'));setw(B(side+'Foot'),Matrix.LocRotScale(n.translation,m.to_quaternion(),n.to_scale()))
 target=hand.translation+Vector((0,-.12,.10));solve(['LeftArm','LeftForeArm','LeftHand'],target,elbow+Vector((.035,-.02,0)));m=wm(B('LeftHand'));setw(B('LeftHand'),Matrix.LocRotScale(m.translation,hand.to_quaternion(),m.to_scale()));setw(bones['ShieldSocket'],wm(B('LeftHand'))@shieldOffset);setw(bones['WeaponSocket'],wm(B('RightHand'))@rightOffset)
 low=minimum();m=wm(B('Hips'));m.translation.z+=.003-low;setw(B('Hips'),m)
 rows.append({'frame':f,'leftHandDisplacement':list(wm(B('LeftHand')).translation-hand.translation),'maxFootPositionError':max((wm(B(s+'Foot')).translation-feet[s].translation).length for s in feet),'soleMinimum':minimum()});samples.append(cap())
a=bpy.data.actions.new('video-defensive-block-brace');rig.animation_data.action=a;previous={}
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
a.use_fake_user=True;rig.animation_data.action=None;tr=next(t for t in rig.animation_data.nla_tracks if t.name=='block');st=tr.strips[0];st.action=a;st.action_slot=a.slots[0];st.action_frame_start=0;st.action_frame_end=end
scene.frame_set(0)
for b in bones:b.matrix_basis.identity()
bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);body.select_set(True);bpy.context.view_layer.objects.active=rig;dest=O+'/'+deststem;bpy.ops.wm.save_as_mainfile(filepath=dest+'.blend')
for tr in rig.animation_data.nla_tracks:tr.mute=False
bpy.ops.export_scene.gltf(filepath=dest+'.glb',use_selection=True,export_format='GLB',export_animations=True,export_animation_mode='NLA_TRACKS',export_nla_strips=True,export_frame_range=False,export_force_sampling=True,export_skins=True,export_materials='EXPORT')
m=json.load(open(R+'/docs/player-combat-revision/'+srcstem+'-manifest.json'));m['previousCandidateSha256']=m['sha256'];m['asset']='assets/player-combat-revision/'+deststem+'.glb';m['sha256']=hashlib.sha256(open(dest+'.glb','rb').read()).hexdigest();m['clips']['block']['source']='Reviewed guard-v2 video capture; separate defensive brace with shield12cm forward/10cm up, pelvis3cm lower and3degree lean, planted-foot correction';m['reviewStatus']='Candidate with distinct defensive block; actual skin and prop review pending';json.dump(m,open(R+'/docs/player-combat-revision/'+deststem+'-manifest.json','w'),indent=2);json.dump({'source':srcstem,'candidate':deststem,'rows':rows},open(R+'/docs/player-combat-revision/block-brace-report.json','w'),indent=2)
