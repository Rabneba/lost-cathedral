"""Review explicit video-to-motion on the approved player, preserving whole-body motion.

This trial does not replace production. It uses a fixed initial floor offset,
corrected anatomical sword grip, and constant grasp below captured wrists. No
arms/legs are posed to fabricated targets and no action timing is changed.
"""
import bpy, os, sys, json, math
from mathutils import Vector, Matrix, Quaternion
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'))
names=sys.argv[sys.argv.index('--')+1:] if '--'in sys.argv else ['light','heavy']
OUT=ROOT+'/assets/player-combat-revision'
bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.open_mainfile(filepath=ROOT+'/assets/production/player-essential.blend')
scene=bpy.context.scene;scene.render.fps=30
rig=next(o for o in scene.objects if o.type=='ARMATURE');body=next(o for o in scene.objects if o.type=='MESH'and not o.hide_render);bones=rig.pose.bones;inv=rig.matrix_world.inverted()
rig.animation_data.action=None
for tr in rig.animation_data.nla_tracks:tr.mute=tr.name!='idle'
scene.frame_set(0);bpy.context.view_layer.update()
finger={b.name:b.matrix_basis.copy()for b in bones if any(f in b.name for f in ['Thumb','Index','Middle','Ring','Pinky'])}
fit=json.load(open(ROOT+'/docs/player-combat-revision/candidate-grip/report.json'))['candidateFit']
def matrix(values):return Matrix([values[i:i+4]for i in range(0,16,4)])
weaponOffset=matrix(fit['weaponWristOffset'])
for n,v in fit['thumbMatrices'].items():finger['mixamorig:'+n]=matrix(v)
def wm(b):return rig.matrix_world@b.matrix
shieldOffset=wm(bones['mixamorig:LeftHand']).inverted()@wm(bones['ShieldSocket'])
for tr in rig.animation_data.nla_tracks:tr.mute=True
rig.animation_data.action=None
for b in bones:b.matrix_basis.identity();b.rotation_mode='QUATERNION'
bpy.context.view_layer.update();rests={b.name:wm(b).copy()for b in bones};targetscale=rig.matrix_world.to_scale()
footgroups={g.index for g in body.vertex_groups if any(n in g.name for n in ['Foot','ToeBase'])}
footverts=[v.index for v in body.data.vertices if sum(g.weight for g in v.groups if g.group in footgroups)>.5]
def floor():
 ev=body.evaluated_get(bpy.context.evaluated_depsgraph_get());me=ev.to_mesh();value=min((ev.matrix_world@me.vertices[i].co).z for i in footverts);ev.to_mesh_clear();return value
