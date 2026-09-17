"""Spatially feasible full-body boundary poses; diagnostics, not accepted clips."""
import os,sys,json,math
import numpy as np
from mathutils import Vector,Quaternion
from mathutils.bvhtree import BVHTree
sys.path.insert(0,os.path.dirname(__file__))
import solve_boss_trajectory_beam as u
from boss_grip_constraints import solve_grip_pair,shaft_clearance
clip=os.environ.get('VESPER_SEED_CLIP','sweep');f=int(os.environ.get('VESPER_SEED_FRAME','18'));data=[dict(x)for x in u.META['clips'][clip]];ref=data[f];arrays=np.load(os.path.join(u.DIR,clip+'.npz'));trees={n:BVHTree.FromPolygons(arrays['vertices'][f],faces,all_triangles=False)for n,faces in u.META['faces'].items()};C0=Vector(ref['center']);Q0=Quaternion(ref['quaternion']);candidates=[]
arms={s:dict(a)for s,a in ref['arms'].items()}
for a in arms.values():a['bend_plane_candidates']=[-45,-22.5,0,22.5,45]
carry=os.environ.get('VESPER_SEED_CARRY')=='1';proposals=u.basic_proposals(clip,f,data,1500)
if carry:
 C0=(Vector(arms['Left']['shoulder'])+Vector(arms['Right']['shoulder']))*.5+Vector((.10,-.34,-.24));Q0=Quaternion(u.META['idleResult']['quaternion']);rng=np.random.default_rng(85412);proposals=[]
 for i in range(4000):
  C=C0+Vector(rng.normal(0,.07,3));Q=Quaternion(Vector((1,0,0)),float(rng.uniform(-.16,.16)))@Quaternion(Vector((0,0,1)),float(rng.uniform(-.16,.16)))@Q0;S=float(rng.uniform(.45,.75));proposals.append((C,Q,S))
for C,Q,S in proposals:
 if not .2<=S<=(.75 if carry else ref['spacing']+.04) or (C-C0).length>.24 or u.angle(Q0,Q)>.36:continue
 hands=solve_grip_pair(C,Q@Vector((0,0,1)),S,arms)
 if hands is None:continue
 gap=shaft_clearance(C,Q,S,.4,trees,u.sections,.015)
 if gap is None:continue
 cost=(C-C0).length_squared+.12*u.angle(Q0,Q)**2+.05*(S-(.6 if carry else ref['spacing']))**2+.000015*sum(h['bendDegrees']**2 for h in hands.values())
 candidates.append({'center':C,'quaternion':Q,'axis':Q@Vector((0,0,1)),'spacing':S,'hands':hands,'minimumShaftSurfaceGap':gap,'score':cost})
candidates.sort(key=lambda x:x['score']);seen=set();kept=[]
for c in candidates:
 key=u.diversity_key(c)
 if key in seen:continue
 seen.add(key);kept.append(c)
 if len(kept)>=60:break
out={'clip':clip,'frame':f,'candidates':u.serial(kept)};path=os.path.join(u.ROOT,'docs/combat-revision/boss-boundary-seeds-'+clip+'-'+str(f)+'.json');json.dump(out,open(path,'w'),indent=2);print('BOUNDARY_SEEDS',clip,f,len(kept),path,flush=True)
