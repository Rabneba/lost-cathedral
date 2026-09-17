"""Bounded static feasibility/range test for choke-up sweep grips."""
import os,sys,json,math,time
import numpy as np
from mathutils import Vector,Quaternion
from mathutils.bvhtree import BVHTree
sys.path.insert(0,os.path.dirname(__file__));import solve_boss_trajectory_beam as u
from boss_grip_constraints import solve_grip_pair,shaft_clearance
f=84;clip='sweep';ref=u.META['clips'][clip][f];C0=Vector(ref['center']);Q0=Quaternion(ref['quaternion']);arrays=np.load(os.path.join(u.DIR,clip+'.npz'));trees={n:BVHTree.FromPolygons(arrays['vertices'][f],faces,all_triangles=False)for n,faces in u.META['faces'].items()};cloud=np.asarray(json.load(open(os.path.join(u.ROOT,'docs/combat-revision/scythe-socket-vertex-cloud.json')))['xyz']).reshape((-1,3));blade=cloud[cloud[:,2]>2.25];out={'frame':f,'actorScale':1.3,'playerCapsuleRadius':.35,'scope':'static feasibility, not a continuous or accepted sweep','rears':{}}
rootSeeds=json.load(open(os.path.join(u.ROOT,'docs/combat-revision/boss-midshaft-cone-search-v6.json')))['frames']['sweep-84']['candidates'];began=time.time()
for rear in [.6,.8,1.,1.2,1.35]:
 rng=np.random.default_rng(59484);kept=[];n=0
 for i in range(1800):
  seed=rootSeeds[i%len(rootSeeds)];C=Vector(seed['center'])+Vector(rng.normal(0,.13,3));Q=Quaternion(Vector((1,0,0)),float(rng.uniform(-.3,.3)))@Quaternion(Vector((0,0,1)),float(rng.uniform(-.3,.3)))@Quaternion(seed['weaponQuaternion']);Q=Q@Quaternion(Vector((0,0,1)),float(rng.uniform(-.25,.25)));S=float(rng.uniform(.30,.55))
  if (C-C0).length>.42:continue
  arms={s:dict(a)for s,a in ref['arms'].items()}
  for a in arms.values():a['bend_plane_candidates']=[-90,-60,-30,0,30,60,90]
  hands=solve_grip_pair(C,Q@Vector((0,0,1)),S,arms,maximum_bend_degrees=40)
  if hands is None:continue
  gap=shaft_clearance(C,Q,S,rear,trees,u.sections,.015)
  if gap is None:continue
  origin=C-(Q@Vector((0,0,1)))*(rear+S*.5);R=np.asarray(Q.to_matrix());vertices=blade@R.T+np.asarray(origin)
  if np.min(vertices[:,2])<.005:continue
  n+=1;world=vertices*1.3;zerr=np.maximum(.45-world[:,2],np.maximum(world[:,2]-1.65,0));hits=[]
  for d in np.arange(1.2,3.51,.05):
   distance=np.sqrt(world[:,0]**2+(world[:,1]+d)**2+zerr*zerr)
   if np.min(distance)<=.35:hits.append(round(float(d),2))
  valid=world[(world[:,2]>=.45)&(world[:,2]<=1.65)]
  if not len(valid):continue
  radial=np.sqrt(valid[:,0]**2+valid[:,1]**2);closest=valid[int(np.argmin(radial))];minimumRange=float(np.min(radial));bearing=math.degrees(math.atan2(float(closest[0]),float(-closest[1])))
  score=abs(minimumRange-1.6)+(C-C0).length*.25+u.angle(Q,Q0)*.10
  kept.append({'center':C,'quaternion':Q,'axis':Q@Vector((0,0,1)),'spacing':S,'rear':rear,'hands':hands,'shaftGap':gap,'bladeFloor':float(np.min(vertices[:,2])),'frontPlayerDistances':hits,'minimumRadialBladeRange':minimumRange,'closestBladeBearingDegrees':bearing,'score':score})
 kept.sort(key=lambda p:p['score']);out['rears'][str(rear)]={'clearPoses':n,'frontContactPoses':len(kept),'best':u.serial(kept[:8])};json.dump(out,open(os.path.join(u.ROOT,'docs/combat-revision/boss-close-sweep-feasibility.json'),'w'),indent=2)
 print('CLOSE_SWEEP',rear,'clear',n,'frontContacts',len(kept),'range',kept[0]['frontPlayerDistances']if kept else None,'seconds',round(time.time()-began,1),flush=True)
