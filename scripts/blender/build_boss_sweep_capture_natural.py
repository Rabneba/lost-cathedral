"""Captured-arm sweep: fixed dominant palm, offhand regrasp, bounded pronation.

Uses only the read-only initialization/helpers from this task's diagnostic.
No dependency on another worker's mutable authoring scripts.
"""
import os
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'))
setup=open(os.path.join(ROOT,'scripts/blender/build_boss_sweep_capture.py')).read().split('source=[]')[0]
exec(compile(setup,'build_boss_sweep_capture.py','exec'))
def smooth(a,b,t):
 x=max(0,min(1,(t-a)/(b-a)));return x*x*(3-2*x)
def release(f):return (smooth(23,28,f)*(1-smooth(44,51,f))+smooth(96,102,f)*(1-smooth(140,150,f)))
def move_arm(s,target):
 arm,fore,hand=B(s+'Arm'),B(s+'ForeArm'),B(s+'Hand');S,E,W=P(arm),P(fore),P(hand);Q=M(hand).to_quaternion();h0=hinge(s);l1=(E-S).length;l2=(W-E).length;d=(target-S).length
 if d>l1+l2-.002 or d<abs(l1-l2)+.002:return False
 axis=(target-S).normalized();along=(l1*l1-l2*l2+d*d)/(2*d);height=math.sqrt(max(0,l1*l1-along*along));pole=E-S;pole-=axis*pole.dot(axis)
 if pole.length<1e-6:return False
 newE=S+axis*along+pole.normalized()*height;aim(arm,fore,newE);aim(fore,hand,target);hm=M(hand);setworld(hand,Matrix.LocRotScale(hm.translation,Q,hm.to_scale()))
 fm=M(fore).copy();hm=M(hand).copy();rotate(arm,Quaternion((P(fore)-P(arm)).normalized(),hinge(s)-h0));setworld(fore,fm);setworld(hand,hm);return True

rawInfo=[]
for f in range(len(raw)):
 apply(f);r={}
 for s in frames:r[s]={'G':grip(s),'W':P(B(s+'Hand')),'E':P(B(s+'ForeArm')),'hinge':hinge(s)}
 rawInfo.append(r)
delta=np.array([r['Left']['G']-r['Right']['G']for r in rawInfo]);gaps=np.linalg.norm(delta,axis=1);axes=[]
for f in range(len(raw)):
 ids=np.arange(max(0,f-3),min(len(raw),f+4));w=np.exp(-((ids-f)/2.2)**2)*np.minimum(gaps[ids],.5)**2
 axes.append(Vector(normalize(np.sum(normalize(delta[ids])*w[:,None],axis=0))))
axes[0]=Vector(meta['idleResult']['axis']);axes[-1]=axes[0].copy()
shaftSectionsCurve=np.array([c for c,r in meta['shaftSections']])
def shaftCenter(h):
 return Vector((float(np.interp(h,shaftSectionsCurve[:,2],shaftSectionsCurve[:,0])),float(np.interp(h,shaftSectionsCurve[:,2],shaftSectionsCurve[:,1])),h))
def gripStation(f):
 active=smooth(39,49,f)*(1-smooth(99,109,f))
 buttTurn=smooth(18,26,f)*(1-smooth(44,51,f))+smooth(99,109,f)*(1-smooth(140,154,f))
 return .6+(station-.6)*active-.48*buttTurn*(1-active)
def centered(h,f):
 p=shaftCenter(h);w=smooth(12,26,f)*(1-smooth(155,197,f));p.x*=w;p.y*=w;return p
baseAxes=[a.copy()for a in axes]
weaponQs=[];q=Quaternion(meta['idleResult']['quaternion']);previous=axes[0]
for a in axes:
 q=previous.rotation_difference(a)@q;q.normalize();weaponQs.append(q.copy());previous=a
# Remove transport holonomy gradually during the original long recovery.
endRoll=weaponQs[-1].rotation_difference(Quaternion(meta['idleResult']['quaternion']))
for f in range(len(raw)):
 weaponQs[f]=weaponQs[f]@Quaternion().slerp(endRoll,smooth(140,197,f))
