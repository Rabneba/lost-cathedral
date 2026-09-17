"""Bounded spatial feasibility check for the pre-cut right-wrist bend family."""
import os,sys,json,math,time
import numpy as np
from mathutils import Vector,Quaternion
from mathutils.bvhtree import BVHTree
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'));sys.path.insert(0,os.path.dirname(__file__))
from boss_grip_constraints import solve_grip_pair,shaft_clearance
DIR=os.path.join(ROOT,'assets/combat-revision/boss/trajectory-context');meta=json.load(open(os.path.join(DIR,'context.json')));data=meta['clips']['slam'];vertices=np.load(os.path.join(DIR,'slam.npz'))['vertices']
sections=[(Vector(c),r)for c,r in meta['shaftSections']]
result={'scope':'spatial feasible preparatory poses only, not a path','rear':.4,'frames':{}}
for f in [55,60,64,66,68,70,72]:
 start=time.time();ref=data[f];C0=Vector(ref['center']);Q0=Quaternion(ref['quaternion']);A0=Q0@Vector((0,0,1));side=A0.cross(Vector((0,0,1)))
 if side.length<.05:side=A0.cross(Vector((1,0,0)))
 side.normalize();other=A0.cross(side).normalized();trees={n:BVHTree.FromPolygons(vertices[f],faces,all_triangles=False)for n,faces in meta['faces'].items()}
 arms={s:dict(a)for s,a in ref['arms'].items()}
 for s,a in arms.items():a['bend_plane_candidates']=[-45,-22.5,0,22.5,45];a['preferred_bend_degrees']=30 if s=='Left'else-32;a['preferred_bend_weight']=5
 rng=np.random.default_rng(13514);best=None;minimum=None;count=0;bound=-32+(74-f)*5
 for i in range(12000):
  C=C0+Vector(rng.normal(0,.12,3));angles=rng.uniform(-.26,.26,2);Q=Quaternion(side,float(angles[0]))@Quaternion(other,float(angles[1]))@Q0;S=float(rng.uniform(.20,.44))
  qangle=Q0.rotation_difference(Q).angle;qangle=min(qangle,2*math.pi-qangle)
  if (C-C0).length>.24 or qangle>.36:continue
  hands=solve_grip_pair(C,Q@Vector((0,0,1)),S,arms)
  if hands is None:continue
  beta=hands['Right']['bendDegrees']
  if beta>bound-2 and minimum is not None and beta>=minimum['beta']:continue
  score=(C-C0).length_squared+.12*qangle*qangle
  if best and beta<=bound-2 and score>=best['score']and beta>=minimum['beta']:continue
  gap=shaft_clearance(C,Q,S,.4,trees,sections,.015)
  if gap is None:continue
  count+=1
  row={'beta':beta,'score':score,'center':list(C),'quaternion':list(Q),'spacing':S,'centerShift':(C-C0).length,'angleDegrees':math.degrees(qangle),'gap':gap,'hands':{s:{k:(list(v)if isinstance(v,Vector)else v)for k,v in h.items()}for s,h in hands.items()}}
  if minimum is None or beta<minimum['beta']:minimum=row
  if beta<=bound-2 and (best is None or score<best['score']):best=row
 result['frames'][str(f)]={'requiredUpperBetaToReachFrame74':bound,'minimum':minimum,'bestPreparatoryPose':best,'clearUsefulCandidates':count,'seconds':time.time()-start}
 json.dump(result,open(os.path.join(ROOT,'docs/combat-revision/boss-preparation-range.json'),'w'),indent=2)
 print('PREPARATION',f,'bound',bound,'min',None if minimum is None else minimum['beta'],'best',None if best is None else{k:best[k]for k in ['beta','centerShift','angleDegrees','gap','spacing']},'seconds',round(time.time()-start,1),flush=True)
print('PREPARATION_RANGE_READY',flush=True)
