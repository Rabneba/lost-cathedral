"""Solve strike-to-preparation bridge backward with exact anatomical constraints."""
import os,sys,json,time,math
import numpy as np
from mathutils import Vector,Quaternion
from mathutils.bvhtree import BVHTree
sys.path.insert(0,os.path.dirname(__file__))
import solve_boss_trajectory_beam as u
from boss_grip_constraints import solve_grip_pair,shaft_clearance,transported_previous_proposal
TAG=os.environ.get('VESPER_BRIDGE_TAG','v22-backward-bridge');START=int(os.environ.get('VESPER_BRIDGE_START','74'));END=int(os.environ.get('VESPER_BRIDGE_END','55'))
WIDTH=int(os.environ.get('VESPER_BRIDGE_WIDTH','40'));clip=os.environ.get('VESPER_BRIDGE_CLIP','slam');data=[dict(x)for x in u.META['clips'][clip]];arrays=np.load(os.path.join(u.DIR,clip+'.npz'))
PROPOSALS=int(os.environ.get('VESPER_BRIDGE_PROPOSALS','256'))
CONE=math.radians(float(os.environ.get('VESPER_BRIDGE_CONE','20.6264806')))
for r in data:r['rearAnchor']=.6+(.4-.6)*r['sourceWeight']
prefixdoc=json.load(open(os.environ.get('VESPER_BRIDGE_PREFIX',os.path.join(u.ROOT,'docs/combat-revision/boss-trajectory-v21-prepared.json'))))
overrides=prefixdoc.get('referenceOverrides',{})
if clip in overrides:
 for f,r in enumerate(overrides[clip]):
  data[f].update(r);u.SEEDS[clip]['samples'][f]=dict(u.SEEDS[clip]['samples'][f],center=r['center'],referenceCenter=r['center'],weaponQuaternion=r['quaternion'],referenceQuaternion=r['quaternion'],spacing=r['spacing'])
anchors=u.static_nodes(clip,data,arrays)
if START==len(data)-1:anchors[START]=[u.restore(u.META['idleResult'])]
custom=os.environ.get('VESPER_BRIDGE_SEEDS','')
if custom:anchors[START]=[u.restore(p)for p in json.load(open(custom))['candidates']]
prefix=prefixdoc['clips'][clip]['samples']
goal=u.restore(prefix[END]);beam=[{'result':p,'path':[p],'cost':0.,'velocity':Vector(),'angularVelocity':Vector()}for p in anchors[START]]
OUT=os.path.join(u.ROOT,'docs/combat-revision/boss-trajectory-'+TAG+'.json');began=time.time()
def remaining(r,steps):
 req=[(r['center']-goal['center']).length/.085,u.angle(r['quaternion'],goal['quaternion'])/.22];energy=0
 for s in ['Left','Right']:
  a,b=r['hands'][s],goal['hands'][s];da=abs(a['bendDegrees']-b['bendDegrees']);dv=math.degrees(u.bend_vector_angle(a,b));ha=math.degrees(u.hand_angle(a,b))
  req.extend([(a['elbow']-b['elbow']).length/.079,da/5,dv/5,ha/18]);energy+=.001*(da*da+dv*dv)/max(1,steps)
 return float('inf')if max(req)>steps+.001 else energy