reverse=os.environ.get('VESPER_SWEEP_REVERSE')=='1';roll=math.radians(float(os.environ.get('VESPER_SWEEP_ROLL','0')));station=float(os.environ.get('VESPER_SWEEP_STATION','.6'));bodyAim=float(os.environ.get('VESPER_SWEEP_BODY_AIM','0'))
if reverse or abs(roll)>1e-8:
 adjusted=[q@Quaternion(Vector((0,1,0)),math.pi if reverse else 0)for q in weaponQs]
 for f in range(len(raw)):
  if 26<=f<44:weaponQs[f]=weaponQs[26].slerp(adjusted[44],smooth(26,44,f))
  elif 44<=f<=109:weaponQs[f]=adjusted[f]
  elif 109<f<140:weaponQs[f]=adjusted[109].slerp(weaponQs[140],smooth(109,140,f))
 for f in range(len(raw)):
  rollWeight=smooth(26,44,f)*(1-smooth(109,140,f))
  weaponQs[f]=weaponQs[f]@Quaternion(Vector((0,0,1)),roll*rollWeight)
 axes=[q@Vector((0,0,1))for q in weaponQs]
prepared=[];failures=[]
for f in range(len(raw)):
 apply(f);A=axes[f];G=rawInfo[f]['Right']['G'];order=-1 if reverse and 35<=f<=124 else 1;currentStation=gripStation(f)
 target=G+weaponQs[f]@(centered(currentStation+order*max(float(gaps[f]),.3),f)-centered(currentStation,f));opening=release(f)
 target=target.lerp(rawInfo[f]['Left']['G']+Vector((0,-.12,.04)),opening)
 if not move_arm('Left',P(B('LeftHand'))+target-grip('Left')):failures.append({'frame':f,'stage':'offhand spacing reach'})
 prepared.append({b.name:b.matrix_basis.copy()for b in bones})
def pose(p):
 for n,m in p.items():bones[n].matrix_basis=m
 update()

targets={};records={};grid=np.arange(-76.,76.001,2.)
for s in frames:
 costs=[];info=[]
 for f in range(len(raw)):
  pose(prepared[f]);W=P(B(s+'Hand'));F=(W-P(B(s+'ForeArm'))).normalized();A=(P(B(s+'HandIndex1'))-P(B(s+'HandPinky1'))).normalized();phi=math.degrees(pronation(s));opening=release(f) if s=='Left'else 0.;line=axes[f];row=[]
  for theta in grid:
   rotated=Quaternion(F,math.radians(float(theta-phi)))@A;error=math.acos(min(1,abs(rotated.dot(line))))
   row.append(9*(1-opening)**2*error*error+(.08+opening*3)*((theta-phi)/80)**2)
  costs.append(row);info.append({'phi':phi,'release':opening})
 costs=np.array(costs);T=.35*((grid[:,None]-grid[None,:])/10)**2;T[abs(grid[:,None]-grid[None,:])>10]=np.inf
 costs[0]+=1000*((grid-info[0]['phi'])/2)**2;costs[-1]+=1000*((grid-info[-1]['phi'])/2)**2
 dp=costs[0];backs=[]
 for f in range(1,len(raw)):
  z=dp[:,None]+T;back=np.argmin(z,axis=0);dp=costs[f]+z[back,np.arange(len(grid))];backs.append(back)
 idx=int(np.argmin(dp));indices=[idx]
 for back in reversed(backs):idx=int(back[idx]);indices.append(idx)
 ts=grid[list(reversed(indices))];ts=np.convolve(np.pad(ts,(1,1),mode='edge'),[.2,.6,.2],mode='valid');ts[0]=info[0]['phi'];ts[-1]=info[-1]['phi'];targets[s]=ts;records[s]=info

