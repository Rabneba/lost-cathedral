"""Remove inherited locomotion end-pose drift smoothly over each cycle without adding clips."""
import bpy,os,math,json
from mathutils import Matrix,Quaternion
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'));bpy.ops.wm.open_mainfile(filepath=ROOT+'/assets/production/player-essential.blend');scene=bpy.context.scene;rig=next(o for o in scene.objects if o.type=='ARMATURE');bones=rig.pose.bones;body=next(o for o in scene.objects if o.type=='MESH' and not o.hide_render);inv=rig.matrix_world.inverted()
tracks=list(rig.animation_data.nla_tracks)
for t in tracks:t.mute=True

def update():bpy.context.view_layer.update()
def wm(n):return rig.matrix_world@bones[n].matrix
footgroups={g.index for g in body.vertex_groups if any(n in g.name for n in ['Foot','ToeBase'])};footverts=[v.index for v in body.data.vertices if sum(g.weight for g in v.groups if g.group in footgroups)>.5]
report={}
for track in tracks:
 if not track.name.startswith(('run-','walk-')):continue
 action=track.strips[0].action;end=round(action.frame_range[1]);raw=[];rig.animation_data.action=action;rig.animation_data.action_slot=action.slots[0]
 for f in range(end+1):
  scene.frame_set(f);update();raw.append({b.name:(b.location.copy(),b.rotation_quaternion.copy(),b.scale.copy())for b in bones})
 scene.frame_set(0);update();sw=wm('mixamorig:RightHand').inverted()@wm('WeaponSocket');sh=wm('mixamorig:LeftHand').inverted()@wm('ShieldSocket');rig.animation_data.action=None
 start,last=raw[0],raw[-1];corrected=[]
 for f,p in enumerate(raw):
  u=f/end
  for n,(loc,q,scl)in p.items():
   l0,q0,s0=start[n];le,qe,se=last[n];delta=q0@qe.inverted();fix=Quaternion().slerp(delta,u);b=bones[n];b.location=loc+(l0-le)*u;b.rotation_quaternion=fix@q;b.scale=scl+(s0-se)*u
  update();ev=body.evaluated_get(bpy.context.evaluated_depsgraph_get());mesh=ev.to_mesh();zs=sorted((ev.matrix_world@mesh.vertices[i].co).z for i in footverts);ev.to_mesh_clear();z=zs[int(len(zs)*.008)];hm=wm('mixamorig:Hips');hm.translation.z-=z-.003;bones['mixamorig:Hips'].matrix=inv@hm;update()
  bones['WeaponSocket'].matrix=inv@(wm('mixamorig:RightHand')@sw);bones['ShieldSocket'].matrix=inv@(wm('mixamorig:LeftHand')@sh);update()
  corrected.append({b.name:(b.location.copy(),b.rotation_quaternion.copy(),b.scale.copy())for b in bones})
 rig.animation_data.action=action;rig.animation_data.action_slot=action.slots[0]
 for f,p in enumerate(corrected):
  for n,(loc,q,scl)in p.items():
   b=bones[n];b.location=loc;b.rotation_quaternion=q;b.scale=scl;b.keyframe_insert('location',frame=f);b.keyframe_insert('rotation_quaternion',frame=f);b.keyframe_insert('scale',frame=f)
 report[track.name]={'maxOriginalEndpointRotationDegrees':max(start[n][1].rotation_difference(last[n][1]).angle*180/math.pi for n in start),'correction':'linear end-drift removal across the entire gait cycle, followed by sole grounding and wrist-relative sockets'};print('CLOSED',track.name,flush=True)
rig.animation_data.action=None
for b in bones:b.matrix_basis.identity()
for t in tracks:t.mute=False
bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);body.select_set(True);bpy.context.view_layer.objects.active=rig
bpy.ops.wm.save_as_mainfile(filepath=ROOT+'/assets/production/player-essential.blend')
bpy.ops.export_scene.gltf(filepath=ROOT+'/assets/production/player-essential.glb',export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='NLA_TRACKS',export_nla_strips=True,export_frame_range=False,export_force_sampling=True,export_def_bones=False)
json.dump(report,open(ROOT+'/docs/player-essential-gait-closure.json','w'),indent=2)
print('GAIT_LOOPS_CLOSED',flush=True)
