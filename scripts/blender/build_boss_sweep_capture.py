"""Captured-palm sweep correction, independently owned derivative.

The dominant captured palm remains fixed. The offhand follows a reliability-
smoothed captured palm line, with a minimum spacing. Exact two-bone candidates
are selected with captured elbow/hand costs, bounded geometric pronation, and
temporal continuity. Humerus hinge is explicitly restored after positional IK.
No production assets are changed. V71 and frozen provider motion remain intact.
"""
import bpy, os, sys, math, json, statistics
import numpy as np
from mathutils import Vector, Quaternion, Matrix

ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'))
TAG=os.environ.get('VESPER_SWEEP_TAG','sweep-capture-a1')
OUT=os.path.join(ROOT,'assets/combat-revision/boss',TAG)
DOC=os.path.join(ROOT,'docs/combat-revision',TAG+'-report.json')
ctx=os.path.join(ROOT,'assets/combat-revision/boss/trajectory-context')
meta=json.load(open(os.path.join(ctx,'context.json')))
raw=np.load(os.path.join(ctx,'sweep.npz'))['poses']
bpy.ops.wm.open_mainfile(filepath=os.path.join(ROOT,'assets/combat-revision/boss/v71-sweep-captured-fk-baseline/boss-combat-candidate.blend'))
bpy.context.preferences.filepaths.save_version=0
scene=bpy.context.scene;rig=next(o for o in scene.objects if o.type=='ARMATURE')
body=next(o for o in scene.objects if o.type=='MESH'and any(m.type=='ARMATURE'for m in o.modifiers))
bones=rig.pose.bones;inv=rig.matrix_world.inverted();rig.animation_data.action=None
for t in rig.animation_data.nla_tracks:t.mute=True
def update():bpy.context.view_layer.update()
def B(n):return bones['mixamorig:'+n]
def M(b):return rig.matrix_world@b.matrix
def P(b):return M(b).translation.copy()
def apply(f):
 for n,m in zip(meta['bones'],raw[f]):bones[n].matrix_basis=Matrix(m)
 update()
def setworld(b,m):b.matrix=inv@m;update()
def rotate(b,q):
 m=M(b);p=m.translation.copy();setworld(b,Matrix.Translation(p)@q.to_matrix().to_4x4()@Matrix.Translation(-p)@m)
def aim(b,child,target):
 a=P(child)-P(b);v=target-P(b)
 if min(a.length,v.length)>1e-8:rotate(b,a.normalized().rotation_difference(v.normalized()))
def grip(s):
 ps=[P(B(s+'Hand'+d+str(j)))for d in ['Index','Middle','Ring','Pinky']for j in[1,3]]
 return sum(ps,Vector())*(.8/len(ps))+P(B(s+'HandThumb3'))*.2
def handQ(A,L,s):return Matrix((Vector(A),Vector(L),Vector(A).cross(Vector(L)))).transposed().to_quaternion()@frames[s].inverted()
def normalize(v):return v/np.linalg.norm(v,axis=-1,keepdims=True)
def signed(a,b,axis):return np.arctan2(np.sum(axis*np.cross(a,b),axis=-1),np.sum(a*b,axis=-1))

frames={s:Quaternion(meta['handFrames'][s])for s in ['Left','Right']}
localgrips={s:Vector(meta['localGrip'][s])for s in frames}
coeffs={s:np.asarray(frames[s].inverted()@localgrips[s])for s in frames}
apply(0);hinges={}
for s in frames:
 S,E,W=P(B(s+'Arm')),P(B(s+'ForeArm')),P(B(s+'Hand'))
 hinges[s]=M(B(s+'Arm')).to_quaternion().inverted()@(E-S).cross(W-E).normalized()
