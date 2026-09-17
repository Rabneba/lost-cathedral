"""Cache fixed body/reference geometry for bounded whole-trajectory search.
Only new diagnostic/candidate files; never changes approved production assets.
"""
import os,sys,textwrap,hashlib
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'))
source=open(os.path.join(ROOT,'scripts/blender/rebuild_boss_combat.py')).read()
setup=source.split('reports={};candidates={}')[0]
exec(compile(setup,'rebuild_boss_combat.py','exec'))
DIR=os.path.join(ROOT,'assets/combat-revision/boss/trajectory-context');os.makedirs(DIR,exist_ok=True)
block=source.split('  filtered=mix(',1)[1].split('  result=constrained_grips(',1)[0]
block='  filtered=mix('+block
prepare=compile(textwrap.dedent(block),'prepare_fixed_boss_frame','exec')
indices=sorted(set(i for faces in region_polygons.values()for face in faces for i in face))
indexmap={old:new for new,old in enumerate(indices)}
faces={region:[[indexmap[i]for i in face]for face in polys]for region,polys in region_polygons.items()}
def serial(v):
 if isinstance(v,dict):return {k:serial(x)for k,x in v.items()}
 if isinstance(v,(Vector,Quaternion,Matrix)):return list(v)if not isinstance(v,Matrix)else[list(r)for r in v]
 if isinstance(v,np.ndarray):return v.tolist()
 return v
names=[p.name for p in bones]
meta={'sourceSha256':hashlib.sha256(source.encode()).hexdigest(),'fps':FPS,'bones':names,'faces':faces,
 'handFrames':{s:list(q)for s,q in hand_frame.items()},'localGrip':{s:list(v)for s,v in local_grip.items()},'forearmNormal':{s:list(v)for s,v in forearm_normal.items()},'shaftSections':[[list(c),r]for c,r in shaft_sections],
 'idlePose':[[list(r)for r in idle[0][n]]for n in names],'clips':{}}
apply(idle[0]);idle_hands={}
for s in local_axis:
 hq=world(B(s+'Hand')).to_quaternion();F=(pos(B(s+'Hand'))-pos(B(s+'ForeArm'))).normalized();frameq=hq@hand_frame[s]
 A=frameq@Vector((1,0,0));L=frameq@Vector((0,1,0));N=frameq@Vector((0,0,1));gamma=math.radians(idle_bend_plane[s])
 beta=math.degrees(math.atan2(F.dot(A)*math.cos(gamma)+F.dot(N)*math.sin(gamma),F.dot(L)))
 idle_hands[s]={'elbow':list(pos(B(s+'ForeArm'))),'wrist':list(pos(B(s+'Hand'))),'across':list(A),'long':list(L),'normal':list(N),'bendDegrees':beta,'bendPlaneDegrees':idle_bend_plane[s],'cost':0}
meta['idleResult']={'center':list((grip('Left')+grip('Right'))*.5),'quaternion':list(ref_weapon.to_quaternion()),'axis':list(ref_weapon.to_quaternion()@Vector((0,0,1))),'spacing':.95,'hands':idle_hands,'minimumShaftSurfaceGap':.1,'score':0}
for source_name,frames in sources.items():
 name=source_name.replace('source-','');signs={};entries=[];verts=[];poses=[]
 for f,raw in enumerate(frames):
  exec(prepare,globals())
  entries.append({'frame':f,'center':list(center),'quaternion':list(q),'spacing':spacing,'rearAnchor':rear,'sourceWeight':source_weight,'arms':serial(arms)})
  poses.append(np.asarray([np.asarray(bones[n].matrix_basis)for n in names],dtype=np.float32))
  ev=body.evaluated_get(bpy.context.evaluated_depsgraph_get());m=body.matrix_world
  verts.append(np.asarray([m@ev.data.vertices[i].co for i in indices],dtype=np.float32))
  if f%30==0:print('CONTEXT',name,f,'verts',len(indices),flush=True)
 meta['clips'][name]=entries
 np.savez_compressed(os.path.join(DIR,name+'.npz'),vertices=np.asarray(verts),poses=np.asarray(poses))
 json.dump(meta,open(os.path.join(DIR,'context.json'),'w'))
apply(idle[0]);bpy.ops.wm.save_as_mainfile(filepath=os.path.join(DIR,'template.blend'))
print('TRAJECTORY_CONTEXT_READY',DIR,flush=True)
