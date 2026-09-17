"""Bounded whole-clip beam over exact feasible rod/arm configurations.
Reads frozen body/reference context; writes a separate candidate trajectory JSON.
No Blender scene edits or production assets. All physical and temporal caps hard.
"""
import os,sys,json,math,time
import numpy as np
from mathutils import Vector,Quaternion,Matrix
from mathutils.bvhtree import BVHTree
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'))
sys.path.insert(0,os.path.dirname(__file__))
from boss_grip_constraints import solve_grip_pair,shaft_clearance,transported_previous_proposal
DIR=os.path.join(ROOT,'assets/combat-revision/boss/trajectory-context')
META=json.load(open(os.path.join(DIR,'context.json')))
SEEDS=json.load(open(os.path.join(ROOT,'docs/combat-revision/boss-candidate-bake-v11.json')))
TAG=os.environ.get('VESPER_TRAJECTORY_TAG','v13-beam')
CLIPS=os.environ.get('VESPER_TRAJECTORY_CLIPS','slam,sweep').split(',')
WIDTH=int(os.environ.get('VESPER_TRAJECTORY_WIDTH','24'))
COUNT=int(os.environ.get('VESPER_TRAJECTORY_PROPOSALS','128'))
GAMMA=os.environ.get('VESPER_TRAJECTORY_GAMMA')=='1'
REAR_TARGET=float(os.environ.get('VESPER_TRAJECTORY_REAR','.04'))
STROKE_BEND=float(os.environ.get('VESPER_TRAJECTORY_STROKE_BEND','32'))
STATIC_PATH=os.environ.get('VESPER_TRAJECTORY_STATIC_SEEDS','')
STATIC=json.load(open(STATIC_PATH))if STATIC_PATH else {'frames':{}}
ANCHORED=os.environ.get('VESPER_TRAJECTORY_ANCHORED')=='1'
PREFIX_PATH=os.environ.get('VESPER_TRAJECTORY_PREFIX','')
PREFIX=json.load(open(PREFIX_PATH))if PREFIX_PATH else {}
PREFIX_LENGTH=int(os.environ.get('VESPER_TRAJECTORY_PREFIX_LENGTH','41'))
LOCAL_CONE=math.radians(float(os.environ.get('VESPER_TRAJECTORY_LOCAL_CONE','20.6264806')))
SETTLE_FROM=int(os.environ.get('VESPER_TRAJECTORY_SETTLE_FROM','-1'))
SETTLE_DELAY=float(os.environ.get('VESPER_TRAJECTORY_SETTLE_DELAY','0'))
SETTLE_BEND=float(os.environ.get('VESPER_TRAJECTORY_SETTLE_BEND','32'))
CARRY_PATH=os.environ.get('VESPER_TRAJECTORY_CARRY_SEEDS','')
CARRY=json.load(open(CARRY_PATH))if CARRY_PATH else None
ADVISORY_SETTLE=os.environ.get('VESPER_TRAJECTORY_ADVISORY_SETTLE')=='1'
PREP_PATH=os.environ.get('VESPER_TRAJECTORY_PREP_SEEDS','')
PREP=json.load(open(PREP_PATH))if PREP_PATH else {'frames':{}}
OUT=os.path.join(ROOT,'docs/combat-revision/boss-trajectory-'+TAG+'.json')
sections=[(Vector(c),r)for c,r in META['shaftSections']]
limits={'center':.085,'weapon':.22,'elbow':.079,'handQuiet':12,'handStroke':18,'beta':5,'referenceCenter':.24,'referenceWeapon':.36,'clearance':.015}
def serial(v):
 if isinstance(v,dict):return {k:serial(x)for k,x in v.items()}
 if isinstance(v,(list,tuple)):return [serial(x)for x in v]
 if isinstance(v,(Vector,Quaternion)):return list(v)
 if isinstance(v,np.ndarray):return v.tolist()
 if isinstance(v,(np.floating,np.integer)):return v.item()
 return v
