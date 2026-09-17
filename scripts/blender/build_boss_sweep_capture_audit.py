"""Actual evaluated sweep body / fitted whole-prop diagnostics, no mutations."""
import bpy,os,sys,json,math,statistics
import numpy as np
from mathutils import Matrix,Vector
from mathutils.bvhtree import BVHTree
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'))
tag=os.environ.get('VESPER_SWEEP_TAG','sweep-capture-natural-1')
path=os.path.join(ROOT,'assets/combat-revision/boss',tag,'boss-combat-candidate.blend')
bpy.ops.wm.open_mainfile(filepath=path);scene=bpy.context.scene;rig=next(o for o in scene.objects if o.type=='ARMATURE');body=next(o for o in scene.objects if o.type=='MESH'and any(m.type=='ARMATURE'for m in o.modifiers))
rig.animation_data.action=None
for t in rig.animation_data.nla_tracks:t.mute=t.name!='sweep'
before=set(scene.objects);bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT,'assets/idle-video-motion/scythe-fitted.glb'));props=[o for o in scene.objects if o not in before and o.type=='MESH'];points=[];edges=[]
for o in props:
 m=Matrix.Rotation(-math.pi/2,4,'Z')@o.matrix_world;start=len(points);points.extend(m@v.co for v in o.data.vertices);edges.extend((start+e.vertices[0],start+e.vertices[1])for e in o.data.edges)
lo=Vector([min(p[i]for p in points)for i in range(3)]);hi=Vector([max(p[i]for p in points)for i in range(3)]);center=Vector(((lo.x+hi.x)/2,(lo.y+hi.y)/2,lo.z));scale=2.85/(hi.z-lo.z);points=[(p-center)*scale for p in points];handle=[p for p in points if .55<p.z<1.25];offset=Vector((statistics.median(p.x for p in handle),statistics.median(p.y for p in handle),0));points=np.array([p-offset for p in points]);edges=np.array(edges)
groups={g.index:g.name for g in body.vertex_groups};region=[];faces=[]
for face in body.data.polygons:
 total={}
 for i in face.vertices:
  for g in body.data.vertices[i].groups:
   name=groups[g.group];total[name]=total.get(name,0)+g.weight
 dominant=max(total,key=total.get)
 # Grip-surface contact is intentional. Forearms/cuffs remain included.
 if 'Hand' in dominant:continue
 faces.append(tuple(face.vertices));region.append(dominant)
fps=int(os.environ.get('VESPER_SWEEP_AUDIT_FPS','60'));end=197/30;rows=[];allHits=0;worst=1e9;worstf=None
for fi in range(round(end*fps)+1):
 t=fi/fps;scene.frame_set(math.floor(t*30),subframe=t*30%1);bpy.context.view_layer.update();ev=body.evaluated_get(bpy.context.evaluated_depsgraph_get());verts=[body.matrix_world@v.co for v in ev.data.vertices];tree=BVHTree.FromPolygons(verts,faces,all_triangles=False)
 mat=np.array(rig.matrix_world@rig.pose.bones['WeaponSocket'].matrix);p=points@mat[:3,:3].T+mat[:3,3];low=float(p[:,2].min())
 if low<worst:worst=low;worstf=t
 v=np.array(verts);bmin=v.min(0);bmax=v.max(0);a=p[edges[:,0]];b=p[edges[:,1]];mask=np.all(np.maximum(a,b)>=bmin,axis=1)&np.all(np.minimum(a,b)<=bmax,axis=1);hits=[]
 for ei in np.flatnonzero(mask):
  x,y=Vector(a[ei]),Vector(b[ei]);d=y-x
  if d.length<1e-8:continue
  h=tree.ray_cast(x,d.normalized(),d.length)
  if h[0]is not None:hits.append({'edge':int(ei),'region':region[h[2]],'point':list(h[0])})
 allHits+=len(hits);rows.append({'time':t,'frame30':t*30,'wholePropFloor':low,'crossings':len(hits),'regions':sorted(set(h['region']for h in hits)),'examples':hits[:5]})
report={'asset':path,'sampleHz':fps,'method':'Full normalized scythe mesh edges against actual posed body triangles; hand-dominant triangles excluded only for intentional grasp. Forearms/cuffs, hood, torso, legs included. Discrete edge crossings do not prove complete solid non-overlap. Whole prop vertex floor minimum also recorded.','floorMinimum':worst,'floorWorstTime':worstf,'crossingFrames':sum(r['crossings']>0 for r in rows),'crossingCount':allHits,'samples':rows}
json.dump(report,open(os.path.join(ROOT,'docs/combat-revision',tag+'-selfcontact.json'),'w'),indent=2);print('SWEEP_ACTUAL_SURFACE',tag,'floor',worst,worstf,'crossingFrames',report['crossingFrames'],'count',allHits,flush=True)
