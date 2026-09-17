"""Evaluated-mesh shaft/hood/torso diagnostics; no production mutations."""
import bpy, os, json, math, statistics
from mathutils import Matrix,Vector
from mathutils.bvhtree import BVHTree
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'))
TAG=os.environ.get('VESPER_CLEARANCE_TAG','v2')
PATH=os.environ.get('VESPER_CLEARANCE_BLEND','/tmp/vesper-boss-candidate-v2.blend')
STRIDE=max(1,int(os.environ.get('VESPER_CLEARANCE_STRIDE','2')))
bpy.ops.wm.open_mainfile(filepath=PATH)
scene=bpy.context.scene;rig=next(o for o in scene.objects if o.type=='ARMATURE')
body=next(o for o in scene.objects if o.type=='MESH'and any(m.type=='ARMATURE'for m in o.modifiers))
groups={g.index:g.name for g in body.vertex_groups}
regions={'hood':{'mixamorig:Head','mixamorig:Neck'},'torso':{'mixamorig:Hips','mixamorig:Spine','mixamorig:Spine1','mixamorig:Spine2'}}
mask={name:{v.index for v in body.data.vertices if sum(g.weight for g in v.groups if groups[g.group]in names)>.25}for name,names in regions.items()}
polygons={name:[list(p.vertices)for p in body.data.polygons if any(i in ids for i in p.vertices)]for name,ids in mask.items()}
before=set(scene.objects);bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT,'assets/idle-video-motion/scythe-fitted.glb'))
props=[o for o in scene.objects if o not in before and o.type=='MESH'];points=[]
for o in props:
 m=Matrix.Rotation(-math.pi/2,4,'Z')@o.matrix_world
 for v in o.data.vertices:v.co=m@v.co
 o.parent=None;o.matrix_world.identity();points.extend(v.co.copy()for v in o.data.vertices)
lo=Vector([min(p[i]for p in points)for i in range(3)]);hi=Vector([max(p[i]for p in points)for i in range(3)])
center=Vector(((lo.x+hi.x)/2,(lo.y+hi.y)/2,lo.z));scale=2.85/(hi.z-lo.z)
points=[(p-center)*scale for p in points]
grip=[p for p in points if .55<p.z<1.25];offset=Vector((statistics.median(p.x for p in grip),statistics.median(p.y for p in grip),0))
points=[p-offset for p in points]
sections=[]
for j in range(57):
 z=j*.04;cloud=[p for p in points if abs(p.z-z)<.03 and math.hypot(p.x,p.y)<.18]
 if len(cloud)<3:continue
 c=Vector((statistics.median(p.x for p in cloud),statistics.median(p.y for p in cloud),z))
 radius=max(math.hypot(p.x-c.x,p.y-c.y)for p in cloud)
 sections.append((c,radius))
result={'blend':PATH,'regionWeightThreshold':.25,'regionPolygons':{n:len(p)for n,p in polygons.items()},'shaftSections':[[list(c),r]for c,r in sections],'sampleStride':STRIDE,'clips':{}}
rig.animation_data.action=None
for t in rig.animation_data.nla_tracks:t.mute=True
for name in ['sweep','slam']:
 strip=next(t for t in rig.animation_data.nla_tracks if t.name==name).strips[0]
 rig.animation_data.action=strip.action;rig.animation_data.action_slot=strip.action_slot
 frames=sorted(set(range(round(strip.action_frame_start),round(strip.action_frame_end)+1,STRIDE))|{round(strip.action_frame_end),32,58,72})
 rows=[]
 for f in frames:
  scene.frame_set(f);bpy.context.view_layer.update()
  ev=body.evaluated_get(bpy.context.evaluated_depsgraph_get());vertices=[body.matrix_world@v.co for v in ev.data.vertices]
  wm=rig.matrix_world@rig.pose.bones['WeaponSocket'].matrix
  worldsections=[(wm@c,r)for c,r in sections];row={'frame':f,'time':f/30,'regions':{}}
  for region,faces in polygons.items():
   tree=BVHTree.FromPolygons(vertices,faces,all_triangles=False)
   best=None;crossings=0
   for i,(p,radius)in enumerate(worldsections):
    near=tree.find_nearest(p)
    if near[0]is not None:
     value=near[3]-radius
     if best is None or value<best[0]:best=(value,i,near[3],list(near[0]))
    if i:
     a=worldsections[i-1][0];d=p-a
     if d.length>1e-7 and tree.ray_cast(a,d.normalized(),d.length)[0]is not None:crossings+=1
   row['regions'][region]={'minimumConservativeSurfaceGap':best[0],'shaftZ':sections[best[1]][0].z,'centerDistance':best[2],'nearestBodyPoint':best[3],'centerlineSurfaceCrossings':crossings}
  rows.append(row)
 summary={}
 for region in regions:
  worst=min(rows,key=lambda r:r['regions'][region]['minimumConservativeSurfaceGap'])
  summary[region]={'minimumConservativeSurfaceGap':worst['regions'][region]['minimumConservativeSurfaceGap'],'worstTime':worst['time'],'worstFrame':worst['frame'],'centerlineCrossingFrames':[r['frame']for r in rows if r['regions'][region]['centerlineSurfaceCrossings']],'conservativeOverlapFrames':[r['frame']for r in rows if r['regions'][region]['minimumConservativeSurfaceGap']<0]}
 result['clips'][name]={'summary':summary,'samples':rows};print('CLEARANCE',name,json.dumps(summary),flush=True)
path=os.path.join(ROOT,'docs/combat-revision/boss-shaft-clearance-'+TAG+'.json');json.dump(result,open(path,'w'),indent=2)
print('CLEARANCE_WRITTEN',path,flush=True)