def restore(r):
 r=dict(r);r['center']=Vector(r['center']);r['quaternion']=Quaternion(r['quaternion']);r['axis']=r['quaternion']@Vector((0,0,1));r['hands']={s:dict(h)for s,h in r['hands'].items()}
 for h in r['hands'].values():
  for key in ['elbow','wrist','across','long','normal']:h[key]=Vector(h[key])
 return r
def angle(a,b):
 t=a.rotation_difference(b).angle;return min(t,2*math.pi-t)
def hand_angle(a,b):
 trace=a['across'].dot(b['across'])+a['long'].dot(b['long'])+a['normal'].dot(b['normal'])
 return math.acos(max(-1,min(1,(trace-1)/2)))
def angular_delta(a,b):
 q=b@a.inverted()
 if q.w<0:q.negate()
 return q.axis*q.angle

def endpoint_edge(prev,fixed,f):
 if (prev['center']-fixed['center']).length>limits['center']or angle(prev['quaternion'],fixed['quaternion'])>limits['weapon']:return False
 handcap=18 if 50<=f<=92 else 12
 for s in ['Left','Right']:
  a,b=prev['hands'][s],fixed['hands'][s]
  if (a['elbow']-b['elbow']).length>limits['elbow']or hand_angle(a,b)>math.radians(handcap):return False
  if not ADVISORY_SETTLE and abs(a['bendDegrees']-b['bendDegrees'])>5.0001:return False
  if bend_vector_angle(a,b)>math.radians(5.0001):return False
 return True

def bend_vector_angle(a,b):
 ba=math.radians(a['bendDegrees']);bb=math.radians(b['bendDegrees'])
 ga=math.radians(a.get('bendPlaneDegrees',0));gb=math.radians(b.get('bendPlaneDegrees',0))
 return math.acos(max(-1,min(1,math.cos(ba)*math.cos(bb)+math.sin(ba)*math.sin(bb)*math.cos(ga-gb))))

def static_nodes(clip,data,arrays):
 nodes={}
 selected=[74,134,150]if clip=='slam'else[84]
 for f in selected:
  entry=STATIC['frames'].get(clip+'-'+str(f))
  if not entry:continue
  ref=data[f];C0=Vector(ref['center']);Q0=Quaternion(ref['quaternion'])
  trees={n:BVHTree.FromPolygons(arrays['vertices'][f],faces,all_triangles=False)for n,faces in META['faces'].items()}
  nodes[f]=[]
  for c in entry['candidates']:
   C=Vector(c['center']);Q=Quaternion(c['weaponQuaternion']);S=c['spacing']
   if not .20<=S<=ref['spacing']+.040001 or (C-C0).length>.240001 or angle(Q0,Q)>.360001:continue
   gap=shaft_clearance(C,Q,S,ref['rearAnchor'],trees,sections,.015)
   if gap is None:continue
   hands={}
   for s,h in c['hands'].items():
    frame=Quaternion(h['quaternion'])@Quaternion(META['handFrames'][s])
    hands[s]={'elbow':Vector(h['elbow']),'wrist':Vector(h['wrist']),'across':frame@Vector((1,0,0)),'long':frame@Vector((0,1,0)),'normal':frame@Vector((0,0,1)),'bendDegrees':h['beta'],'bendPlaneDegrees':0,'cost':0}
   nodes[f].append({'center':C,'quaternion':Q,'axis':Q@Vector((0,0,1)),'spacing':S,'hands':hands,'minimumShaftSurfaceGap':gap,'score':0})
  if not nodes[f]:raise RuntimeError('No current-geometry static anchor at '+clip+' '+str(f))
 if clip=='slam':
  for f in [int(v)for v in os.environ.get('VESPER_TRAJECTORY_PREP_FRAMES','55,60,64,66').split(',')if v]:
   entry=PREP['frames'].get(str(f))
   if not entry:continue
   p=entry['bestPreparatoryPose'];C=Vector(p['center']);Q=Quaternion(p['quaternion']);S=p['spacing']
   ref=data[f];trees={n:BVHTree.FromPolygons(arrays['vertices'][f],faces,all_triangles=False)for n,faces in META['faces'].items()}
   gap=shaft_clearance(C,Q,S,ref['rearAnchor'],trees,sections,.015)
   if gap is None:raise RuntimeError('Preparatory anchor lost clearance '+str(f))
   h=restore({'center':list(C),'quaternion':list(Q),'spacing':S,'hands':p['hands']})['hands']
   nodes[f]=[{'center':C,'quaternion':Q,'axis':Q@Vector((0,0,1)),'spacing':S,'hands':h,'minimumShaftSurfaceGap':gap,'score':0}]
 return nodes