for f in range(START-1,END-1,-1):
 ref=data[f];C0=Vector(ref['center']);Q0=Quaternion(ref['quaternion']);S0=ref['spacing'];trees={n:BVHTree.FromPolygons(arrays['vertices'][f],faces,all_triangles=False)for n,faces in u.META['faces'].items()}
 common=u.basic_proposals(clip,f,data,PROPOSALS);nextbeam=[];cache={};nf=0
 for state in beam:
  prev=state['result']
  if f==END:
   if u.endpoint_edge(prev,goal,f+1):nextbeam.append({'result':goal,'path':state['path']+[goal],'cost':state['cost'],'rank':state['cost'],'velocity':goal['center']-prev['center'],'angularVelocity':u.angular_delta(prev['quaternion'],goal['quaternion'])})
   continue
  transported=transported_previous_proposal(C0,Q0,data[f+1]['center'],data[f+1]['quaternion'],prev)
  t=1/(f-END+1);lerp=(prev['center'].lerp(goal['center'],t),prev['quaternion'].slerp(goal['quaternion'],t),prev['spacing']+(goal['spacing']-prev['spacing'])*t)
  proposals=common+[transported,lerp,(prev['center'],prev['quaternion'],prev['spacing']),(prev['center']+state['velocity'],Quaternion(state['angularVelocity'].normalized(),state['angularVelocity'].length)@prev['quaternion']if state['angularVelocity'].length>1e-8 else prev['quaternion'],prev['spacing'])]
  for C,Q,S in [transported,lerp]:
   for ss in [.24,.28,.32,.36,.4,prev['spacing'],S]:proposals.append((C,Q,ss))
   for delta in [Vector((.02,0,0)),Vector((-.02,0,0)),Vector((0,.02,0)),Vector((0,-.02,0)),Vector((0,0,.02)),Vector((0,0,-.02))]:proposals.append((C+delta,Q,S))
   for axis in [Vector((1,0,0)),Vector((0,1,0)),Vector((0,0,1))]:
    for turn in [-.14,-.07,.07,.14]:
     proposals.append((C,Quaternion(axis,turn)@Q,S))
  seen=set()
  for C,Q,S in proposals:
   key=u.proposal_key(C,Q,S)
   if key in seen:continue
   seen.add(key)
   if not .2<=S<=S0+.040001 or (C-C0).length>.240001 or u.angle(Q0,Q)>CONE+.000001 or (C-prev['center']).length>.085001 or u.angle(prev['quaternion'],Q)>.220001:continue
   if key in cache and cache[key] is None:continue
   arms={s:dict(a)for s,a in ref['arms'].items()};guided={}
   for s,a in arms.items():
    base=a['bend_plane_degrees'];w=ref['sourceWeight'];pg=prev['hands'][s].get('bendPlaneDegrees',base);tg=goal['hands'][s].get('bendPlaneDegrees',base);dg=pg+(tg-pg)*t
    a['bend_plane_candidates']=[base+w*g for g in [-45,-22.5,0,22.5,45]]+[max(base-45*w,min(base+45*w,pg+d))for d in [-7.5,0,7.5]]+[dg]
    guided[s]=dict(a);guided[s]['preferred_bend_degrees']=prev['hands'][s]['bendDegrees']+(goal['hands'][s]['bendDegrees']-prev['hands'][s]['bendDegrees'])*t;guided[s]['preferred_bend_weight']=5
   for variant in [arms,guided]:
    hands=solve_grip_pair(C,Q@Vector((0,0,1)),S,variant,prev['hands'],maximum_bend_degrees=32,maximum_elbow_step=.079,maximum_hand_angle_step=18 if 50<=f+1<=92 else 12,maximum_bend_step_degrees=5)
    if hands is None:continue
    if key not in cache:cache[key]=shaft_clearance(C,Q,S,ref['rearAnchor'],trees,u.sections,.015)
    gap=cache[key]
    if gap is None:continue
    r={'center':C.copy(),'quaternion':Q.copy(),'axis':Q@Vector((0,0,1)),'spacing':S,'hands':hands,'minimumShaftSurfaceGap':gap,'score':0};look=remaining(r,f-END)
    if not math.isfinite(look):continue
    nf+=1;v=C-prev['center'];omega=u.angular_delta(prev['quaternion'],Q)
    cost=state['cost']+.35*((C-C0).length/.24)**2+.25*(u.angle(Q0,Q)/.36)**2+.08*((S-S0)/.2)**2+.08*((v-state['velocity']).length/.085)**2+.05*((omega-state['angularVelocity']).length/.22)**2+.025*sum((hands[s]['bendStepDegrees']/5)**2 for s in hands)
    nextbeam.append({'result':r,'path':state['path']+[r],'cost':cost,'rank':cost+look,'velocity':v,'angularVelocity':omega})
 nextbeam.sort(key=lambda s:s['rank']);kept=[];seen=set()
 for state in nextbeam:
  key=u.diversity_key(state['result'])
  if key in seen:continue
  seen.add(key);kept.append(state)
  if len(kept)>=WIDTH:break
 if not kept:
  out={'tag':TAG,'status':'blocked','blockedFrame':f,'startFrame':START,'endFrame':END,'samplesReverse':u.serial(beam[0]['path'])};json.dump(out,open(OUT,'w'),indent=2);print('BRIDGE_BLOCKED',f,'prior',len(beam),flush=True);sys.exit(2)
 beam=kept;print('BRIDGE',f,'states',len(beam),'feasible',nf,'seconds',round(time.time()-began,1),flush=True)
best=min(beam,key=lambda s:s['cost']);path=[u.restore(x)for x in prefix[:END]]+list(reversed(best['path']));complete=len(path)==len(data);out={'tag':TAG,'status':'complete'if complete else'partial-bridge','rearTarget':.4,'referenceOverrides':overrides,'clips':{clip:{'samples':u.serial(path),'complete':complete}}};json.dump(out,open(OUT,'w'),indent=2);print('BRIDGE_CONNECTED',END,START,'prefix',len(path),OUT,flush=True)
