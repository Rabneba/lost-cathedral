"""Bounded source-body close sweep solve, exact hands and actual prop constraints."""
import os,sys,json,math,time
import numpy as np
from mathutils import Vector,Quaternion
from mathutils.bvhtree import BVHTree
sys.path.insert(0,os.path.dirname(__file__));import solve_boss_trajectory_beam as u
from boss_grip_constraints import solve_grip_pair,shaft_clearance
SPATIAL=os.environ.get('VESPER_CLOSE_SPATIAL')=='1';TAG=os.environ.get('VESPER_CLOSE_TAG','v44-close-sweep');meta=u.META;data=meta['clips']['sweep'];arrays=np.load(os.path.join(u.DIR,'sweep.npz'));seed=json.load(open(os.path.join(u.ROOT,'docs/combat-revision/boss-front-sweep-84.json')))['best'][0];correction=Quaternion(data[84]['quaternion']).inverted()@Quaternion(seed['quaternion']);shift=Vector(seed['center'])-Vector(data[84]['center']);cloud=np.asarray(json.load(open(os.path.join(u.ROOT,'docs/combat-revision/scythe-socket-vertex-cloud.json')))['xyz']).reshape((-1,3));Z=Vector((0,0,1));idle=u.restore(meta['idleResult']);rows=[idle];started=time.time();last=int(os.environ.get('VESPER_CLOSE_LAST','125'));fail=None

FROM=int(os.environ.get('VESPER_CLOSE_FROM','0'))
REVERSE=int(os.environ.get('VESPER_CLOSE_REVERSE','0'))
SEED_PATH=os.environ.get('VESPER_CLOSE_SEED_PATH','');seedPath=json.load(open(SEED_PATH))['clips']['sweep']['samples']if SEED_PATH else None

def smooth(x):x=max(0,min(1,x));return x*x*(3-2*x)
if FROM:rows=[u.restore(r) for r in seedPath[:FROM+1]]
if REVERSE:rows=[u.restore(seedPath[REVERSE])]
for f in (range(REVERSE-1,-1,-1)if REVERSE else range(FROM+1,last+1)):
 ref=data[f];w=smooth(f/30)*(1-smooth((f-100)/70));Q0=Quaternion(ref['quaternion'])@Quaternion().slerp(correction,w);C0=Vector(ref['center'])+shift*w;Q0=idle['quaternion'].slerp(Q0,smooth(f/42));C0=idle['center'].lerp(C0,smooth(f/26));S0=.95+(.45-.95)*smooth(f/30);rear=.6+.2*smooth(f/36);prev=rows[-1];
 if seedPath:
  window=seedPath[max(0,f-5):min(len(seedPath),f+6)];C0=sum((Vector(x['center'])for x in window),Vector())/len(window);Q0=Quaternion(window[0]['quaternion'])
  for k,x in enumerate(window[1:],2):Q0=Q0.slerp(Quaternion(x['quaternion']),1/k)
  S0=sum(x['spacing']for x in window)/len(window)
 if seedPath and os.environ.get('VESPER_CLOSE_DIRECT_PREP')=='1' and f<40:
  prep=seedPath[40];t=smooth(f/40);C0=idle['center'].lerp(Vector(prep['center']),t);Q0=idle['quaternion'].slerp(Quaternion(prep['quaternion']),t);S0=.95+(prep['spacing']-.95)*t
 trees={n:BVHTree.FromPolygons(arrays['vertices'][f],faces,all_triangles=False)for n,faces in meta['faces'].items()};arms={s:dict(a)for s,a in ref['arms'].items()}
 for s,a in arms.items():
  a['bend_plane_candidates']=[-90,-60,-30,0,30,60,90,prev['hands'][s].get('bendPlaneDegrees',0)];a['captured_orientation_weight']=.03;a['across_weight']=smooth(f/40)
  if seedPath and os.environ.get('VESPER_CLOSE_DIRECT_PREP')=='1' and f<40:
   goal=seedPath[40]['hands'][s];a['captured_elbow']=idle['hands'][s]['elbow'].lerp(Vector(goal['elbow']),smooth(f/40));a['captured_long']=idle['hands'][s]['long'].lerp(Vector(goal['long']),smooth(f/40)).normalized();a['captured_normal']=idle['hands'][s]['normal'].lerp(Vector(goal['normal']),smooth(f/40)).normalized();a['captured_orientation_weight']=.20
 proposals=[(C0,Q0,S0),(prev['center'],prev['quaternion'],prev['spacing'])];rng=np.random.default_rng(7484+f)
 for i in range(512):
  near=i%3==0;C=(prev['center']if near else C0)+Vector(rng.normal(0,.026 if near else .14,3));Q=Quaternion(Vector((1,0,0)),float(rng.uniform(-.35,.35)))@Quaternion(Vector((0,1,0)),float(rng.uniform(-.35,.35)))@Quaternion(Vector((0,0,1)),float(rng.uniform(-.40,.40)))@(prev['quaternion']if near else Q0);S=float(np.clip((prev['spacing']if near else S0)+rng.uniform(-.03,.03),.30,.95));proposals.append((C,Q,S))
 best=None
 for C,Q,S in proposals:
  if not SPATIAL and ((C-prev['center']).length>.085 or u.angle(Q,prev['quaternion'])>math.radians(14 if f<45 or f>108 else 18)or abs(S-prev['spacing'])>.035):continue
  if (C-C0).length>.40 or u.angle(Q,Q0)>math.radians(55):continue
  hands=solve_grip_pair(C,Q@Z,S,arms,prev['hands'],maximum_bend_degrees=40,maximum_elbow_step=None if SPATIAL else .079,maximum_hand_angle_step=None if SPATIAL else 18,maximum_bend_step_degrees=None if SPATIAL else 8,enforce_signed_bend_step=False)
  if hands is None:continue
  gap=shaft_clearance(C,Q,S,rear,trees,u.sections,.015)
  if gap is None:continue
  origin=C-(Q@Z)*(rear+S*.5);R=np.asarray(Q.to_matrix());floor=float(np.min(cloud@R[2,:]+origin.z))
  if floor<.008:continue
  score=(5 if seedPath else 10)*(C-C0).length_squared+.8*u.angle(Q,Q0)**2+2*(S-S0)**2+.5*(C-prev['center']).length_squared+.12*u.angle(Q,prev['quaternion'])**2+sum(h['cost']for h in hands.values())*.04
  if best is None or score<best['score']:best={'center':C,'quaternion':Q,'axis':Q@Z,'spacing':S,'rear':rear,'hands':hands,'minimumShaftSurfaceGap':gap,'bladeFloor':floor,'score':score}
 if best is None:fail=f;print('CLOSE_SWEEP_BLOCKED',f,flush=True);break
 rows.append(best)
 if f%10==0:print('CLOSE_SWEEP_FRAME',f,'shift',round((best['center']-C0).length,3),'angle',round(math.degrees(u.angle(best['quaternion'],Q0)),1),'seconds',round(time.time()-started,1),flush=True)
if REVERSE:rows.reverse()
out={'reverseStart':REVERSE,'status':'complete'if fail is None and last==197 else'prefix diagnostic','rearTarget':.8,'scope':'source-body close sweep with bounded authored shaft correction, no production acceptance','clips':{'sweep':{'complete':fail is None and last==197,'samples':u.serial(rows)}},'blockedFrame':fail,'lastFrame':len(rows)-1};json.dump(out,open(os.path.join(u.ROOT,'docs/combat-revision/boss-trajectory-'+TAG+'.json'),'w'),indent=2);print('CLOSE_SWEEP_PATH_READY',len(rows),'blocked',fail,flush=True)