def future_cost(r,f,anchors):
 future=next((k for k in sorted(anchors)if k>f),None)
 if future is None or future-f>(80 if SETTLE_FROM>=0 and f>=SETTLE_FROM else 32):return 0.0
 steps=future-f;best=float('inf')
 for target in anchors[future]:
  required=[(r['center']-target['center']).length/.085,angle(r['quaternion'],target['quaternion'])/.22]
  for s in ['Left','Right']:
   a,b=r['hands'][s],target['hands'][s]
   required.extend([(a['elbow']-b['elbow']).length/.079,hand_angle(a,b)/math.radians(18 if 50<=future<=92 else 12),bend_vector_angle(a,b)/math.radians(5)])
   if not ADVISORY_SETTLE:required.append(abs(a['bendDegrees']-b['bendDegrees'])/5)
  need=max(required)
  if need>steps+.001:continue
  # Cauchy lower bound for the sum of squared beta increments. This rewards
  # gradual preparation now, rather than waiting until the reachability cone
  # is about to close and then demanding a maximum-speed correction.
  energy=.001*sum((math.degrees(bend_vector_angle(r['hands'][s],target['hands'][s]))if ADVISORY_SETTLE else r['hands'][s]['bendDegrees']-target['hands'][s]['bendDegrees'])**2 for s in ['Left','Right'])/steps
  best=min(best,.03*(need/max(1,steps))**2+energy)
 return best

def proposal_key(C,Q,S):
 if Q.w<0:Q=-Q
 return tuple(round(float(v),6)for v in list(C)+list(Q)+[S])
def diversity_key(r):
 q=r['quaternion'];q=q if q.w>=0 else-q
 values=[round(v/.018)for v in r['center']]+[round(v/.018)for v in q]+[round(r['spacing']/.025)]
 for h in r['hands'].values():values.extend([round(h['bendDegrees']/3)]+[round(v/.025)for v in h['elbow']])
 return tuple(values)

