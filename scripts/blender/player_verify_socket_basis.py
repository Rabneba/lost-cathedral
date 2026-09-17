import bpy,json,os
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'));bpy.ops.wm.open_mainfile(filepath=ROOT+'/assets/player-essential-motion/player-gait-support-final.blend');rig=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE');rig.animation_data.action=None
for t in rig.animation_data.nla_tracks:t.mute=t.name!='run-forward'
bpy.context.scene.frame_set(0);bpy.context.view_layer.update();out={}
for n in ['WeaponSocket','ShieldSocket']:
 m=rig.matrix_world@rig.pose.bones[n].matrix;out[n]=[m[r][c]for c in range(4)for r in range(4)]
json.dump(out,open(ROOT+'/docs/player-socket-basis-blender.json','w'))
