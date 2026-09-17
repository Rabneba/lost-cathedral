import json,os,math,time
import numpy as np
from mathutils import Vector,Quaternion
from mathutils.bvhtree import BVHTree
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'));cloud=np.asarray(json.load(open(os.path.join(ROOT,'docs/combat-revision/scythe-socket-vertex-cloud.json')))['xyz']).reshape((-1,3));blade=cloud[(cloud[:,2]>2.25)&(cloud[:,0]>.2)][::8];target=json.load(open(os.path.join(ROOT,'docs/combat-revision/player-idle-armor-target.json')));vertices=np.asarray(target['xyz']).reshape((-1,3));verts=vertices[:,[0,2,1]]*np.array([1,-1,1]);tris=np.asarray(target['triangles']).reshape((-1,3));tree=BVHTree.FromPolygons(verts,tris,all_triangles=True);rows=json.load(open(os.path.join(ROOT,'docs/combat-revision/boss-candidate-bake-v60-close-inward.json')))['sweep']['samples'];out=[];began=time.time()
for rear in[1.3,1.4,1.5,1.6]:
 for roll in range(-180,181,10):
  best=None
  for f in range(62,101,2):
   r=rows[f];baseQ=Quaternion(r['weaponQuaternion']);Q=baseQ@Quaternion(Vector((0,0,1)),math.radians(roll));A=baseQ@Vector((0,0,1));origin=Vector(r['center'])-A*(rear+r['spacing']*.5);world=(blade@np.asarray(Q.to_matrix()).T+np.asarray(origin))*1.3
   for i,p in enumerate(world):
    nearest=tree.find_nearest(Vector(p));distance=nearest[3]
    if best is None or distance<best['gap']:best={'rear':rear,'roll':roll,'frame':f,'gap':distance,'bladeLocal':list(blade[i]),'bladeWorld':list(p),'armorPoint':list(nearest[0]),'armorRegion':target['regionNames'][target['triangleRegions'][nearest[2]]]}
  out.append(best)
 print('ARMOR_SEARCH',rear,'best',min([r for r in out if r['rear']==rear],key=lambda r:r['gap']),'seconds',time.time()-began,flush=True)
out.sort(key=lambda r:r['gap']);json.dump(out,open(os.path.join(ROOT,'docs/combat-revision/boss-sweep-actual-armor-search.json'),'w'),indent=2)
