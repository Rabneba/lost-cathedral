"""Compare one-step binding constraints with one shared dense proposal cloud."""
import os,sys,json,math,time
import numpy as np
from mathutils import Vector,Quaternion
from mathutils.bvhtree import BVHTree
sys.path.insert(0,os.path.dirname(__file__));import solve_boss_trajectory_beam as u
from boss_grip_constraints import solve_grip_pair,shaft_clearance,transported_previous_proposal
cases=[('slam',144,'boss-trajectory-v26-slam-whole.json',False),('slam',143,'boss-trajectory-v28-recovery-long.json',True),('sweep',15,'boss-trajectory-v24-sweep.json',False)]
result={}
for clip,f,file,reverse in cases:
 ref=u.META['clips'][clip][f];doc=json.load(open(os.path.join(u.ROOT,'docs/combat-revision',file)));prev=u.restore(doc['samplesReverse'][-1]if reverse else doc['clips'][clip]['samples'][f-1]);old=u.META['clips'][clip][f+1 if reverse else f-1];C0=Vector(ref['center']);Q0=Quaternion(ref['quaternion']);S0=ref['spacing'];arrays=np.load(os.path.join(u.DIR,clip+'.npz'));trees={n:BVHTree.FromPolygons(arrays['vertices'][f],faces,all_triangles=False)for n,faces in u.META['faces'].items()}
 props=u.basic_proposals(clip,f,u.META['clips'][clip],3000);t=transported_previous_proposal(C0,Q0,old['center'],old['quaternion'],prev);props+=[t,(prev['center'],prev['quaternion'],prev['spacing'])]
 for base,q,space in [t,(prev['center'],prev['quaternion'],prev['spacing'])]:
  for axis in [Vector((1,0,0)),Vector((0,1,0)),Vector((0,0,1))]:
   for turn in [-.21,-.14,-.07,0,.07,.14,.21]:
    for s in [.24,.28,.32,.36,.4,.44]:props.append((base,Quaternion(axis,turn)@q,s))
 arms={s:dict(a)for s,a in ref['arms'].items()}
 for s,a in arms.items():
  w=ref['sourceWeight'];base=a['bend_plane_degrees'];pg=prev['hands'][s]['bendPlaneDegrees'];a['bend_plane_candidates']=[base+w*g for g in [-45,-22.5,0,22.5,45]]+[max(base-45*w,min(base+45*w,pg+d))for d in [-7.5,0,7.5]]
 rows={};clearcache={}
 configs=[('base',32,.36,.24,12,.079,5),('bend45',45,.36,.24,12,.079,5),('cone30',32,math.radians(30),.24,12,.079,5),('center26',32,.36,.26,12,.079,5),('hand18',32,.36,.24,18,.079,5),('no_beta',32,.36,.24,12,.079,None),('no_elbow',32,.36,.24,12,None,5)]
 for name,bend,cone,center,hand,elbow,beta in configs:
  start=time.time();best=None;count=0
  for C,Q,S in props:
   if not .2<=S<=S0+.040001 or(C-C0).length>center+.000001 or u.angle(Q0,Q)>cone+.000001 or(C-prev['center']).length>.085001 or u.angle(prev['quaternion'],Q)>.220001:continue
   hands=solve_grip_pair(C,Q@Vector((0,0,1)),S,arms,prev['hands'],maximum_bend_degrees=bend,maximum_elbow_step=elbow,maximum_hand_angle_step=hand,maximum_bend_step_degrees=beta)
   if hands is None:continue
   key=u.proposal_key(C,Q,S)
   if key not in clearcache:clearcache[key]=shaft_clearance(C,Q,S,.6+(.4-.6)*ref['sourceWeight'],trees,u.sections,.015)
   gap=clearcache[key]
   if gap is None:continue
   count+=1;score=(C-C0).length_squared+.12*u.angle(Q0,Q)**2
   row={'center':C,'quaternion':Q,'axis':Q@Vector((0,0,1)),'spacing':S,'hands':hands,'minimumShaftSurfaceGap':gap,'score':score}
   if best is None or score<best['score']:best=row
  rows[name]={'feasible':count,'best':u.serial(best),'seconds':time.time()-start};print('BINDING',clip,f,name,count,flush=True)
 result[clip+'-'+str(f)]={'rows':rows,'previous':u.serial(prev)};json.dump(result,open(os.path.join(u.ROOT,'docs/combat-revision/boss-bridge-binding-diagnosis.json'),'w'),indent=2)
print('BINDING_COMPLETE',flush=True)
