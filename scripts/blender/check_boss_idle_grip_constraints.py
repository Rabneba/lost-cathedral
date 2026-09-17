"""Read-only approved idle frame/grip preservation with bend-plane gamma."""
import os,sys,json,math
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'))
setup=open(os.path.join(ROOT,'scripts/blender/search_boss_grip_targets.py')).read().split('rng=np.random.default_rng')[0]
exec(compile(setup,'search_boss_grip_targets.py','exec'))
sys.path.insert(0,os.path.join(ROOT,'scripts/blender'))
import boss_grip_constraints as constraints
frame('idle',0);rod=M(rig.pose.bones['WeaponSocket']).to_quaternion();axis=rod@Vector((0,0,1))
C=(grip('Left')+grip('Right'))*.5;spacing=(grip('Left')-grip('Right')).dot(axis);arms={};reference={}
for side in ['Left','Right']:
 S=P(B(side+'Arm'));E=P(B(side+'ForeArm'));W=P(B(side+'Hand'));q=M(B(side+'Hand')).to_quaternion()
 A=q@(frames[side]@Vector((1,0,0)));L=q@(frames[side]@Vector((0,1,0)));N=q@(frames[side]@Vector((0,0,1)));F=(W-E).normalized()
 gamma=math.degrees(math.atan2(F.dot(N),F.dot(A)))
 while gamma>90:gamma-=180
 while gamma<-90:gamma+=180
 reference[side]={'wrist':W,'elbow':E,'quaternion':q,'forearmInHandFrame':[F.dot(A),F.dot(L),F.dot(N)],'gamma':gamma}
 arms[side]={'shoulder':S,'upper_length':(E-S).length,'forearm_length':(W-E).length,'captured_elbow':E,'captured_wrist':W,'grip_coefficients':coeffs[side],
  'across_sign':1 if A.dot(axis)>0 else-1,'across_reference_axis':axis,'across_reference':A,'across_weight':0,'captured_long':L,'captured_normal':N,'bend_plane_degrees':gamma}
result={'reference':{s:{'forearmInHandFrame':r['forearmInHandFrame'],'gamma':r['gamma']}for s,r in reference.items()},'runs':{}}
for label,weight in [('defaultCaptureCost',.10),('boundaryCaptureCost',5)]:
 for a in arms.values():a['captured_orientation_weight']=weight
 answer=constraints.solve_grip_pair(C,axis,spacing,arms)
 assert answer is not None,'Expected feasible approved idle with gamma'
 data={}
 for side,sgn in [('Left',1),('Right',-1)]:
  h=answer[side];q=Matrix((h['across'],h['long'],h['normal'])).transposed().to_quaternion()@frames[side].to_quaternion().inverted()
  ref=reference[side];qerr=math.degrees(q.rotation_difference(ref['quaternion']).angle);qerr=min(qerr,360-qerr)
  residual=(h['wrist']+q@localgrips[side]-(C+axis*spacing*.5*sgn)).length
  data[side]={'bendDegrees':h['bendDegrees'],'bendPlaneDegrees':h['bendPlaneDegrees'],'gripResidual':residual,'armLengthError':h['armLengthError'],
   'approvedHandRotationDifferenceDegrees':qerr,'approvedWristPositionDifference':(h['wrist']-ref['wrist']).length,'approvedElbowPositionDifference':(h['elbow']-ref['elbow']).length}
  assert residual<1e-5 and h['armLengthError']<1e-5
  if label=='boundaryCaptureCost':
   print('BOUNDARY_DETAIL',side,json.dumps(data[side]),flush=True)
   assert qerr<.05 and data[side]['approvedWristPositionDifference']<.0001 and data[side]['approvedElbowPositionDifference']<.0015
 result['runs'][label]=data;print('IDLE_GAMMA',label,json.dumps(data),flush=True)
json.dump(result,open(os.path.join(ROOT,'docs/combat-revision/boss-idle-grip-gamma-check.json'),'w'),indent=2)
print('IDLE_GAMMA_CHECK_PASS',flush=True)
