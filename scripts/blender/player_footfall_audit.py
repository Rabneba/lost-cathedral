"""Sample actual weighted boot surfaces and rig markers; include controller displacement."""
import bpy,json,os,math
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'));meta=json.load(open(ROOT+'/docs/player-essential-manifest.json'));report={}
for variant,path,fps in [('working','assets/player-essential-motion/player-working-before-footfall-review.blend',30),('original','assets/production/player-combat.blend',60),('refined','assets/player-essential-motion/player-footfall-study.blend',30)]:
 bpy.ops.wm.open_mainfile(filepath=ROOT+'/'+path);scene=bpy.context.scene;rig=next(o for o in scene.objects if o.type=='ARMATURE');body=next(o for o in scene.objects if o.type=='MESH' and not o.hide_render)
 for tr in rig.animation_data.nla_tracks:tr.mute=True
 sets={}
 for side in ['Left','Right']:
  groups={g.index for g in body.vertex_groups if side in g.name and any(s in g.name for s in ['Foot','ToeBase'])};sets[side]=[v.index for v in body.data.vertices if sum(g.weight for g in v.groups if g.group in groups)>.5]
 for name in ['run-forward','walk-forward','dodge']:
  action=bpy.data.actions.get(('armed_'+name) if variant=='original' and name!='dodge' else ('final_'+name if variant!='original' else name));rig.animation_data.action=action;rig.animation_data.action_slot=action.slots[0];duration=action.frame_range[1]/fps;frames=[]
  for i in range(121):
   t=duration*i/120;f=t*fps;scene.frame_set(int(f),subframe=f-int(f));bpy.context.view_layer.update();ev=body.evaluated_get(bpy.context.evaluated_depsgraph_get());mesh=ev.to_mesh();d={'t':t,'hip':list((rig.matrix_world@rig.pose.bones['mixamorig:Hips'].matrix).translation)}
   for side,ids in sets.items():
    pts=[ev.matrix_world@mesh.vertices[j].co for j in ids];pts.sort(key=lambda p:p.z);bottom=pts[max(0,int(len(pts)*.008))].z
    d[side]={'soleY':bottom,'ankle':list((rig.matrix_world@rig.pose.bones['mixamorig:'+side+'Foot'].matrix).translation),'toe':list((rig.matrix_world@rig.pose.bones['mixamorig:'+side+'ToeBase'].matrix).translation)}
   ev.to_mesh_clear();frames.append(d)
  report[variant+'-'+name]={'duration':duration,'frames':frames};print('AUDITED',variant,name,flush=True)
json.dump(report,open(ROOT+'/docs/player-footfall-audit.json','w'),indent=2)