poses=[];rows=[];Q=Quaternion(meta['idleResult']['quaternion']);lastA=axes[0]
for f in range(len(raw)):
 pose(prepared[f]);row={'frame':f,'time':f/30,'rawSeparation':float(gaps[f]),'releaseWeight':release(f),'hands':{}}
 for s in frames:
  saved={b.name:b.matrix_basis.copy()for b in bones};G=grip(s);oldW=P(B(s+'Hand'));oldHQ=M(B(s+'Hand')).to_quaternion();oldFQ=M(B(s+'ForeArm')).to_quaternion();relative=oldFQ.inverted()@oldHQ;local=oldHQ.inverted()@(G-oldW);F0=(oldW-P(B(s+'ForeArm'))).normalized();phi0=math.degrees(pronation(s));desired=float(targets[s][f]);change=desired-phi0
  for iteration in range(7):
   pose(saved);targetHQ=Quaternion(F0,math.radians(change))@oldHQ;targetW=G-targetHQ@local
   if not move_arm(s,targetW):failures.append({'frame':f,'side':s,'stage':'pronation wrist reach'});break
   fm=M(B(s+'ForeArm'));targetFQ=targetHQ@relative.inverted();setworld(B(s+'ForeArm'),Matrix.LocRotScale(fm.translation,targetFQ,fm.to_scale()));aim(B(s+'ForeArm'),B(s+'Hand'),targetW);hm=M(B(s+'Hand'));setworld(B(s+'Hand'),Matrix.LocRotScale(hm.translation,targetHQ,hm.to_scale()))
   actual=math.degrees(pronation(s));error=(desired-actual+180)%360-180
   if abs(error)<.03:break
   change+=error
  W=P(B(s+'Hand'));E=P(B(s+'ForeArm'));across=(P(B(s+'HandIndex1'))-P(B(s+'HandPinky1'))).normalized();shaft=axes[f]
  row['hands'][s]={'pronation':math.degrees(pronation(s)),'wristBend':math.degrees((P(B(s+'HandMiddle1'))-W).angle(W-E)),'gripLineObliqueness':math.degrees(math.acos(min(1,abs(across.dot(shaft))))),'palmResidual':(grip(s)-G).length,'palmShift':(grip(s)-rawInfo[f][s]['G']).length,'wristShift':(W-rawInfo[f][s]['W']).length,'elbowShift':(E-rawInfo[f][s]['E']).length,'humerusHingeChange':math.degrees(hinge(s)-rawInfo[f][s]['hinge'])}
 # Explicitly open only the secondary fingers while it changes grip side.
 opening=release(f)
 for d in ['Index','Middle','Ring','Pinky']:
  for j in [1,2,3]:
   b=B('LeftHand'+d+str(j));b.rotation_mode='QUATERNION';b.rotation_quaternion=b.rotation_quaternion.slerp(Quaternion(),opening*.7)
 update();A=axes[f];Q=weaponQs[f];currentStation=gripStation(f);origin=rawInfo[f]['Right']['G']-Q@centered(currentStation,f)
 bones['WeaponSocket'].matrix=inv@Matrix.LocRotScale(origin,Q,Vector((1,1,1)));update()
 if f in[0,len(raw)-1]:
  for n,m in zip(meta['bones'],meta['idlePose']):bones[n].matrix_basis=Matrix(m)
  update()
 aimDegrees=bodyAim*smooth(0,32,f)*(1-smooth(108,181,f))
 if abs(aimDegrees)>1e-8:
  rotation=Matrix.Rotation(math.radians(aimDegrees),4,'Z');roots={b.name:M(b).copy()for b in bones if b.parent is None}
  for n,m in roots.items():setworld(bones[n],rotation@m)
 row['bakedWholeBodyAimDegrees']=aimDegrees
 poses.append({b.name:b.matrix_basis.copy()for b in bones});row['axis']=list(A);rows.append(row)

report={'status':'diagnostic candidate, not promoted','source':'V71 frozen captured FK','method':'dominant captured palm retained; offhand min30cm spacing with prep/recovery release; temporal bounded pronation around captured forearm; capture-relative elbow pole and humerus hinge restored','weaponAdjustment':{'reverse':reverse,'rollDegrees':math.degrees(roll),'activeGripStation':station,'prepFrames':[26,44],'recoveryFrames':[109,140],'bodyAimDegreesAlreadyBaked':bodyAim,'aimInFrames':[0,32],'aimOutFrames':[108,181]},'samples':rows,'failures':failures}
report['maximums']={s:{k:max(abs(r['hands'][s][k])for r in rows)for k in rows[0]['hands'][s]}for s in frames}
json.dump(report,open(DOC,'w'),indent=2);print('SWEEP_NATURAL_SOLVE',json.dumps(report['maximums']),'failures',failures,flush=True)
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
print('SWEEP_CAPTURE_NATURAL_READY',OUT,flush=True)