actions=[];reports={}
for name in names:
 before=set(scene.objects);bpy.ops.import_scene.gltf(filepath=OUT+'/raw-motion/'+name+'-source.glb');objects=[o for o in scene.objects if o not in before];source=next(o for o in objects if o.type=='ARMATURE')
 for o in objects:o.hide_render=True
 strip=source.animation_data.nla_tracks[0].strips[0];action=strip.action;first=strip.frame_start;end=round(strip.frame_end-strip.frame_start);duration=end/30
 sourceposes=[]
 source.animation_data.action=None
 for tr in source.animation_data.nla_tracks:tr.mute=True
 for b in source.pose.bones:b.matrix_basis.identity()
 bpy.context.view_layer.update();srrest={b.name:(source.matrix_world@b.matrix).copy()for b in source.pose.bones}
 scale=(rests['mixamorig:Hips'].translation-rests['mixamorig:LeftFoot'].translation).length/(srrest['mixamorig:Hips'].translation-srrest['mixamorig:LeftFoot'].translation).length
 # Blender's imported NLA strips remain inactive after clearing the active
 # action unless an action slot is explicitly selected. Evaluate it directly.
 basis={};basisReport={}
 childmap={'Hips':'Spine','Spine':'Spine1','Spine1':'Spine2','Spine2':'Neck','Neck':'Head',**{side+part:side+child for side in ['Left','Right']for part,child in [('Shoulder','Arm'),('Arm','ForeArm'),('ForeArm','Hand'),('UpLeg','Leg'),('Leg','Foot'),('Foot','ToeBase')]}}
 for parent,child in childmap.items():
  pn='mixamorig:'+parent;cn='mixamorig:'+child
  td=(bones[pn].bone.matrix_local.inverted()@bones[cn].bone.matrix_local).translation.normalized()
  sd=(source.pose.bones[pn].bone.matrix_local.inverted()@source.pose.bones[cn].bone.matrix_local).translation.normalized()
  q=td.rotation_difference(sd);basis[pn]=q;basisReport[parent]=math.degrees(q.angle)
 source.animation_data.action=action;source.animation_data.action_slot=action.slots[0]
 for f in range(end+1):
  scene.frame_set(int(first+f));bpy.context.view_layer.update();sourceposes.append({b.name:(source.matrix_world@b.matrix).copy()for b in source.pose.bones})
 source.animation_data.action=None
 # Video capture retains the camera-relative yaw. Normalize only the neutral
 # end-facing, leaving the captured windup, torso twist and full roll intact.
 left=sum((p['mixamorig:LeftUpLeg'].translation-p['mixamorig:RightUpLeg'].translation for p in sourceposes[-12:]),Vector())
 heading=-math.atan2(left.y,left.x);turn=Quaternion((0,0,1),heading)
 for p in sourceposes:
  for n,m in p.items():p[n]=Matrix.LocRotScale(turn@m.translation,turn@m.to_quaternion(),m.to_scale())
 samples=[];metrics=[];offset=None
 for f,p in enumerate(sourceposes):
  scene.frame_set(f)
  for b in bones:b.matrix_basis.identity()
  bpy.context.view_layer.update()
  for b in bones:
   if b.name not in p or b.name in finger:continue
   m=wm(b)
   if b.name=='mixamorig:Hips':m.translation=p[b.name].translation*scale
   b.matrix=inv@Matrix.LocRotScale(m.translation,p[b.name].to_quaternion()@basis.get(b.name,Quaternion()),targetscale);bpy.context.view_layer.update()
  if offset is None:offset=.003-floor()
  hip=bones['mixamorig:Hips'];m=wm(hip);m.translation.z+=offset;hip.matrix=inv@m
  for n,m in finger.items():bones[n].matrix_basis=m.copy()
  bpy.context.view_layer.update()
  bones['WeaponSocket'].matrix=inv@(wm(bones['mixamorig:RightHand'])@weaponOffset)
  bones['ShieldSocket'].matrix=inv@(wm(bones['mixamorig:LeftHand'])@shieldOffset);bpy.context.view_layer.update()
  samples.append({b.name:(b.location.copy(),b.rotation_quaternion.copy(),b.scale.copy())for b in bones})
  metrics.append({'frame':f,'floor':floor(),**{n:list(wm(bones['mixamorig:'+n]).translation)for n in ['Hips','LeftFoot','RightFoot','LeftHand','RightHand','Head']}})
 a=bpy.data.actions.new('video-trial-'+name);rig.animation_data.action=a
 for f,s in enumerate(samples):
  for n,(loc,rot,sc)in s.items():
   b=bones[n];b.location=loc;b.rotation_quaternion=rot;b.scale=sc;b.keyframe_insert('location',frame=f);b.keyframe_insert('rotation_quaternion',frame=f);b.keyframe_insert('scale',frame=f)
 a.use_fake_user=True;actions.append((name,a,end));rig.animation_data.action=None
 reports[name]={'restChildBasisCorrectionDegrees':basisReport,'headingNormalizationDegrees':math.degrees(heading),'duration':duration,'sourceFrameCount':len(sourceposes),'constantInitialFloorOffsetMeters':offset,'soleRangeMeters':[min(m['floor']for m in metrics),max(m['floor']for m in metrics)],'samples':metrics}
 print('VIDEO_TRIAL',name,duration,reports[name]['soleRangeMeters'],flush=True)
for tr in list(rig.animation_data.nla_tracks):rig.animation_data.nla_tracks.remove(tr)
for name,a,end in actions:
 tr=rig.animation_data.nla_tracks.new();tr.name=name;strip=tr.strips.new(name,0,a);strip.action_frame_start=0;strip.action_frame_end=end;tr.mute=True
bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);body.select_set(True);bpy.context.view_layer.objects.active=rig
scene.frame_start=0;scene.frame_end=max(e for _,_,e in actions);scene.frame_set(0)
for b in bones:b.matrix_basis.identity()
dest=OUT+'/player-video-retarget-trial'
bpy.ops.wm.save_as_mainfile(filepath=dest+'.blend')
for tr in rig.animation_data.nla_tracks:tr.mute=False
bpy.ops.export_scene.gltf(filepath=dest+'.glb',use_selection=True,export_format='GLB',export_animations=True,export_animation_mode='NLA_TRACKS',export_nla_strips=True,export_frame_range=False,export_force_sampling=True,export_skins=True,export_materials='EXPORT')
json.dump(reports,open(ROOT+'/docs/player-combat-revision/retarget-trial-report.json','w'),indent=2)