def basic_proposals(clip,f,data,count):
 ref=data[f];C=Vector(ref['center']);Q=Quaternion(ref['quaternion']);S=ref['spacing'];rows=SEEDS[clip]['samples'];r=rows[f]
 actual=(Vector(r['center']),Quaternion(r['weaponQuaternion']),r['spacing']);proposals=[(C,Q,S),actual]
 for space in [.24,.28,.32,.36,.4,min(.46,S),S]:proposals.extend([(C,Q,space),(actual[0],actual[1],space)])
 A=Q@Vector((0,0,1))
 for slide in [-.16,-.12,-.08,-.04,.04,.08,.12,.16]:
  for space in [.28,.36,.4]:proposals.append((C+A*slide,Q,space))
 for offset in [-10,-6,-3,3,6,10]:
  other=rows[max(0,min(len(rows)-1,f+offset))]
  shift=Vector(other['center'])-Vector(other['referenceCenter'])
  correction=Quaternion(other['referenceQuaternion']).inverted()@Quaternion(other['weaponQuaternion'])
  proposals.append((C+shift,Q@correction,min(S+.04,other['spacing'])))
 for label,entry in STATIC['frames'].items():
  anchor_clip,anchor_frame=label.rsplit('-',1);anchor_frame=int(anchor_frame)
  if anchor_clip!=clip or abs(anchor_frame-f)>40:continue
  anchor=data[anchor_frame]
  for candidate in entry['candidates']:
   shift=Vector(candidate['center'])-Vector(anchor['center'])
   correction=Quaternion(anchor['quaternion']).inverted()@Quaternion(candidate['weaponQuaternion'])
   proposals.append((C+shift,Q@correction,candidate['spacing']))
 window=rows[max(0,f-3):min(len(rows),f+4)]
 smC=sum((Vector(x['center'])for x in window),Vector())/len(window)
 smQ=Quaternion(window[0]['weaponQuaternion'])
 for j,x in enumerate(window[1:],2):smQ=smQ.slerp(Quaternion(x['weaponQuaternion']),1/j)
 smS=sum(x['spacing']for x in window)/len(window);proposals.append((smC,smQ,smS))
 A=Q@Vector((0,0,1));side=A.cross(Vector((0,0,1)))
 if side.length<.05:side=A.cross(Vector((1,0,0)))
 side.normalize();other=A.cross(side).normalized();rng=np.random.default_rng(80815)
 for i in range(count):
  if i%3==0:base,orientation,spread,angular=C,Q,.08,.19
  elif i%3==1:base,orientation,spread,angular=smC,smQ,.035,.085
  else:base,orientation,spread,angular=actual[0],actual[1],.025,.07
  shift=Vector(rng.normal(0,spread,3));a=rng.uniform(-angular,angular,2)
  cq=Quaternion(side,float(a[0]))@Quaternion(other,float(a[1]))@orientation
  proposals.append((base+shift,cq,float(rng.uniform(.20,min(.50,S+.04)))))
 return proposals

def author_settle_reference(clip,data,start):
 """Keep captured body; guide the hands through a torso-relative safe carry."""
 def torso(ref):
  left=Vector(ref['arms']['Left']['shoulder']);right=Vector(ref['arms']['Right']['shoulder'])
  side=(right-left).normalized();up=Vector((0,0,1));forward=side.cross(up).normalized();up=forward.cross(side).normalized()
  return (left+right)*.5,Matrix((side,forward,up)).transposed().to_quaternion()
 end=len(data)-1;idle=restore(META['idleResult']);s=restore(PREFIX['clips'][clip]['samples'][start]);nodes=[(start,s),(end,idle)]
 if CARRY and CARRY['clip']==clip:nodes.insert(1,(CARRY['frame'],restore(CARRY['candidates'][0])))
 for f in range(start,end+1):
  j=next((i for i in range(len(nodes)-1)if nodes[i][0]<=f<=nodes[i+1][0]),len(nodes)-2)
  fa,a=nodes[j];fb,b=nodes[j+1];ca,qa=torso(data[fa]);cb,qb=torso(data[fb]);t=(f-fa)/max(1,fb-fa)
  delayed=max(0,min(1,(t-SETTLE_DELAY)/max(.01,1-SETTLE_DELAY)));w=delayed*delayed*(3-2*delayed)
  c,q=torso(data[f]);localCa=qa.inverted()@(a['center']-ca);localCb=qb.inverted()@(b['center']-cb)
  C=c+q@localCa.lerp(localCb,w);Q=q@(qa.inverted()@a['quaternion']).slerp(qb.inverted()@b['quaternion'],w);spacing=a['spacing']+(b['spacing']-a['spacing'])*w
  forward=q@Vector((0,1,0));idleForward=idle['center']-torso(data[end])[0];sign=1 if forward.dot(idleForward)>0 else-1
  C+=forward*(sign*(.025 if CARRY else .10)*math.sin(math.pi*t))
  data[f]['center']=list(C);data[f]['quaternion']=list(Q);data[f]['spacing']=spacing
  data[f]['arms']={side:dict(arm)for side,arm in data[f]['arms'].items()}
  for side,arm in data[f]['arms'].items():
   for key,field in [('captured_elbow','elbow'),('captured_wrist','wrist')]:
    a0=qa.inverted()@(a['hands'][side][field]-ca);a1=qb.inverted()@(b['hands'][side][field]-cb);arm[key]=list(c+q@a0.lerp(a1,w))
   arm['captured_orientation_weight']=.025
  SEEDS[clip]['samples'][f]=dict(SEEDS[clip]['samples'][f],center=list(C),referenceCenter=list(C),weaponQuaternion=list(Q),referenceQuaternion=list(Q),spacing=spacing)