def hinge(s):
 S,E,W=P(B(s+'Arm')),P(B(s+'ForeArm')),P(B(s+'Hand'));ax=(E-S).normalized()
 actual=M(B(s+'Arm')).to_quaternion()@hinges[s];actual-=ax*actual.dot(ax);actual.normalize()
 plane=ax.cross(W-E).normalized()
 return math.atan2(ax.dot(actual.cross(plane)),actual.dot(plane))
def pronation(s):
 S,E,W=P(B(s+'Arm')),P(B(s+'ForeArm')),P(B(s+'Hand'));F=(W-E).normalized()
 neutral=(E-S).cross(F).cross(F).normalized();thumb=P(B(s+'HandIndex1'))-P(B(s+'HandPinky1'));thumb-=F*thumb.dot(F);thumb.normalize()
 return math.atan2(F.dot(neutral.cross(thumb)),neutral.dot(thumb))

source=[]
for f in range(len(raw)):
 apply(f);r={'hands':{}}
 for s in frames:
  Q=M(B(s+'Hand')).to_quaternion();S,E,W=P(B(s+'Arm')),P(B(s+'ForeArm')),P(B(s+'Hand'))
  r['hands'][s]={'S':np.array(S),'E':np.array(E),'W':np.array(W),'G':np.array(grip(s)),
    'A':np.array(Q@(frames[s]@Vector((1,0,0)))),'L':np.array(Q@(frames[s]@Vector((0,1,0)))),
    'Q':Q.copy(),'FQ':M(B(s+'ForeArm')).to_quaternion().copy(),'hinge':hinge(s),'pronation':pronation(s),
    'l1':(E-S).length,'l2':(W-E).length}
 source.append(r)
delta=np.array([r['hands']['Left']['G']-r['hands']['Right']['G']for r in source]);spacing=np.linalg.norm(delta,axis=1)
axes=[]
for f in range(len(raw)):
 ids=np.arange(max(0,f-3),min(len(raw),f+4));weights=np.exp(-((ids-f)/2.2)**2)*np.minimum(spacing[ids],.5)**2
 # Low-separation samples have little authority over shaft orientation.
 A=normalize(np.sum(normalize(delta[ids])*weights[:,None],axis=0))
 axes.append(Vector(A))
axes[0]=Vector(meta['idleResult']['axis']);axes[-1]=axes[0].copy()

betas=[];gammas=[]
for gamma in np.radians(np.arange(-180,181,30)):
 for beta in np.radians(np.arange(0,40.001,2)):
  betas.append(beta);gammas.append(gamma)
betas=np.array(betas);gammas=np.array(gammas);cb=np.cos(betas);sb=np.sin(betas);cg=np.cos(gammas);sg=np.sin(gammas)

def candidates(s,f,G,A):
 r=source[f]['hands'][s];S,E0,W0=r['S'],r['E'],r['W'];l1,l2=r['l1'],r['l2'];ga,gl,gn=coeffs[s]
 A=np.asarray(A);D=G-S;da=D@A;radial=D-da*A;rho=np.linalg.norm(radial)
 if rho<1e-6:return []
 R=radial/rho;T=np.cross(A,R);x=da-ga-l2*sb*cg;y=gl+l2*cb;z=gn+l2*sb*sg;radius=np.sqrt(y*y+z*z)
 c=(x*x+rho*rho+radius*radius-l1*l1)/(2*rho*radius);ids=np.where(abs(c)<=1)[0]
 alpha=np.arctan2(z[ids],y[ids]);theta=np.arccos(np.clip(c[ids],-1,1));theta=np.concatenate((-alpha+theta,-alpha-theta));ids=np.concatenate((ids,ids))
 if not len(ids):return []
 L=np.cos(theta)[:,None]*R+np.sin(theta)[:,None]*T;N=np.cross(A,L);W=G-ga*A-gl*L-gn*N;E=W-l2*(cb[ids,None]*L+sb[ids,None]*(cg[ids,None]*A+sg[ids,None]*N))
 F=normalize(W-E);U=normalize(E-S);neutral=normalize(np.cross(np.cross(U,F),F));thumb=normalize(A-np.sum(F*A,axis=1)[:,None]*F);phi=signed(neutral,thumb,F)
 # Actual forearm/hand skin must remain on the captured anatomical branch.
 cost=20*np.sum((E-E0)**2,axis=1)+8*np.sum((W-W0)**2,axis=1)+.15*np.arccos(np.clip(L@r['L'],-1,1))**2
 cost+=.01*(betas[ids]/math.radians(40))**2
 cost[np.abs(phi)>math.radians(77)]=np.inf
 cost[np.linalg.norm(E-E0,axis=1)>.35]=np.inf
 order=np.argsort(cost)[:36];out=[]
 for j in order:
  if not np.isfinite(cost[j]):continue
  Q=handQ(A,L[j],s)
  out.append({'E':Vector(E[j]),'W':Vector(W[j]),'Q':Q,'cost':float(cost[j]),'phi':float(phi[j]),'beta':float(betas[ids[j]])})
 return out

