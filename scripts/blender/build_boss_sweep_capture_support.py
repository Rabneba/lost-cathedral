"""Actual heel/toe vertex support audit, independent of lowest-sole grounding."""
import bpy,os,json,math,numpy as np
from mathutils import Vector
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'));tag=os.environ.get('VESPER_SWEEP_TAG','sweep-capture-close-3');path=ROOT+'/assets/combat-revision/boss/'+tag+'/boss-combat-candidate.blend'
bpy.ops.wm.open_mainfile(filepath=path);scene=bpy.context.scene;rig=next(o for o in scene.objects if o.type=='ARMATURE');body=next(o for o in scene.objects if o.type=='MESH'and any(m.type=='ARMATURE'for m in o.modifiers));rig.animation_data.action=None
for t in rig.animation_data.nla_tracks:t.mute=t.name!='sweep'
def P(n):return(rig.matrix_world@rig.pose.bones['mixamorig:'+n].matrix).translation
def frame(f):scene.frame_set(f);bpy.context.view_layer.update()
frame(0);ev=body.evaluated_get(bpy.context.evaluated_depsgraph_get());v=np.array([ev.matrix_world@v.co for v in ev.data.vertices]);sets={}
for s in ['Left','Right']:
 groups={g.index for g in body.vertex_groups if s in g.name and any(x in g.name for x in ['Foot','ToeBase'])};ids=np.array([v.index for v in body.data.vertices if sum(g.weight for g in v.groups if g.group in groups)>=.5]);low=v[ids,2].min();sole=ids[v[ids,2]<low+.025];forward=P(s+'ToeBase')-P(s+'Foot');forward.z=0;forward.normalize();p=v[sole]@np.array(forward);a,b=np.quantile(p,[.3,.7]);sets[s]={'sole':ids,'heel':sole[p<=a],'toe':sole[p>=b]}
rows=[]
for f in range(198):
 frame(f);ev=body.evaluated_get(bpy.context.evaluated_depsgraph_get());v=np.array([ev.matrix_world@v.co for v in ev.data.vertices]);r={'frame':f,'time':f/30,'feet':{}}
 for s in sets:
  d=P(s+'ToeBase')-P(s+'Foot');r['feet'][s]={k:float(v[ids,2].min())for k,ids in sets[s].items()};r['feet'][s]['pitchDegrees']=math.degrees(math.atan2(d.z,math.hypot(d.x,d.y)));r['feet'][s]['ankle']=list(P(s+'Foot'));r['feet'][s]['toeBone']=list(P(s+'ToeBase'))
 rows.append(r)
active=[r for r in rows if 2.25<=r['time']<=2.85]
report={'asset':path,'coordinates':'Blender source metres; multiply clearances by1.3 for boss gameplay metres','method':'Heel/toe vertexIDs are calibrated from lowest2.5cm of actual weighted boot surface in approved idle, split into rear/front30% along accepted ankle-to-toe heading. Every frame evaluates those exact skinned vertices; not just ankle height or global minimum.','vertexCounts':{s:{k:len(ids)for k,ids in sets[s].items()}for s in sets},'activeWindow':[2.25,2.85],'activeFramesWithoutFlatSupport':[r['frame']for r in active if not any(max(r['feet'][s]['heel'],r['feet'][s]['toe'])<.035/1.3 for s in sets)],'rows':rows}
json.dump(report,open(ROOT+'/docs/combat-revision/'+tag+'-support.json','w'),indent=2);print('SWEEP_BOOT_SUPPORT',report['activeFramesWithoutFlatSupport'],flush=True)
for s in sets:
 print(s,'active',[(r['frame'],round(r['feet'][s]['heel']*1.3,3),round(r['feet'][s]['toe']*1.3,3),round(r['feet'][s]['pitchDegrees'],1))for r in active[::3]],flush=True)
