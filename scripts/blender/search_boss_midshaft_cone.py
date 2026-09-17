"""Read-only exact two-arm grip feasibility search on a saved rejected candidate.
For each candidate rod center/axis/spacing, solve the palm frame and elbow together:
forearm = cos(beta)*palmLong + sin(beta)*palmAcross. For fixed beta, the
upper-arm-length condition reduces to a circle/plane intersection in hand roll.
No frozen-q approximation or iterative grip residual. Writes diagnostics only.
"""
import bpy, os, json, math, statistics, time
import numpy as np
from mathutils import Matrix, Vector, Quaternion
from mathutils.bvhtree import BVHTree
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'))
PATH='/tmp/vesper-boss-candidate-v6.blend'
OUT=os.path.join(ROOT,'docs/combat-revision/boss-midshaft-cone-search-v6.json')
bpy.ops.wm.open_mainfile(filepath=PATH)
scene=bpy.context.scene;rig=next(o for o in scene.objects if o.type=='ARMATURE')
body=next(o for o in scene.objects if o.type=='MESH'and any(m.type=='ARMATURE'for m in o.modifiers))
def B(n):return rig.pose.bones['mixamorig:'+n]
def M(p):return rig.matrix_world@p.matrix
def P(p):return M(p).translation.copy()
def frame(name,f):
 for t in rig.animation_data.nla_tracks:t.mute=True
 strip=next(t for t in rig.animation_data.nla_tracks if t.name==name).strips[0]
 rig.animation_data.action=strip.action;rig.animation_data.action_slot=strip.action_slot
 scene.frame_set(f);bpy.context.view_layer.update()
def grip(s):
 ps=[P(B(s+'Hand'+d+str(j)))for d in ['Index','Middle','Ring','Pinky']for j in [1,3]]
 return sum(ps,Vector())*(.8/len(ps))+P(B(s+'HandThumb3'))*.2
frame('idle',0)
hand_axes={'Left':((-.696083,-.023369,-.717581),(.004639,.999303,-.037043)),
           'Right':((.772122,-.020369,-.635147),(.008849,.999734,-.021304))}
frames={};coeffs={};localgrips={}
for s,(aa,ll)in hand_axes.items():
 a=Vector(aa).normalized();l=Vector(ll);l=(l-a*l.dot(a)).normalized();n=a.cross(l)
 frames[s]=Matrix((a,l,n)).transposed();g=M(B(s+'Hand')).to_quaternion().inverted()@(grip(s)-P(B(s+'Hand')))
 localgrips[s]=g;coeffs[s]=np.array((g.dot(a),g.dot(l),g.dot(n)))
groups={g.index:g.name for g in body.vertex_groups}
regions={'hood':{'mixamorig:Head','mixamorig:Neck'},'torso':{'mixamorig:Hips','mixamorig:Spine','mixamorig:Spine1','mixamorig:Spine2'}}
mask={name:{v.index for v in body.data.vertices if sum(g.weight for g in v.groups if groups[g.group]in names)>.25}for name,names in regions.items()}
polygons={name:[list(p.vertices)for p in body.data.polygons if any(i in ids for i in p.vertices)]for name,ids in mask.items()}
clearance=json.load(open(os.path.join(ROOT,'docs/combat-revision/boss-shaft-clearance-v6.json')))
sections=[(Vector(c),r)for c,r in clearance['shaftSections']]
bake=json.load(open(os.path.join(ROOT,'docs/combat-revision/boss-candidate-bake-v6.json')))
betas=np.radians(np.arange(-32,33,2));cosb=np.cos(betas);sinb=np.sin(betas)

