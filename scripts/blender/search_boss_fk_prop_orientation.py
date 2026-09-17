"""Diagnostic only: which hand is below the scythe blade, with arm FK untouched.
Scores physical cutting-wing placement, not combat authorization.
"""
import bpy,json,os,math,numpy as np
from mathutils import Vector,Quaternion
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'));bpy.ops.wm.open_mainfile(filepath=os.path.join(ROOT,'assets/combat-revision/boss/v70-fk-wrist-limit/boss-combat-candidate.blend'));rig=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE');rig.animation_data.action=None
for t in rig.animation_data.nla_tracks:t.mute=t.name!='slam'
cloud=np.asarray(json.load(open(os.path.join(ROOT,'docs/combat-revision/scythe-socket-vertex-cloud.json')))['xyz']).reshape((-1,3));wing=cloud[(cloud[:,2]>2.25)&(cloud[:,0]>.2)];Z=Vector((0,0,1));Y=Vector((0,1,0));rows=[]
def P(n):return(rig.matrix_world@rig.pose.bones['mixamorig:'+n].matrix).translation.copy()
def grip(s):return sum([P(s+'Hand'+d+str(j))for d in['Index','Middle','Ring','Pinky']for j in[1,3]],Vector())*.1+P(s+'HandThumb3')*.2
for f in range(35,126):
 bpy.context.scene.frame_set(f);bpy.context.view_layer.update();wm=rig.matrix_world@rig.pose.bones['WeaponSocket'].matrix;rows.append({'frame':f,'q':wm.to_quaternion().copy(),'left':grip('Left'),'right':grip('Right')})
results=[]
for reverse in[False,True]:
 for rear in[.3,.6,.9,1.2]:
  for roll in range(-180,181,15):
   best={str(d):{'distance':100}for d in[1.4,2.,2.5,3.]};low=100
   for r in rows:
    q=r['q']@(Quaternion(Y,math.pi)if reverse else Quaternion());q=q@Quaternion(Z,math.radians(roll));axis=q@Z;origin=r['left'if reverse else'right']-axis*rear;rotation=np.asarray(q.to_matrix());world=(wing@rotation.T+np.asarray(origin))*1.3;low=min(low,float(np.min(cloud@rotation[2,:]+origin.z))*1.3)
    for d in[1.4,2.,2.5,3.]:
     # Segment around actual player upper body; exact triangle intersection follows independently.
     target=np.stack([np.zeros(len(world)),np.full(len(world),-d),np.clip(world[:,2],.35,1.6)],axis=1);dist=np.linalg.norm(world-target,axis=1);i=int(np.argmin(dist))
     if dist[i]<best[str(d)]['distance']:best[str(d)]={'distance':float(dist[i]),'frame':r['frame'],'point':list(world[i]),'q':list(q),'origin':list(origin)}
   results.append({'reverse':reverse,'rear':rear,'roll':roll,'floor':low,'best':best})
results.sort(key=lambda r:min(v['distance']for v in r['best'].values())+max(0,-r['floor'])*5);json.dump(results,open(os.path.join(ROOT,'docs/combat-revision/boss-v70-prop-orientation-search.json'),'w'),indent=2)
for reverse in[False,True]:
 a=[r for r in results if r['reverse']==reverse and r['floor']>=.015];print('BEST',reverse,a[:2],flush=True)
