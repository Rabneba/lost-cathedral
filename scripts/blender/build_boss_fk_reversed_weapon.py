"""Diagnostic only: captured arm FK, no arm IK. Fit a separate rod to raw palms.
Weapon instability and raw grip collapse remain visible, not hidden by limb edits.
"""
import bpy,os,json,math
import numpy as np
from mathutils import Vector,Quaternion,Matrix
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'));TAG='v72-slam-reversed-weapon-diagnostic';OUT=os.path.join(ROOT,'assets/combat-revision/boss',TAG);os.makedirs(OUT,exist_ok=True);DIR=os.path.join(ROOT,'assets/combat-revision/boss/trajectory-context');meta=json.load(open(os.path.join(DIR,'context.json')));base=np.load(os.path.join(DIR,'slam.npz'))['poses'];bpy.ops.wm.open_mainfile(filepath=os.path.join(ROOT,'assets/combat-revision/boss/v70-fk-wrist-limit/boss-combat-candidate.blend'));scene=bpy.context.scene;rig=next(o for o in scene.objects if o.type=='ARMATURE');bones=rig.pose.bones;body=next(o for o in scene.objects if o.type=='MESH'and any(m.type=='ARMATURE'for m in o.modifiers));inv=rig.matrix_world.inverted();rig.animation_data.action=None
for t in rig.animation_data.nla_tracks:t.mute=True
def update():bpy.context.view_layer.update()
def P(n):return(rig.matrix_world@bones['mixamorig:'+n].matrix).translation.copy()
def grip(s):
 ps=[P(s+'Hand'+d+str(j))for d in ['Index','Middle','Ring','Pinky']for j in[1,3]]
 return sum(ps,Vector())*(.8/len(ps))+P(s+'HandThumb3')*.2
poses=[];rows=[]
# Diagnostic constant orientation, including boundaries: carry match intentionally pending.
for t in rig.animation_data.nla_tracks:t.mute=t.name!='slam'
source=[]
for f in range(198):
 scene.frame_set(f);update();source.append({p.name:p.matrix_basis.copy()for p in bones})
for t in rig.animation_data.nla_tracks:t.mute=True
for f,raw in enumerate(source):
 for n,m in raw.items():bones[n].matrix_basis=m
 update();wm=rig.matrix_world@bones['WeaponSocket'].matrix
 transformed=wm@Matrix.Translation((0,0,.6))@Matrix.Rotation(math.pi,4,'Y')@Matrix.Rotation(math.radians(-105),4,'Z')@Matrix.Translation((0,0,-1.1))
 bones['WeaponSocket'].matrix=inv@transformed;update();poses.append({p.name:p.matrix_basis.copy()for p in bones});rows.append({'frame':f,'t':f/30,'weaponQuaternion':list(transformed.to_quaternion()),'origin':list(transformed.translation)})
for t in list(rig.animation_data.nla_tracks):
 if t.name=='slam':rig.animation_data.nla_tracks.remove(t)
action=bpy.data.actions.new(TAG+'-slam');rig.animation_data.action=action;previous={}
for f,p in enumerate(poses):
 for name,m in p.items():
  b=bones[name];loc,q,scale=m.decompose()
  if name in previous and previous[name].dot(q)<0:q.negate()
  previous[name]=q.copy();b.location=loc;b.rotation_quaternion=q;b.scale=scale
  for field in['location','rotation_quaternion','scale']:b.keyframe_insert(field,frame=f)
rig.animation_data.action=None;t=rig.animation_data.nla_tracks.new();t.name='slam';t.strips.new('slam',0,action)
for t in rig.animation_data.nla_tracks:t.mute=False
scene.frame_set(0);update();bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);body.select_set(True);bpy.context.view_layer.objects.active=rig;bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT,'boss-combat-candidate.blend'));bpy.ops.export_scene.gltf(filepath=os.path.join(OUT,'boss-combat-candidate.glb'),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='NLA_TRACKS',export_nla_strips=True,export_frame_range=False,export_force_sampling=True,export_def_bones=False);json.dump({'status':'DIAGNOSTIC ONLY, not combat-ready','method':'constant weapon-only reversal around existing primary palm; NEW main station1.1, secondary about.7; carry endpoint mismatch pending','samples':rows},open(os.path.join(ROOT,'docs/combat-revision/boss-reversed-weapon-v72.json'),'w'),indent=2);print('REVERSED_WEAPON_DIAGNOSTIC_READY',OUT,flush=True)
