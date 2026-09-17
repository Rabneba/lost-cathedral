import json,os,math
import numpy as np
from mathutils import Vector,Quaternion
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'));cloud=np.asarray(json.load(open(os.path.join(ROOT,'docs/combat-revision/scythe-socket-vertex-cloud.json')))['xyz']).reshape((-1,3));blade=cloud[(cloud[:,2]>2.25)&(cloud[:,0]>.2)];rows=json.load(open(os.path.join(ROOT,'docs/combat-revision/boss-candidate-bake-v60-close-inward.json')))['sweep']['samples'];target=np.asarray([-.34473,-1.17579,1.56026]);target2=np.asarray([-.34473,-1.32579,1.56026]);out=[]
for roll in range(-180,181,5):
 closest=[100,None];closest2=[100,None];floor=100
 for f in range(60,101):
  r=rows[f];baseQ=Quaternion(r['weaponQuaternion']);Q=baseQ@Quaternion(Vector((0,0,1)),math.radians(roll));A=baseQ@Vector((0,0,1));origin=Vector(r['center'])-A*(1.5+r['spacing']*.5);world=(blade@np.asarray(Q.to_matrix()).T+np.asarray(origin))*1.3;floor=min(floor,float(np.min(cloud@np.asarray(Q.to_matrix())[2,:]+origin.z))*1.3)
  for trg,best in[(target,closest),(target2,closest2)]:
   d=np.linalg.norm(world-trg,axis=1);i=int(np.argmin(d))
   if d[i]<best[0]:best[:]=[float(d[i]),{'frame':f,'world':list(world[i]),'local':list(blade[i])}]
 out.append({'roll':roll,'nearest14':closest,'nearest155':closest2,'floor':floor})
out.sort(key=lambda r:max(r['nearest14'][0],r['nearest155'][0]));json.dump(out,open(os.path.join(ROOT,'docs/combat-revision/boss-sweep-choke150-roll-feasibility.json'),'w'),indent=2);print(json.dumps(out[:8],indent=1))
