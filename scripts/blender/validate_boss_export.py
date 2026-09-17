"""Check skinned GLB weights and compare runtime pose math to Blender output."""
from pathlib import Path
import json,struct
import numpy as np
from scipy.spatial import cKDTree
from scipy.spatial.transform import Rotation

ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'assets/rigs/reliquary-saint'
data=(OUT/'reliquary-saint-rig.glb').read_bytes();n=struct.unpack_from('<I',data,12)[0]
g=json.loads(data[20:20+n]);binary=data[28+n:]
types={5121:np.uint8,5123:np.uint16,5125:np.uint32,5126:np.float32}
sizes={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}
def accessor(index):
    a=g['accessors'][index];b=g['bufferViews'][a['bufferView']];dt=types[a['componentType']];width=sizes[a['type']]
    array=np.ndarray((a['count'],width),dtype=dt,buffer=binary,offset=b.get('byteOffset',0)+a.get('byteOffset',0),strides=(b.get('byteStride',np.dtype(dt).itemsize*width),np.dtype(dt).itemsize)).copy()
    if a['type']=='MAT4':array=array.reshape(-1,4,4).transpose(0,2,1)
    return array
def transform(node):
    if 'matrix' in node:return np.array(node['matrix']).reshape(4,4).T
    m=np.eye(4);m[:3,:3]=Rotation.from_quat(node.get('rotation',[0,0,0,1])).as_matrix()@np.diag(node.get('scale',[1,1,1]));m[:3,3]=node.get('translation',[0,0,0]);return m
parents={child:i for i,node in enumerate(g['nodes']) for child in node.get('children',[])}
rest=[transform(node) for node in g['nodes']]
def worlds(pose):
    cache={}
    def world(i):
        if i not in cache:
            m=rest[i].copy();name=g['nodes'][i].get('name')
            if name in pose:m=m@np.array(pose[name]).reshape(4,4).T
            cache[i]=world(parents[i])@m if i in parents else m
        return cache[i]
    return [world(i) for i in range(len(rest))]
meshnode=next(node for node in g['nodes'] if node.get('name')=='ReliquarySaint_Body')
p=g['meshes'][meshnode['mesh']]['primitives'][0];position=accessor(p['attributes']['POSITION']);joints=accessor(p['attributes']['JOINTS_0']);weight=accessor(p['attributes']['WEIGHTS_0'])
assert np.isfinite(weight).all() and np.all(weight>=0)
assert np.max(np.abs(weight.sum(1)-1))<1e-5
skin=g['skins'][meshnode['skin']];ibm=accessor(skin['inverseBindMatrices'])
assert joints.max()<len(skin['joints'])
assert not g.get('animations'), 'No animation clips approved for this stage'
def deform(pose):
    matrices=worlds(pose);joint=np.array([matrices[i] for i in skin['joints']])@ibm
    v=np.c_[position,np.ones(len(position))]
    return sum(np.einsum('nij,nj->ni',joint[joints[:,i]],v)*weight[:,i,None] for i in range(4))[:,:3]
source=np.load(OUT/'source-geometry.npz')['vertices']
C=np.array([[1,0,0],[0,0,1],[0,-1,0]])
rest_vertices=deform({});distance,mapping=cKDTree(source@C.T).query(rest_vertices)
assert distance.max()<1e-4, f'Rest shape changed: {distance.max()}'
poses=json.loads((OUT/'diagnostic-poses.json').read_text())['poses'];expected=np.load(OUT/'evaluated-poses.npz')
names={'rest':'rest','shoulder':'shoulder-test','leg':'leg-test','crouch':'planted-crouch','weapon':'weapon-grip'}
results={}
for key,reference in names.items():
    got=deform(poses[key]);target=expected[reference][mapping]@C.T
    error=np.linalg.norm(got-target,axis=1)
    results[key]={'maxErrorMetres':float(error.max()),'rmsErrorMetres':float(np.sqrt(np.mean(error**2)))}
    assert error.max()<.002,f'{key} differs from Blender: {error.max()}'
report={'passed':True,'exportedJoints':len(skin['joints']),'vertices':len(position),'restMaxErrorMetres':float(distance.max()),'weightsNormalized':True,'animationClips':0,'runtimePoseParity':results}
(OUT/'export-validation.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