def exact_arm(S,E0,W0,G,A,l1,l2,coeff):
 # For a selected wrist bend, possible elbow placements have exactly l1/l2
 # arm lengths and exactly the requested grip center and metacarpal frame.
 ga,gl,gn=coeff;D=G-S;da=float(D@A);radial=D-A*da;rho=np.linalg.norm(radial)
 if rho<1e-8:return None
 R=radial/rho;T=np.cross(A,R)
 x=da-ga-l2*sinb;y=gl+l2*cosb;z=gn;radius=np.sqrt(y*y+z*z)
 denom=2*rho*radius
 c=(x*x+rho*rho+radius*radius-l1*l1)/denom
 valid=np.abs(c)<=1
 if not np.any(valid):return None
 ids=np.where(valid)[0];alpha=np.arctan2(z,y[ids]);theta=np.arccos(np.clip(c[ids],-1,1))
 # B*cos(theta) - C*sin(theta), because N=A cross L.
 theta=np.concatenate((-alpha+theta,-alpha-theta));ids=np.concatenate((ids,ids))
 L=np.cos(theta)[:,None]*R+np.sin(theta)[:,None]*T;N=np.cross(A,L)
 W=G-ga*A-gl*L-gn*N
 E=W-l2*(cosb[ids,None]*L+sinb[ids,None]*A)
 length_error=np.abs(np.linalg.norm(E-S,axis=1)-l1)
 cost=np.sum((E-E0)**2,axis=1)+.25*np.sum((W-W0)**2,axis=1)+.002*(betas[ids]/math.radians(32))**2
 cost[length_error>1e-5]=np.inf
 j=int(np.argmin(cost))
 if not np.isfinite(cost[j]):return None
 return {'elbow':E[j], 'wrist':W[j], 'long':L[j], 'normal':N[j], 'beta':float(np.degrees(betas[ids[j]])), 'cost':float(cost[j]), 'armLengthError':float(length_error[j])}

def clearance_at(C,A,Q,spacing,rear,trees,full=True):
 origin=Vector(C)-Vector(A)*(rear+spacing*.5);minimum=1e3
 pts=[]
 for local,r in sections:
  p=origin+Q@local;pts.append(p)
  for tree in trees.values():
   near=tree.find_nearest(p)
   if near[0] is None:continue
   gap=near[3]-r;minimum=min(minimum,gap)
   if gap<.012:return None
 # No segment may enter body while centers happen to miss the surface.
 for a,b in zip(pts,pts[1:]):
  d=b-a
  for tree in trees.values():
   if tree.ray_cast(a,d.normalized(),d.length)[0]is not None:return None
 return minimum

