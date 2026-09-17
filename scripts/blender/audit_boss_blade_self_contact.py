"""Actual curved-blade edge intersections with evaluated character triangles."""
import bpy,os,sys,json,math
from mathutils import Vector
from mathutils.bvhtree import BVHTree
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'));TAG=os.environ.get('VESPER_BLADE_SELF_TAG','v75-slam-bounded-grip-review');sys.argv=['diagnostic','--','assets/combat-revision/boss/'+TAG+'/boss-combat-candidate.blend','slam','unused','assets/idle-video-motion/scythe-fitted.glb','2.85','1'];setup=open(os.path.join(ROOT,'scripts/blender/render_boss_combat_contactsheet.py')).read().split('# Neutral review lighting')[0];exec(compile(setup,'render_boss_combat_contactsheet.py','exec'));body=next(o for o in scene.objects if o.type=='MESH'and any(m.type=='ARMATURE'for m in o.modifiers));edges=[]
for p in props:
 vertices=[v.co.copy()for v in p.data.vertices]
 for edge in p.data.edges:
  a,b=[vertices[i]for i in edge.vertices]
  if min(a.z,b.z)>2.25 and min(a.x,b.x)>.20:edges.append((a,b))
rows=[]
for f in range(198):
 scene.frame_set(f);bpy.context.view_layer.update();wm=rig.matrix_world@rig.pose.bones['WeaponSocket'].matrix;ev=body.evaluated_get(bpy.context.evaluated_depsgraph_get());vertices=[body.matrix_world@v.co for v in ev.data.vertices];tree=BVHTree.FromPolygons(vertices,[p.vertices for p in ev.data.polygons],all_triangles=False);hits=[]
 for a,b in edges:
  A=wm@a;D=wm@b-A
  if D.length<1e-7:continue
  hit=tree.ray_cast(A,D.normalized(),D.length)
  if hit[0]is not None:hits.append({'point':list(hit[0]),'triangle':hit[2]})
 rows.append({'frame':f,'time':f/30,'intersectingEdges':len(hits),'example':hits[:1]})
 if hits:print('BLADE_BODY_CROSSING',f,len(hits),hits[0],flush=True)
json.dump({'asset':TAG,'testedEdges':len(edges),'scope':'Actual cutting-wing edge/weighted-body triangle intersections at30Hz; shaft contact excluded deliberately','samples':rows,'intersectingFrames':[r for r in rows if r['intersectingEdges']]},open(os.path.join(ROOT,'docs/combat-revision/boss-blade-self-'+TAG+'.json'),'w'),indent=2);print('BLADE_SELF_AUDIT_DONE',len(edges),'hits',sum(bool(r['intersectingEdges'])for r in rows),flush=True)