allc={s:[]for s in frames};targets=[];fail=[]
for f in range(len(raw)):
 A=axes[f];R=source[f]['hands']['Right']['G'];gap=max(float(spacing[f]),.30);G={'Right':R,'Left':R+np.array(A)*gap};weight=meta['clips']['sweep'][f]['sourceWeight']
 targets.append({'axis':A,'gap':gap,'grips':G})
 for s in frames:
  idleA=Vector(source[0]['hands'][s]['A']);transported=axes[0].rotation_difference(A)@idleA
  signedAxis=A.copy()
  if s=='Left' and 38<=f<=116:signedAxis.negate()
  across=transported.lerp(signedAxis,weight).normalized()
  cs=candidates(s,f,G[s],across)
  if not cs:fail.append({'frame':f,'side':s,'reason':'no anatomically bounded exact grip'});cs=[{'E':Vector(source[f]['hands'][s]['E']),'W':Vector(source[f]['hands'][s]['W']),'Q':source[f]['hands'][s]['Q'],'cost':1e4,'phi':source[f]['hands'][s]['pronation'],'beta':0}]
  allc[s].append(cs)

selected={}
for s,lists in allc.items():
 dp=np.array([c['cost']for c in lists[0]]);backs=[]
 for f in range(1,len(lists)):
  trans=np.empty((len(lists[f-1]),len(lists[f])))
  for i,p in enumerate(lists[f-1]):
   for j,c in enumerate(lists[f]):
    dq=p['Q'].rotation_difference(c['Q']).angle;dq=min(dq,2*math.pi-dq)
    trans[i,j]=35*(p['E']-c['E']).length_squared+10*(p['W']-c['W']).length_squared+.8*dq*dq
  z=dp[:,None]+trans;back=np.argmin(z,axis=0);dp=np.array([c['cost']for c in lists[f]])+z[back,np.arange(len(lists[f]))];backs.append(back)
 idx=int(np.argmin(dp));indices=[idx]
 for back in reversed(backs):idx=int(back[idx]);indices.append(idx)
 selected[s]=[cs[i]for cs,i in zip(lists,reversed(indices))]

