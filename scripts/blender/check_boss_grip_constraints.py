"""Verify importable exact grip helper against six feasible diagnostic targets."""
import os,sys,json
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'))
setup=open(os.path.join(ROOT,'scripts/blender/search_boss_grip_targets.py')).read().split('rng=np.random.default_rng')[0]
exec(compile(setup,'search_boss_grip_targets.py','exec'))
sys.path.insert(0,os.path.join(ROOT,'scripts/blender'))
import boss_grip_constraints as constraints
search=json.load(open(os.path.join(ROOT,'docs/combat-revision/boss-target-search-v6.json')));rows={}
for key,entry in search['frames'].items():
 clip,f=key.rsplit('-',1);frame(clip,int(f));c=entry['candidates'][0];arms={}
 for s in ['Left','Right']:
  S=P(B(s+'Arm'));E=P(B(s+'ForeArm'));W=P(B(s+'Hand'));a=M(B(s+'Hand')).to_quaternion()@(frames[s]@Vector((1,0,0)))
  sign=1 if a.dot(Vector(entry['originalAxis']))>=0 else-1
  arms[s]={'shoulder':S,'upper_length':(E-S).length,'forearm_length':(W-E).length,'captured_elbow':E,'captured_wrist':W,'grip_coefficients':coeffs[s],'across_sign':sign}
 C=Vector(c['center']);Q=Quaternion(c['weaponQuaternion']);A=Q@Vector((0,0,1))
 ev=body.evaluated_get(bpy.context.evaluated_depsgraph_get());vertices=[body.matrix_world@v.co for v in ev.data.vertices]
 trees={n:BVHTree.FromPolygons(vertices,p,all_triangles=False)for n,p in polygons.items()}
 callback=lambda center,q,spacing:constraints.shaft_clearance(center,q,spacing,c['rearAnchor'],trees,sections)
 answer=constraints.search_grip_targets(entry['originalCenter'],M(rig.pose.bones['WeaponSocket']).to_quaternion(),entry['originalSpacing'],arms,callback,[(C,Q,c['spacing'])])
 assert answer is not None,key+' expected feasible'
 row={}
 for s,sgn in [('Left',1),('Right',-1)]:
  h=answer['hands'][s];q=Matrix((h['across'],h['long'],h['normal'])).transposed().to_quaternion()@frames[s].to_quaternion().inverted()
  err=(h['wrist']+q@localgrips[s]-(C+A*(c['spacing']*.5*sgn))).length
  lengths=[abs((h['elbow']-arms[s]['shoulder']).length-arms[s]['upper_length']),abs((h['wrist']-h['elbow']).length-arms[s]['forearm_length'])]
  assert err<1e-5 and max(lengths)<1e-5 and abs(h['bendDegrees'])<=32.001,(key,s,err,lengths)
  row[s]={'gripResidual':err,'boneLengthResiduals':lengths,'wristBend':h['bendDegrees']}
 row['shaftGap']=answer['minimumShaftSurfaceGap']
 repeat=constraints.solve_grip_pair(C,A,c['spacing'],arms,answer['hands'],maximum_hand_angle_step=.5,maximum_bend_step_degrees=.1)
 assert repeat is not None,key+' repeated pose should satisfy angular limits'
 row['repeatMaximumHandStepDegrees']=max(h['handAngleStepDegrees']for h in repeat.values())
 row['repeatMaximumBendStepDegrees']=max(abs(h['bendStepDegrees'])for h in repeat.values())
 assert row['repeatMaximumHandStepDegrees']<.1 and row['repeatMaximumBendStepDegrees']<.01,key
 incompatible={s:dict(h,across=-h['across'],normal=-h['normal'])for s,h in answer['hands'].items()}
 assert constraints.solve_grip_pair(C,A,c['spacing'],arms,incompatible,maximum_hand_angle_step=1) is None,key+' impossible 180-degree hand flip must be rejected'
 row['impossibleHandFlipRejected']=True
 rows[key]=row;print('HELPER_PASS',key,json.dumps(row),flush=True)
json.dump(rows,open(os.path.join(ROOT,'docs/combat-revision/boss-grip-constraints-check.json'),'w'),indent=2)