rng=np.random.default_rng(44061);out={'input':PATH,'rearAnchorActive':.4,'maximumWristBend':32,'shaftClearanceRequired':.012,'method':'exact palm/elbow circle solution; current evaluated torso and hood BVH; candidate positions only, not a baked animation','frames':{}}
# Include worst wrist, collision and rapid motion frames from independent audit.
queries=[('sweep',84),('sweep',86),('slam',134),('slam',150),('slam',74),('sweep',8)]
for clip,f in queries:
 started=time.time();frame(clip,f);report=bake[clip]['samples'][f]
 C0=np.array(report['center']);A0=np.array(report['shaft']);A0/=np.linalg.norm(A0)
 Q0=M(rig.pose.bones['WeaponSocket']).to_quaternion();chest=np.array(P(B('Spine2')))
 across=np.array(P(B('LeftArm'))-P(B('RightArm')));across[2]=0;across/=np.linalg.norm(across)
 forward=np.cross(across,np.array((0,0,1)))
 ev=body.evaluated_get(bpy.context.evaluated_depsgraph_get());vertices=[body.matrix_world@v.co for v in ev.data.vertices]
 trees={n:BVHTree.FromPolygons(vertices,p,all_triangles=False)for n,p in polygons.items()}
 arms={}
 for s in ['Left','Right']:
  S=np.array(P(B(s+'Arm')));E=np.array(P(B(s+'ForeArm')));W=np.array(P(B(s+'Hand')))
  q=M(B(s+'Hand')).to_quaternion();a=q@(frames[s]@Vector((1,0,0)));sign=1 if a.dot(Vector(A0))>=0 else-1
  arms[s]={'S':S,'E':E,'W':W,'l1':np.linalg.norm(E-S),'l2':np.linalg.norm(W-E),'sign':sign}
 sourceweight=max(0,min(1,f/18));sourceweight=sourceweight*sourceweight*(3-2*sourceweight)
 t=max(0,min(1,(f-167)/30));sourceweight*=1-t*t*(3-2*t)
 rear=.6+(.4-.6)*sourceweight
 best=[];anatomy_count=0;clear_count=0
 # First exact current pose with compact butt, then broad nearby samples.
 for i in range(16001):
  if i==0:C=C0.copy();A=A0.copy();spacing=report['spacing'];Q=Q0.copy()
  else:
   # Local perturbations are centered on the current arc. Third of proposals
   # explore a wider center range when the fixed carry is infeasible.
   spread=.16 if i%3 else .30
   shift=rng.normal(size=3)*spread
   shift=np.clip(shift,-.48,.48)
   C=C0+across*shift[0]+forward*shift[1]+np.array((0,0,shift[2]))
   # Modest two-axis rod deflection; blade roll remains inherited.
   bend=rng.uniform(-math.radians(20),math.radians(20),2)
   side=np.cross(A0,np.array((0,0,1)))
   if np.linalg.norm(side)<.05:side=np.cross(A0,np.array((1,0,0)))
   side/=np.linalg.norm(side);up=np.cross(A0,side)
   delta=Quaternion(Vector(side),float(bend[0]))@Quaternion(Vector(up),float(bend[1]))
   Q=delta@Q0;A=np.array(Q@Vector((0,0,1)));spacing=float(rng.uniform(.40,.72))
  solved={}
  for s,gs in [('Left',1),('Right',-1)]:
   ar=arms[s];G=C+A*spacing*.5*gs
   sol=exact_arm(ar['S'],ar['E'],ar['W'],G,A*ar['sign'],ar['l1'],ar['l2'],coeffs[s])
   if sol is None:break
   solved[s]=sol
  if len(solved)!=2:continue
  anatomy_count+=1
  angle=math.degrees(math.acos(np.clip(float(A@A0),-1,1)))
  if angle>20.5:continue
  score=float(np.sum((C-C0)**2)+.2*(spacing-report['spacing'])**2+.12*math.radians(angle)**2+.18*sum(s['cost']for s in solved.values()))
  if len(best)>=8 and score>=best[-1]['score']:continue
  gap=clearance_at(C,A,Q,spacing,rear,trees)
  if gap is None:continue
  clear_count+=1
  result={'score':score,'center':C.tolist(),'axis':A.tolist(),'spacing':spacing,'rearAnchor':rear,'centerShift':(C-C0).tolist(),'centerShiftMetres':float(np.linalg.norm(C-C0)),'axisChangeDegrees':angle,'minimumShaftSurfaceGap':gap,'weaponQuaternion':list(Q),'hands':{}}
  for s,sol in solved.items():
   a=A*arms[s]['sign'];L=sol['long'];N=sol['normal'];hq=Matrix((Vector(a),Vector(L),Vector(N))).transposed().to_quaternion()@frames[s].to_quaternion().inverted()
   result['hands'][s]={k:(v.tolist()if isinstance(v,np.ndarray)else v)for k,v in sol.items()};result['hands'][s]['quaternion']=list(hq)
  best.append(result);best=sorted(best,key=lambda v:v['score'])[:8]
 out['frames'][clip+'-'+str(f)]={'time':f/30,'originalCenter':C0.tolist(),'originalAxis':A0.tolist(),'originalSpacing':report['spacing'],'sourceWeight':sourceweight,'anatomyFeasibleCandidates':anatomy_count,'clearCandidatesImprovingTop8':clear_count,'candidates':best,'elapsedSeconds':time.time()-started}
 json.dump(out,open(OUT,'w'),indent=2)
 print('SEARCH',clip,f,'seconds',time.time()-started,'anatomy',anatomy_count,'clear',clear_count,'best',json.dumps(best[0]if best else None),flush=True)
print('SEARCH_WRITTEN',OUT,flush=True)
