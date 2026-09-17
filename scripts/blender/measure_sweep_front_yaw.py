import json,os,math,sys
import numpy as np
from mathutils import Vector,Quaternion
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'));cloud=np.asarray(json.load(open(os.path.join(ROOT,'docs/combat-revision/scythe-socket-vertex-cloud.json')))['xyz']).reshape((-1,3));blade=cloud[cloud[:,2]>2.25];rows=json.load(open(os.path.join(ROOT,'docs/combat-revision/boss-candidate-bake-v58-close-whole-clear.json')))['sweep']['samples'];out={}
for yaw in range(-30,31,5):
 Y=Quaternion(Vector((0,0,1)),math.radians(yaw));best={d:(100,None)for d in[1.4,1.55,2,2.5]}
 for f in range(60,101):
  r=rows[f];Q=Quaternion(r['weaponQuaternion']);A=Q@Vector((0,0,1));origin=Vector(r['center'])-A*(r['rearAnchor']+r['spacing']*.5);v=(blade@np.asarray(Q.to_matrix()).T+np.asarray(origin))*1.3;v=v@np.asarray(Y.to_matrix()).T;ze=np.maximum(.45-v[:,2],np.maximum(v[:,2]-1.65,0))
  for d in best:
   ds=np.sqrt(v[:,0]**2+(v[:,1]+d)**2+ze*ze);i=int(np.argmin(ds));value=float(ds[i])
   if value<best[d][0]:best[d]=(value,{'frame':f,'vertex':list(v[i]),'bearing':math.degrees(math.atan2(v[i,0],-v[i,1])),'radial':float(np.linalg.norm(v[i,:2]))})
 out[yaw]=best
json.dump(out,open(os.path.join(ROOT,'docs/combat-revision/boss-sweep-front-yaw.json'),'w'),indent=2);print(json.dumps(out,indent=1))
