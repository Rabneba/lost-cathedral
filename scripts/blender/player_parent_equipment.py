"""Attach rigid equipment sockets to wrist bones so subframe interpolation cannot separate them."""
import bpy,os,json
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'));bpy.ops.wm.open_mainfile(filepath=ROOT+'/assets/player-essential-motion/player-footfall-study.blend');scene=bpy.context.scene;rig=next(o for o in scene.objects if o.type=='ARMATURE');body=next(o for o in scene.objects if o.type=='MESH'and not o.hide_render);bones=rig.pose.bones;inv=rig.matrix_world.inverted();tracks=list(rig.animation_data.nla_tracks);pairs={'WeaponSocket':'mixamorig:RightHand','ShieldSocket':'mixamorig:LeftHand'}
for tr in tracks:tr.mute=True
idle=next(tr.strips[0].action for tr in tracks if tr.name=='idle');rig.animation_data.action=idle;rig.animation_data.action_slot=idle.slots[0];scene.frame_set(0);bpy.context.view_layer.update();offset={socket:(rig.matrix_world@bones[hand].matrix).inverted()@(rig.matrix_world@bones[socket].matrix)for socket,hand in pairs.items()}
rig.animation_data.action=None
for b in bones:b.matrix_basis.identity()
bpy.context.view_layer.update();bpy.context.view_layer.objects.active=rig;rig.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
for socket,hand in pairs.items():rig.data.edit_bones[socket].parent=rig.data.edit_bones[hand];rig.data.edit_bones[socket].use_connect=False
bpy.ops.object.mode_set(mode='OBJECT');bones=rig.pose.bones
report={}
for tr in tracks:
 a=tr.strips[0].action;end=a.frame_range[1];rig.animation_data.action=a;rig.animation_data.action_slot=a.slots[0];scene.frame_set(0);bpy.context.view_layer.update()
 for layer in a.layers:
  for strip in layer.strips:
   for bag in strip.channelbags:
    for fc in list(bag.fcurves):
     if any(('pose.bones["'+n+'"]')in fc.data_path for n in pairs):bag.fcurves.remove(fc)
 for socket,hand in pairs.items():
  b=bones[socket];b.matrix=inv@((rig.matrix_world@bones[hand].matrix)@offset[socket]);b.rotation_mode='QUATERNION';bpy.context.view_layer.update()
  for frame in [0,end]:b.keyframe_insert('location',frame=frame);b.keyframe_insert('rotation_quaternion',frame=frame);b.keyframe_insert('scale',frame=frame)
 report[tr.name]={'socketParents':pairs,'constantWristOffsets':True};print('PARENTED',tr.name,flush=True)
rig.animation_data.action=None
for b in bones:b.matrix_basis.identity()
for tr in tracks:tr.mute=False
bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);body.select_set(True);bpy.context.view_layer.objects.active=rig
bpy.ops.wm.save_as_mainfile(filepath=ROOT+'/assets/player-essential-motion/player-equipment-footfall-study.blend')
bpy.ops.export_scene.gltf(filepath=ROOT+'/assets/player-essential-motion/player-equipment-footfall-study.glb',export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='NLA_TRACKS',export_nla_strips=True,export_frame_range=False,export_force_sampling=True,export_def_bones=False)
json.dump(report,open(ROOT+'/docs/player-equipment-parenting.json','w'),indent=2);print('EQUIPMENT_PARENTING_COMPLETE',flush=True)
