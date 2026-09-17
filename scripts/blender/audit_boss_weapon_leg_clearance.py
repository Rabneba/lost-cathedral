"""Whole fitted scythe versus actual evaluated thigh/calf/boot triangles at60Hz."""
import bpy,os,sys,json,math,hashlib
from mathutils import Vector
from mathutils.bvhtree import BVHTree
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'));TAG=os.environ.get('VESPER_LEG_CLEARANCE_TAG','v76-slam-foot-support');path='assets/combat-revision/boss/'+TAG+'/boss-combat-candidate.blend'
sys.argv=['diagnostic','--',path,'slam','unused','assets/idle-video-motion/scythe-fitted.glb','2.85','1'];setup=open(ROOT+'/scripts/blender/render_boss_combat_contactsheet.py').read().split('# Neutral review lighting')[0];exec(compile(setup,'render_boss_combat_contactsheet.py','exec'))
body=next(o for o in scene.objects if o.type=='MESH'and any(m.type=='ARMATURE'for m in o.modifiers));edges=[];prop_points=[]
for p in props:
 vertices=[v.co.copy()for v in p.data.vertices];prop_points.extend(vertices)
 for edge in p.data.edges:edges.append(tuple(vertices[i]for i in edge.vertices))
groups={g.index:g.name for g in body.vertex_groups};legnames={'mixamorig:'+s+n for s in ['Left','Right']for n in ['UpLeg','Leg','Foot','ToeBase']};ids={v.index for v in body.data.vertices if sum(g.weight for g in v.groups if groups[g.group]in legnames)>.25};faces=[list(p.vertices)for p in body.data.polygons if any(i in ids for i in p.vertices)]
rows=[]
for k in range(395):
 frame=k/2;scene.frame_set(int(frame),subframe=frame-int(frame));bpy.context.view_layer.update();wm=rig.matrix_world@rig.pose.bones['WeaponSocket'].matrix;ev=body.evaluated_get(bpy.context.evaluated_depsgraph_get());vertices=[body.matrix_world@v.co for v in ev.data.vertices];tree=BVHTree.FromPolygons(vertices,faces,all_triangles=False);hits=[]
 for a,b in edges:
  A=wm@a;D=wm@b-A
  if D.length<1e-7:continue
  hit=tree.ray_cast(A,D.normalized(),D.length)
  if hit[0]is not None:hits.append({'point':list(hit[0]),'triangle':hit[2]})
 points=[wm@p for p in prop_points];lowest=min(p.z for p in points);near=min((tree.find_nearest(p)[3]for p in points));rows.append({'frame':frame,'time':frame/30,'intersectingEdges':len(hits),'example':hits[:1],'minimumPropFloorAuthored':lowest,'minimumVertexToLegSurfaceAuthored':near})
 if hits:print('WEAPON_LEG_CROSSING',frame,len(hits),hits[0],flush=True)
 if k%60==0:print('WEAPON_LEG_PROGRESS',frame,'nearest',near,flush=True)
report={'asset':path,'testedPropEdges':len(edges),'testedPropVertices':len(prop_points),'legPolygons':len(faces),'scope':'All fitted scythe triangle edges versus evaluated thigh/calf/boot triangles;60Hz. Original hand-grip contact is excluded by body-region selection. Minimum vertex distances are unsigned, so crossings remain a separate check. Authored metres; runtime world multiply1.3.','minimumPropFloorAuthored':min(r['minimumPropFloorAuthored']for r in rows),'minimumVertexToLegSurfaceAuthored':min(r['minimumVertexToLegSurfaceAuthored']for r in rows),'samples':rows,'intersectingFrames':[r for r in rows if r['intersectingEdges']]}
json.dump(report,open(ROOT+'/docs/combat-revision/boss-weapon-legs-'+TAG+'.json','w'),indent=2);print('WEAPON_LEG_AUDIT_DONE',len(edges),'hits',len(report['intersectingFrames']),'nearest',report['minimumVertexToLegSurfaceAuthored'],'floor',report['minimumPropFloorAuthored'],flush=True)