def run():
 result={'tag':TAG,'limits':limits,'localReferenceConeDegrees':math.degrees(LOCAL_CONE),'settleFromFrame':SETTLE_FROM,'prefixPath':PREFIX_PATH,'rearTarget':REAR_TARGET,'gammaFamily':GAMMA,'strokeBendMaximum':STROKE_BEND,'clips':{},'status':'running'}
 for clip in CLIPS:
  began=time.time();data=[dict(r)for r in META['clips'][clip]];arrays=np.load(os.path.join(DIR,clip+'.npz'))
  for r in data:r['rearAnchor']=.6+(REAR_TARGET-.6)*r['sourceWeight']
  if SETTLE_FROM>=0 and clip in PREFIX.get('clips',{}):
   author_settle_reference(clip,data,SETTLE_FROM)
   result.setdefault('referenceOverrides',{})[clip]=[{k:r[k]for k in ['center','quaternion','spacing']}for r in data]
  fixed=restore(META['idleResult']);start={'result':fixed,'cost':0.0,'path':[fixed],'velocity':Vector(),'angularVelocity':Vector()}
  anchors=static_nodes(clip,data,arrays)if ANCHORED else {}
  if SETTLE_FROM>=0:anchors={f:a for f,a in anchors.items()if f<=SETTLE_FROM};anchors[len(data)-1]=[fixed]
  if CARRY and CARRY['clip']==clip and not ADVISORY_SETTLE:anchors[CARRY['frame']]=[restore(p)for p in CARRY['candidates']]
  print('ANCHORS',clip,{k:len(v)for k,v in anchors.items()},flush=True)
  first_frame=1
  if clip in PREFIX.get('clips',{}):
   prefix=[restore(r)for r in PREFIX['clips'][clip]['samples'][:PREFIX_LENGTH]]
   if len(prefix)==PREFIX_LENGTH:
    first_frame=PREFIX_LENGTH;start={'result':prefix[-1],'cost':0.0,'path':prefix,'velocity':prefix[-1]['center']-prefix[-2]['center'],'angularVelocity':angular_delta(prefix[-2]['quaternion'],prefix[-1]['quaternion'])}
  beam=[start];history=[];counters=[]
  for f in range(first_frame,len(data)):
   ref=data[f];C0=Vector(ref['center']);Q0=Quaternion(ref['quaternion']);S0=ref['spacing'];count=COUNT if 45<=f<=105 else max(48,COUNT//2)
   width=WIDTH if 40<=f<=110 else max(8,WIDTH//2)
   trees={n:BVHTree.FromPolygons(arrays['vertices'][f],faces,all_triangles=False)for n,faces in META['faces'].items()}
   common=basic_proposals(clip,f,data,count);nextbeam=[];clearcache={};nfeasible=0;attempted=0
   before=max([k for k in anchors if k<f],default=0);after=min([k for k in anchors if k>f],default=len(data)-1)
   if anchors:
    a=(anchors.get(before)or[fixed])[0];b=(anchors.get(after)or[fixed])[0];t=(f-before)/max(1,after-before)
    interpolated=(a['center'].lerp(b['center'],t),a['quaternion'].slerp(b['quaternion'],t),a['spacing']+(b['spacing']-a['spacing'])*t)
    common.append(interpolated)
    for space in [interpolated[2]-.01,interpolated[2]+.01]:common.append((interpolated[0],interpolated[1],space))
   for state in beam:
    prev=state['result']
    if f==len(data)-1 or f in anchors:
     for endpoint in ([fixed]if f==len(data)-1 else anchors[f]):
      if endpoint_edge(prev,endpoint,f):
       look=future_cost(endpoint,f,anchors)
       if math.isfinite(look):nextbeam.append({'result':endpoint,'cost':state['cost'],'rank':state['cost']+look,'path':state['path']+[endpoint],'velocity':endpoint['center']-prev['center'],'angularVelocity':angular_delta(prev['quaternion'],endpoint['quaternion'])})
     continue
    proposals=list(common)
    transported=transported_previous_proposal(C0,Q0,data[f-1]['center'],data[f-1]['quaternion'],prev)
    proposals.extend([transported,(prev['center'],prev['quaternion'],prev['spacing']),
      (prev['center']+state['velocity'],Quaternion(state['angularVelocity'].normalized(),state['angularVelocity'].length)@prev['quaternion']if state['angularVelocity'].length>1e-8 else prev['quaternion'],prev['spacing'])])
    # Predict ahead before the bottleneck; nearby center/spacing proposals have
    # much better temporal connectivity than a new independent random cloud.
    for space in [.24,.28,.32,.36,.4,min(.46,S0),S0,prev['spacing']]:proposals.append((transported[0],transported[1],space))
    if ADVISORY_SETTLE and f>=SETTLE_FROM:
     for space in [prev['spacing']-.025,prev['spacing']+.025,.5,.6,.7,.8,.9,.95]:proposals.append((transported[0],transported[1],space))
    for offset in [Vector((.025,0,0)),Vector((-.025,0,0)),Vector((0,.025,0)),Vector((0,-.025,0)),Vector((0,0,.025)),Vector((0,0,-.025))]:
     proposals.append((transported[0]+offset,transported[1],min(S0+.04,prev['spacing'])))
    seen=set()
    for C,Q,S in proposals:
     key=proposal_key(C,Q,S)
     if key in seen:continue
     seen.add(key);attempted+=1
     cone=LOCAL_CONE if clip=='slam'and 55<=f<=92 else .36
     center_bound=.24
     if ADVISORY_SETTLE and f>=SETTLE_FROM:cone=math.radians(60);center_bound=.45
     spacing_bound=.99 if ADVISORY_SETTLE and f>=SETTLE_FROM else S0+.04
     if not .20<=S<=spacing_bound+.000001 or (C-C0).length>center_bound+.000001 or angle(Q0,Q)>cone+.000001:continue
     if ADVISORY_SETTLE and f>=SETTLE_FROM and abs(S-prev['spacing'])>.030001:continue
     if (C-prev['center']).length>.085001 or angle(prev['quaternion'],Q)>.220001:continue
     if key in clearcache and clearcache[key] is None:continue
     arms=ref['arms']
     if GAMMA:
      arms={s:dict(a)for s,a in arms.items()}
      weight=ref['sourceWeight']
      for s,a in arms.items():
       base=a['bend_plane_degrees'];lo=base-45*weight;hi=base+45*weight;pg=prev['hands'][s].get('bendPlaneDegrees',base)
       a['bend_plane_candidates']=[base+weight*g for g in [-45,-22.5,0,22.5,45]]+[max(lo,min(hi,pg+d))for d in [-7.5,0,7.5]]
       if ADVISORY_SETTLE and f>=SETTLE_FROM:
        lo=base-90*weight;hi=base+90*weight;a['bend_plane_candidates']=[base+weight*g for g in [-90,-60,-30,0,30,60,90]]+[max(lo,min(hi,pg+d))for d in [-5,0,5]]
     bend_max=STROKE_BEND if 50<=f<=92 else 32
     if SETTLE_FROM>=0 and f>=SETTLE_FROM:bend_max=SETTLE_BEND
     variants=[arms]
     future=next((k for k in sorted(anchors)if f<k<=f+(80 if ADVISORY_SETTLE and f>=SETTLE_FROM else 32)),None)
     if future is not None:
      guided={s:dict(a)for s,a in arms.items()}
      for s,a in guided.items():
       goal=anchors[future][0]['hands'][s]['bendDegrees'];now=prev['hands'][s]['bendDegrees']
       a['preferred_bend_degrees']=now+(goal-now)/max(1,future-f+1)
       a['preferred_bend_weight']=5
      variants.append(guided)
     solutions=[]
     for variant in variants:
      hands=solve_grip_pair(C,Q@Vector((0,0,1)),S,variant,prev['hands'],maximum_bend_degrees=bend_max,maximum_elbow_step=.079,maximum_hand_angle_step=18 if 50<=f<=92 else 12,maximum_bend_step_degrees=5,enforce_signed_bend_step=not(ADVISORY_SETTLE and f>=SETTLE_FROM))
      if hands is not None:solutions.append(hands)
     if not solutions:continue
     if key not in clearcache:clearcache[key]=shaft_clearance(C,Q,S,ref['rearAnchor'],trees,sections,.015)
     gap=clearcache[key]
     if gap is None:continue
     for hands in solutions:
      nfeasible+=1;v=C-prev['center'];omega=angular_delta(prev['quaternion'],Q)
      spatial=.35*((C-C0).length/.24)**2+.25*(angle(Q0,Q)/.36)**2+.08*((S-S0)/.2)**2
      temporal=.08*((v-state['velocity']).length/.085)**2+.05*((omega-state['angularVelocity']).length/.22)**2
      temporal+=.025*sum((hands[s]['bendVectorStepDegrees'if ADVISORY_SETTLE else'bendStepDegrees']/5)**2 for s in hands)
      r={'center':C.copy(),'quaternion':Q.copy(),'axis':Q@Vector((0,0,1)),'spacing':S,'hands':hands,'minimumShaftSurfaceGap':gap,'score':spatial+temporal}
      look=future_cost(r,f,anchors)
      if not math.isfinite(look):continue
      cost=state['cost']+spatial+temporal
      nextbeam.append({'result':r,'cost':cost,'rank':cost+look,'path':state['path']+[r],'velocity':v,'angularVelocity':omega})
   nextbeam.sort(key=lambda s:s.get('rank',s['cost']));kept=[];distinct=set()
   for s in nextbeam:
    key=diversity_key(s['result'])
    if key in distinct:continue
    distinct.add(key);kept.append(s)
    if len(kept)>=width:break
   counters.append({'frame':f,'attempted':attempted,'feasible':nfeasible,'kept':len(kept)})
   if not kept:
    result['status']='blocked';result['blocked']={'clip':clip,'frame':f,'attempted':attempted,'beamWidth':len(beam)}
    result['clips'][clip]={'samples':serial(min(beam,key=lambda s:s['cost'])['path']),'counters':counters,'complete':False}
    json.dump(result,open(OUT,'w'),indent=2);print('BEAM_BLOCKED',clip,f,'prior',len(beam),'attempted',attempted,flush=True);sys.exit(2)
   beam=kept
   if f%5==0:
    print('BEAM',clip,f,'states',len(beam),'feasible',nfeasible,'cost',round(beam[0]['cost'],3),'seconds',round(time.time()-began,1),flush=True)
   if f%15==0:
    result['clips'][clip]={'samples':serial(beam[0]['path']),'counters':counters,'complete':False}
    json.dump(result,open(OUT,'w'),indent=2)
  best=min(beam,key=lambda s:s['cost']);result['clips'][clip]={'samples':serial(best['path']),'counters':counters,'complete':True,'cost':best['cost'],'seconds':time.time()-began}
  json.dump(result,open(OUT,'w'),indent=2);print('BEAM_CLIP_COMPLETE',clip,len(best['path']),flush=True)
 result['status']='complete';json.dump(result,open(OUT,'w'),indent=2);print('BOSS_TRAJECTORY_READY',OUT,flush=True)

if __name__=='__main__':run()
