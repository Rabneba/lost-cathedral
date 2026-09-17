import bpy,os,json,math
from mathutils import Vector
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'));TAG=os.environ.get('VESPER_REGRASP_TAG','v62-slam-stable-quaternion-branch');bpy.ops.wm.open_mainfile(filepath=os.path.join(ROOT,'assets/combat-revision/boss',TAG,'boss-combat-candidate.blend'));rig=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE');rig.animation_data.action=None
for t in rig.animation_data.nla_tracks:t.mute=t.name!='slam'
prev=None;rows=[]
for i in range(160*8,197*8+1):
 f=i/8;bpy.context.scene.frame_set(int(f),subframe=f%1);bpy.context.view_layer.update();r={'frame':f,'p':(rig.matrix_world@rig.pose.bones['mixamorig:LeftHand'].matrix).translation.copy(),'q':rig.pose.bones['mixamorig:LeftForeArm'].matrix_basis.to_quaternion()}
 if prev:
  q=prev['q'].rotation_difference(r['q']);angle=min(q.angle,2*math.pi-q.angle);rows.append({'frame':f,'handStep':(r['p']-prev['p']).length,'forearmStepDegrees':math.degrees(angle)})
 prev=r
result={'fps':240,'sourceFrames':[160,197],'maxHandStep':max(rows,key=lambda r:r['handStep']),'maxForearmStep':max(rows,key=lambda r:r['forearmStepDegrees'])};json.dump(result,open(os.path.join(ROOT,'docs/combat-revision/boss-regrasp-'+TAG+'.json'),'w'),indent=2);print('REGRASP_SUBFRAMES',result,flush=True)
