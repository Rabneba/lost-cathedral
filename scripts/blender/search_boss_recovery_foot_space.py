"""Read-only search: grounded right boot positions outside returning shaft envelope."""
import os, json, math
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'))
src=open(ROOT+'/scripts/blender/build_boss_slam_foot_support.py').read().split('samples=[];rows=[]')[0]
exec(compile(src,'build_boss_slam_foot_support.py','exec'))
from mathutils.bvhtree import BVHTree
groups={g.index:g.name for g in body.vertex_groups};legnames={'mixamorig:Right'+n for n in ['UpLeg','Leg','Foot','ToeBase']};ids={v.index for v in body.data.vertices if sum(g.weight for g in v.groups if groups[g.group]in legnames)>.25};faces=[list(p.vertices)for p in body.data.polygons if any(i in ids for i in p.vertices)]
meta=json.load(open(ROOT+'/assets/combat-revision/boss/trajectory-context/context.json'));sections=[(Vector(c),r)for c,r in meta['shaftSections']]
out=[]
for f in [150,155,159,162,165,168,171]:
 apply(raw[f]);H,K,A=[P(B('Right'+n))for n in ['UpLeg','Leg','Foot']];sourceAxis=(A-H).normalized();bend=K-H;bend-=sourceAxis*bend.dot(sourceAxis);pole=(sourceAxis,bend.normalized());roll=hinge_error('Right');wm=M(bones['WeaponSocket']).copy();worldsections=[(wm@c,r)for c,r in sections];Q=Quaternion(Z,yaws['Right'][180]-flat['Right']['direction'])@flat['Right']['rotation'];rows=[]
 for x in [-.45,-.3,-.18,-.10,.0,.10]:
  for y in [-.55,-.40,-.25,-.10,.05,.20,.30]:
   apply(raw[f]);fm=M(B('RightFoot'));setworld(B('RightFoot'),Matrix.LocRotScale(fm.translation,Q,fm.to_scale()));B('RightToeBase').matrix_basis=flat['Right']['toe'];update();target=Vector((x,y,P(B('RightFoot')).z-sole('Right')+.0004));ok,margin=solve_leg('Right',target,pole,roll)
   if not ok:continue
   fm=M(B('RightFoot'));setworld(B('RightFoot'),Matrix.LocRotScale(fm.translation,Q,fm.to_scale()));B('RightToeBase').matrix_basis=flat['Right']['toe'];update();ev=body.evaluated_get(bpy.context.evaluated_depsgraph_get());verts=[body.matrix_world@v.co for v in ev.data.vertices];tree=BVHTree.FromPolygons(verts,faces,all_triangles=False);gap=min(tree.find_nearest(p)[3]-r for p,r in worldsections);crossings=0
   for i in range(1,len(worldsections)):
    a=worldsections[i-1][0];d=worldsections[i][0]-a
    if tree.ray_cast(a,d.normalized(),d.length)[0]is not None:crossings+=1
   rows.append({'xy':[x,y],'gap':gap,'centerlineCrossings':crossings,'reachMargin':margin})
 safe=[r for r in rows if r['gap']>.012 and not r['centerlineCrossings']];print('FOOT_SPACE',f,'safe',safe,flush=True);out.append({'frame':f,'candidates':rows,'safe':safe})
json.dump(out,open(ROOT+'/docs/combat-revision/boss-recovery-foot-space.json','w'),indent=2)
