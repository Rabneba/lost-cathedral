"""Apply diagnostic target solutions in memory; verify actual deformed mesh.
Does not save any .blend or production asset. New diagnostics only.
"""
import os,sys,json,math
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'))
setup=open(os.path.join(ROOT,'scripts/blender/search_boss_grip_targets.py')).read().split('rng=np.random.default_rng')[0]
exec(compile(setup,'search_boss_grip_targets.py','exec'))
sys.path.insert(0,os.path.join(ROOT,'scripts/blender'))
import boss_grip_constraints as constraints
result={'source':PATH,'frames':{},'scope':'six independent target poses; actual evaluated hood and torso, not a continuous animation or full blade audit'}
source=json.load(open(os.path.join(ROOT,'docs/combat-revision/boss-target-search-v6.json')))
inv=rig.matrix_world.inverted()
def setworld(p,m):p.matrix=inv@m;bpy.context.view_layer.update()
def rotate(p,q):
 m=M(p);v=m.translation.copy();setworld(p,Matrix.Translation(v)@q.to_matrix().to_4x4()@Matrix.Translation(-v)@m)
def aim(p,child,target):
 a=P(child)-P(p);b=target-P(p)
 if min(a.length,b.length)>1e-6:rotate(p,a.normalized().rotation_difference(b.normalized()))
for key,search in source['frames'].items():
 clip,f=key.rsplit('-',1);f=int(f);rows=[]
 for index,c in enumerate(search['candidates']):
  frame(clip,f)
  for side,hand in c['hands'].items():
   aim(B(side+'Arm'),B(side+'ForeArm'),Vector(hand['elbow']))
   aim(B(side+'ForeArm'),B(side+'Hand'),Vector(hand['wrist']))
   q=Quaternion(hand['quaternion']);hm=M(B(side+'Hand'))
   setworld(B(side+'Hand'),Matrix.LocRotScale(hm.translation,q,hm.to_scale()))
   rest=B(side+'ForeArm').bone.matrix_local.to_quaternion().inverted()@B(side+'Hand').bone.matrix_local.to_quaternion()
   localnormal=rest@(frames[side]@Vector((0,0,1)))
   fore=B(side+'ForeArm');axis=(P(B(side+'Hand'))-P(fore)).normalized()
   a=M(fore).to_quaternion()@localnormal;b=q@(frames[side]@Vector((0,0,1)))
   a-=axis*a.dot(axis);b-=axis*b.dot(axis)
   a.normalize();b.normalize();angle=math.atan2(axis.dot(a.cross(b)),a.dot(b))
   hm=M(B(side+'Hand')).copy();rotate(fore,Quaternion(axis,angle));setworld(B(side+'Hand'),hm)
  Q=Quaternion(c['weaponQuaternion']);A=Q@Vector((0,0,1));C=Vector(c['center'])
  origin=C-A*(c['rearAnchor']+c['spacing']*.5)
  setworld(rig.pose.bones['WeaponSocket'],Matrix.LocRotScale(origin,Q,Vector((1,1,1))))
  ev=body.evaluated_get(bpy.context.evaluated_depsgraph_get());vertices=[body.matrix_world@v.co for v in ev.data.vertices]
  trees={n:BVHTree.FromPolygons(vertices,p,all_triangles=False)for n,p in polygons.items()}
  row={'candidateIndex':index,'hands':{},'regions':{}}
  for s,sgn in [('Left',1),('Right',-1)]:
   wrist=P(B(s+'Hand'));elbow=P(B(s+'ForeArm'));long=(P(B(s+'HandMiddle1'))-wrist).normalized()
   row['hands'][s]={'wristBendDegrees':math.degrees(long.angle(wrist-elbow)),
    'gripError':(grip(s)-(C+A*(c['spacing']*.5*sgn))).length,
    'wristTargetError':(wrist-Vector(c['hands'][s]['wrist'])).length,
    'elbowTargetError':(elbow-Vector(c['hands'][s]['elbow'])).length}
  points=[(origin+Q@local,r)for local,r in sections]
  for name,tree in trees.items():
   closest=[];cross=0
   for j,(p,r)in enumerate(points):
    near=tree.find_nearest(p);closest.append((near[3]-r,float(sections[j][0].z)))
    if j:
     a=points[j-1][0];d=p-a
     if tree.ray_cast(a,d.normalized(),d.length)[0]is not None:cross+=1
   row['regions'][name]={'minimumShaftSurfaceGap':min(closest)[0],'worstShaftZ':min(closest)[1],'centerlineCrossings':cross}
  row['pass']=all(h['wristBendDegrees']<35 and h['gripError']<.001 for h in row['hands'].values())and all(r['minimumShaftSurfaceGap']>=.012 and r['centerlineCrossings']==0 for r in row['regions'].values())
  rows.append(row)
  if row['pass']:break
 result['frames'][key]=rows
 print('VERIFIED',key,json.dumps(rows[-1]),flush=True)
json.dump(result,open(os.path.join(ROOT,'docs/combat-revision/boss-target-search-v6-verified.json'),'w'),indent=2)
print('VERIFICATION_FINISHED',flush=True)