poses=[];rows=[];Q=Quaternion(meta['idleResult']['quaternion']);lastA=axes[0]
for f in range(len(raw)):
 apply(f);row={'frame':f,'time':f/30,'rawSeparation':float(spacing[f]),'correctedSeparation':targets[f]['gap'],'hands':{}}
 for s in frames:
  c=selected[s][f];r=source[f]['hands'][s];arm,fore,hand=B(s+'Arm'),B(s+'ForeArm'),B(s+'Hand')
  aim(arm,fore,c['E']);aim(fore,hand,c['W'])
  # Humerus axial frame follows the captured physical elbow hinge.
  fm=M(fore).copy();hm=M(hand).copy();angle=hinge(s)-r['hinge'];rotate(arm,Quaternion((P(fore)-P(arm)).normalized(),angle));setworld(fore,fm);setworld(hand,hm)
  # Distribute only axial forearm rotation, preserving the authored local wrist.
  proposed=M(fore).to_quaternion();F=(P(hand)-P(fore)).normalized();relative=r['FQ'].inverted()@r['Q'];desired=c['Q']@relative.inverted();diff=desired@proposed.inverted();v=Vector((diff.x,diff.y,diff.z));axial=2*math.atan2(v.dot(F),diff.w)
  rotate(fore,Quaternion(F,axial));hm=M(hand);setworld(hand,Matrix.LocRotScale(hm.translation,c['Q'],hm.to_scale()))
  row['hands'][s]={'elbowShift':(P(fore)-Vector(r['E'])).length,'wristShift':(P(hand)-Vector(r['W'])).length,'palmShift':(grip(s)-Vector(r['G'])).length,'palmResidual':(grip(s)-Vector(targets[f]['grips'][s])).length,'humerusHingeChange':math.degrees(hinge(s)-r['hinge']),'pronation':math.degrees(pronation(s)),'wristBend':math.degrees((P(B(s+'HandMiddle1'))-P(hand)).angle(P(hand)-P(fore)))}
 A=axes[f];Q=lastA.rotation_difference(A)@Q;Q.normalize();lastA=A.copy()
 # The blade's axial roll is transported from the approved idle orientation.
 rear=.6;origin=Vector(targets[f]['grips']['Right'])-A*rear
 bones['WeaponSocket'].matrix=inv@Matrix.LocRotScale(origin,Q,Vector((1,1,1)));update()
 if f in[0,len(raw)-1]:
  for n,m in zip(meta['bones'],meta['idlePose']):bones[n].matrix_basis=Matrix(m)
  update()
 poses.append({b.name:b.matrix_basis.copy()for b in bones});row['axis']=list(A);rows.append(row)

report={'status':'diagnostic candidate, not promoted','source':'V71 frozen captured-FK sweep','method':'dominant captured palm fixed; offhand reliable captured line and minimum30cm spacing; bounded exact hand solutions, captured humerus hinge restored; temporal path selection','failures':fail,'samples':rows}
report['maximums']={s:{k:max(abs(r['hands'][s][k])for r in rows)for k in rows[0]['hands'][s]}for s in frames}
json.dump(report,open(DOC,'w'),indent=2)
print('SWEEP_SOLVE',len(fail),'failures',json.dumps(report['maximums']),flush=True)
if os.environ.get('VESPER_SWEEP_PROBE_ONLY')=='1':sys.exit(0)
os.makedirs(OUT,exist_ok=True)
for t in list(rig.animation_data.nla_tracks):
 if t.name=='sweep':rig.animation_data.nla_tracks.remove(t)
action=bpy.data.actions.new(TAG+'-sweep');rig.animation_data.action=action;previous={}
for f,p in enumerate(poses):
 for n,m in p.items():
  b=bones[n];loc,q,scale=m.decompose()
  if n in previous and previous[n].dot(q)<0:q.negate()
  previous[n]=q.copy();b.location=loc;b.rotation_quaternion=q;b.scale=scale
  for field in ['location','rotation_quaternion','scale']:b.keyframe_insert(field,frame=f)
rig.animation_data.action=None;t=rig.animation_data.nla_tracks.new();t.name='sweep';t.strips.new('sweep',0,action)
for t in rig.animation_data.nla_tracks:t.mute=False
scene.frame_set(0);update();bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);body.select_set(True);bpy.context.view_layer.objects.active=rig
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT,'boss-combat-candidate.blend'))
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT,'boss-combat-candidate.glb'),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='NLA_TRACKS',export_nla_strips=True,export_frame_range=False,export_force_sampling=True,export_def_bones=False)
print('SWEEP_CAPTURE_CANDIDATE_READY',OUT,flush=True)
