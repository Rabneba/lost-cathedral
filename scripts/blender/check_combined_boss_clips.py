import bpy,os,json
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'));samples=[0,20,40,84,110,140,190,197];saved={};out={}
for tag,clips in [('v52-slam-continuous-lowered',['slam']),('v58-close-whole-clear',['sweep']),('v59-combat-review',['slam','sweep'])]:
 bpy.ops.wm.open_mainfile(filepath=os.path.join(ROOT,'assets/combat-revision/boss',tag,'boss-combat-candidate.blend'));rig=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE');rig.animation_data.action=None
 for clip in clips:
  for t in rig.animation_data.nla_tracks:t.mute=t.name!=clip
  values=[]
  for f in samples:
   bpy.context.scene.frame_set(f);bpy.context.view_layer.update();values.extend(float(x)for b in rig.pose.bones for row in b.matrix for x in row)
  if tag!='v59-combat-review':saved[clip]=values
  else:
   delta=max(abs(a-b)for a,b in zip(values,saved[clip]));out[clip]={'maxBoneMatrixDifference':delta,'frames':samples};assert delta<1e-7,(clip,delta)
json.dump(out,open(os.path.join(ROOT,'docs/combat-revision/boss-combined-v59-identity.json'),'w'),indent=2);print('COMBINED_IDENTITY_PASS',out,flush=True)
