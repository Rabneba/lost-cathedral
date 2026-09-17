"""Front-directed, actual-blade close sweep pose feasibility; no production edits."""
import os,sys,json,math,time
import numpy as np
from mathutils import Vector,Quaternion
from mathutils.bvhtree import BVHTree
sys.path.insert(0,os.path.dirname(__file__));import solve_boss_trajectory_beam as u
from boss_grip_constraints import solve_grip_pair,shaft_clearance
f=int(os.environ.get('VESPER_CLOSE_FRAME','84'));clip='sweep';ref=u.META['clips'][clip][f];arrays=np.load(os.path.join(u.DIR,clip+'.npz'));trees={n:BVHTree.FromPolygons(arrays['vertices'][f],faces,all_triangles=False)for n,faces in u.META['faces'].items()};cloud=np.asarray(json.load(open(os.path.join(u.ROOT,'docs/combat-revision/scythe-socket-vertex-cloud.json')))['xyz']).reshape((-1,3));blade=cloud[cloud[:,2]>2.25];seedRows=json.load(open(os.path.join(u.ROOT,'docs/combat-revision/boss-close-sweep-feasibility.json')))['rears']['0.8']['best'];rng=np.random.default_rng(44184);kept=[];began=time.time();counts={'proposals':0,'anatomy':0,'shaft':0,'floor':0,'front':0};dists=np.arange(1.3,2.81,.1)
for i in range(7000):
 seed=seedRows[i%len(seedRows)];yaw=float(rng.uniform(-1.5,-.15));turn=Quaternion(Vector((0,0,1)),yaw);C=turn@Vector(seed['center'])+Vector(rng.normal(0,.085,3));Q=turn@Quaternion(seed['quaternion']);Q=Quaternion(Vector((1,0,0)),float(rng.uniform(-.20,.20)))@Quaternion(Vector((0,1,0)),float(rng.uniform(-.20,.20)))@Q;Q=Q@Quaternion(Vector((0,0,1)),float(rng.uniform(-.2,.2)));S=float(rng.uniform(.32,.55));rear=.8
 counts['proposals']+=1;origin=C-(Q@Vector((0,0,1)))*(rear+S*.5);R=np.asarray(Q.to_matrix());vertices=blade@R.T+np.asarray(origin);world=vertices*1.3;zerr=np.maximum(.45-world[:,2],np.maximum(world[:,2]-1.65,0));hits=[];gaps=[]
 for d in dists:
  gap=float(np.min(np.sqrt(world[:,0]**2+(world[:,1]+d)**2+zerr*zerr)))-.35;gaps.append(gap)
  if gap<=0:hits.append(round(float(d),2))
 if not hits:continue
 counts['front']+=1
 if np.min(vertices[:,2])<.01:continue
 counts['floor']+=1
 arms={s:dict(a)for s,a in ref['arms'].items()}
 for a in arms.values():a['bend_plane_candidates']=[-90,-60,-30,0,30,60,90]
 hands=solve_grip_pair(C,Q@Vector((0,0,1)),S,arms,maximum_bend_degrees=40)
 if hands is None:continue
 counts['anatomy']+=1;gap=shaft_clearance(C,Q,S,rear,trees,u.sections,.015)
 if gap is None:continue
 counts['shaft']+=1;score=min(hits)+abs(S-.45)*.15+(C-Vector(ref['center'])).length*.05
 kept.append({'center':C,'quaternion':Q,'axis':Q@Vector((0,0,1)),'spacing':S,'rear':rear,'hands':hands,'shaftGap':gap,'bladeFloor':float(np.min(vertices[:,2])),'frontPlayerDistances':hits,'frontPlayerGaps':gaps,'score':score})
kept.sort(key=lambda p:p['score']);out={'frame':f,'counts':counts,'seconds':time.time()-began,'scope':'static actual blade versus front capsule at runtime scale1.3, not accepted animation','best':u.serial(kept[:30])};json.dump(out,open(os.path.join(u.ROOT,'docs/combat-revision/boss-front-sweep-'+str(f)+'.json'),'w'),indent=2);print('FRONT_SWEEP',counts,'best',kept[0]['frontPlayerDistances']if kept else None,'seconds',out['seconds'],flush=True)
