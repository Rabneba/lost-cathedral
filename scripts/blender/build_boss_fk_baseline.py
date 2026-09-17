"""Diagnostic only: captured arm FK, no arm IK. Fit a separate rod to raw palms.
Weapon instability and raw grip collapse remain visible, not hidden by limb edits.
"""
import bpy,os,json,math
import numpy as np
from mathutils import Vector,Quaternion,Matrix
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'));TAG='v67-slam-captured-fk-baseline';OUT=os.path.join(ROOT,'assets/combat-revision/boss',TAG);os.makedirs(OUT,exist_ok=True);DIR=os.path.join(ROOT,'assets/combat-revision/boss/trajectory-context');meta=json.load(open(os.path.join(DIR,'context.json')));base=np.load(os.path.join(DIR,'slam.npz'))['poses'];bpy.ops.wm.open_mainfile(filepath=os.path.join(ROOT,'assets/combat-revision/boss/v62-slam-stable-quaternion-branch/boss-combat-candidate.blend'));scene=bpy.context.scene;rig=next(o for o in scene.objects if o.type=='ARMATURE');bones=rig.pose.bones;body=next(o for o in scene.objects if o.type=='MESH'and any(m.type=='ARMATURE'for m in o.modifiers));inv=rig.matrix_world.inverted();rig.animation_data.action=None
for t in rig.animation_data.nla_tracks:t.mute=True
def update():bpy.context.view_layer.update()
def P(n):return(rig.matrix_world@bones['mixamorig:'+n].matrix).translation.copy()
def grip(s):
 ps=[P(s+'Hand'+d+str(j))for d in ['Index','Middle','Ring','Pinky']for j in[1,3]]
 return sum(ps,Vector())*(.8/len(ps))+P(s+'HandThumb3')*.2
poses=[];rows=[];Q=Quaternion(meta['idleResult']['quaternion']);Z=Vector((0,0,1));lastA=Q@Z
for f,raw in enumerate(base):
 for n,m in zip(meta['bones'],raw):bones[n].matrix_basis=Matrix(m)
 update();left,right=grip('Left'),grip('Right');delta=left-right;separation=delta.length;A=delta.normalized()if separation>.01 else lastA.copy()
 if A.dot(lastA)<0:A.negate()
 Q=lastA.rotation_difference(A)@Q;Q.normalize();lastA=A.copy();rear=.6;bones['WeaponSocket'].matrix=inv@Matrix.LocRotScale(right-A*rear,Q,Vector((1,1,1)));update()
 if f in[0,len(base)-1]:
  for n,m in zip(meta['bones'],meta['idlePose']):bones[n].matrix_basis=Matrix(m)
  update()
 poses.append({p.name:p.matrix_basis.copy()for p in bones});rows.append({'frame':f,'t':f/30,'rawPalmSeparation':separation,'signedSpacing':delta.dot(A),'weaponAxis':list(A),'note':'arm FK unmodified; line fitting is diagnostic only'})
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
scene.frame_set(0);update();bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);body.select_set(True);bpy.context.view_layer.objects.active=rig;bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT,'boss-combat-candidate.blend'));bpy.ops.export_scene.gltf(filepath=os.path.join(OUT,'boss-combat-candidate.glb'),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='NLA_TRACKS',export_nla_strips=True,export_frame_range=False,export_force_sampling=True,export_def_bones=False);json.dump({'status':'DIAGNOSTIC ONLY, not combat-ready','method':'captured arms FK, weapon-only two-palm line fit with transported axial orientation','samples':rows},open(os.path.join(ROOT,'docs/combat-revision/boss-captured-fk-baseline.json'),'w'),indent=2);print('RAW_FK_BASELINE_READY',OUT,'minimumSeparation',min(r['rawPalmSeparation']for r in rows),flush=True)
