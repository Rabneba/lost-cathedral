"""Anatomy-guided surface weights for the approved many-armed boss.

Run with system Python (numpy/scipy). Nothing in the source mesh is changed.
Seams are welded only in a temporary graph, never in the rendered geometry.
"""
from pathlib import Path
import json
import numpy as np
from scipy.spatial import cKDTree
from scipy.sparse import coo_matrix, diags
from scipy.sparse.csgraph import connected_components, dijkstra

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'assets/rigs/reliquary-saint'
source=np.load(OUT/'source-geometry.npz'); verts=source['vertices']; faces=source['faces']
bones=[]; chains=[]

def add(name,head,tail,parent=None,region='core',rigid=False):
    bones.append(dict(name=name,head=list(head),tail=list(tail),parent=parent,region=region,rigid=rigid))
    return name

add('DEF_pelvis',(0,.16,4.08),(0,.13,4.55))
add('DEF_spine',(0,.13,4.55),(0,.09,5.12),'DEF_pelvis')
add('DEF_chest',(0,.09,5.12),(0,.08,6.12),'DEF_spine')
add('DEF_neck',(0,.08,6.12),(0,-.05,6.45),'DEF_chest')
add('DEF_mask',(0,-.10,6.45),(0,-.1,7.14),'DEF_neck',rigid=True)
add('DEF_frame',(0,.30,6.93),(0,.30,7.5),'DEF_chest',rigid=True)
add('DEF_relic',(0,-.2,4.55),(0,-.25,5.85),'DEF_chest',rigid=True)

def point(x,z,y=None):
    if y is None:
        near=verts[(verts[:,0]-x)**2+(verts[:,2]-z)**2 < .07**2]
        if len(near)<6: near=verts[np.argsort((verts[:,0]-x)**2+(verts[:,2]-z)**2)[:30]]
        y=float((np.quantile(near[:,1],.08)+np.quantile(near[:,1],.92))/2)
    return [float(x),float(y),float(z)]

# Landmark coordinates come from orthographic views and mesh depth samples.
anatomy={
 'main': [( .68,5.51,.15),(.975,4.225,.19),(1.3875,2.31,-.70),(1.44,1.96,-.85)],
 'spire':[(.45,6.14,.20),(1.275,6.97,-.13),(1.54,4.75,-.43),(1.84,3.44,-.84),(1.91,3.05,-.96)],
 'mantle':[(.66,5.89,.35),(1.69,5.635,.60),(2.775,5.67,.87),(3.21,4.97,.87),(3.45,3.475,.49),(3.71,2.96,.40)],
 'outer':[(1.52,6.02,.50),(2.39,6.64,.87),(3.02,7.62,1.07),(4.2,6.61,.69),(5.04,5.65,.18),(4.85,5.0,-.22)],
 'leg':[(.37,4.12,.23),(.64,2.90,-.54),(.83,1.0,.01),(.94,.35,-.28)]
}
claw_points={
 # The three main claws overlap in front view but occupy different depths.
 # Explicit depth landmarks follow each connected finger surface to its tip.
 'main': [[(1.26,1.95,-.81),(1.12,1.47,-1.0),(1.2035,1.264,-.9541)],
          [(1.41,1.94,-.60),(1.45,1.42,-.51),(1.2418,1.079,-.3987)],
          [(1.44,1.94,-.80),(1.51,1.24,-.90),(1.2421,.9231,-.8665)]],
 'spire': [[(1.74,3.02),(1.58,2.49),(1.76,2.12)],[(1.86,2.98),(1.80,2.38),(1.94,1.99)],[(1.99,3.00),(2.16,2.48),(1.95,2.20)]],
 'mantle': [[(3.54,2.96),(3.38,2.25),(3.20,2.03)],[(3.72,2.88),(3.91,2.10),(3.73,1.62)],[(3.91,2.95),(4.35,2.39),(4.23,1.67)]],
 'outer': [[(4.76,4.92),(4.17,4.28),(4.32,3.88)],[(4.93,4.97),(4.81,4.25),(4.05,3.69)]]
}
for side,sign in [('L',1),('R',-1)]:
 for role,raw in anatomy.items():
    pts=[point(sign*x,z,y) for x,z,y in raw]
    names=[];parent='DEF_pelvis' if role=='leg' else 'DEF_chest'
    region=f'outer.{side}' if role=='outer' else 'core'
    for i,(head,tail) in enumerate(zip(pts[:-1],pts[1:])):
        name=f'DEF_{role}_{i:02d}.{side}'
        add(name,head,tail,parent,region);names.append(name);parent=name
    chains.append(dict(key=f'{role}.{side}',role=role,side=side,bones=names,points=pts,
                       ikEnd=names[-2],endBone=names[-1],ikChainLength=2))
    if role=='leg':
        add(f'DEF_toes.{side}',pts[-1],point(sign*1.07,.11,-.55),parent,region)
    else:
        for finger,raw_points in enumerate(claw_points[role]):
            claw=[point(sign*p[0],p[1],p[2] if len(p)>2 else None) for p in raw_points]
            # Root matches palm; actual finger bases are farther along the hand.
            for segment in range(2):
                name=f'DEF_{role}_claw{finger+1}_{segment+1}.{side}'
                add(name,claw[segment],claw[segment+1],parent if segment==0 else previous,region)
                previous=name

(OUT/'rig-anatomy.json').write_text(json.dumps(dict(heightMetres=8,front='-Y in Blender; +Z in glTF',bones=bones,chains=chains),indent=2)+'\n')
unique,inverse=np.unique(np.round(verts,5),axis=0,return_inverse=True)
edge=inverse[faces[:,[0,1,1,2,2,0]].reshape(-1,2)]
edge=np.unique(np.sort(edge,axis=1),axis=0)
edge=edge[edge[:,0]!=edge[:,1]]
length=np.linalg.norm(unique[edge[:,0]]-unique[edge[:,1]],axis=1)
graph=coo_matrix((np.r_[length,length],(np.r_[edge[:,0],edge[:,1]],np.r_[edge[:,1],edge[:,0]])),shape=(len(unique),len(unique))).tocsr()
count,labels=connected_components(graph,directed=False)
core=int(labels[np.argmin(np.linalg.norm(unique-[0,0,5.3],axis=1))])
left=int(labels[np.argmax(unique[:,0])]);right=int(labels[np.argmin(unique[:,0])])
regions={'core':core,'outer.L':left,'outer.R':right}
N=len(unique); B=len(bones)
euclidean=np.full((B,N),1e4,dtype=np.float32)
parameters=np.zeros((B,N),dtype=np.float32)
for i,b in enumerate(bones):
    h=np.array(b['head']);t=np.array(b['tail']);direction=t-h
    u=np.clip(((unique-h)@direction)/(direction@direction),0,1)
    dist=np.linalg.norm(unique-(h+u[:,None]*direction),axis=1)
    dist[labels!=regions[b['region']]]=1e4
    euclidean[i]=dist;parameters[i]=u

# Hard anatomical regions protect the mask, circular frame, and internal relic.
x,y,z=unique.T
frame=(np.abs(x)<1.14)&(z>6.24)&(y>.19)
mask=(np.abs(x)<.36)&(z>6.30)&(z<7.24)&(y<.19)
relic=(np.abs(x)<.27)&(z>4.54)&(z<5.94)&(y<.09)
chest=(np.abs(x)<.62)&(z>5.25)&(z<6.07)
pelvis=(np.abs(x)<.46)&(z>4.10)&(z<4.48)
hard={ 'DEF_frame':frame,'DEF_mask':mask,'DEF_chest':chest,'DEF_pelvis':pelvis,'DEF_relic':relic }
for name,region_mask in hard.items():
    idx=next(i for i,b in enumerate(bones) if b['name']==name)
    euclidean[:,region_mask]=1e4;euclidean[idx,region_mask]=0
closest=euclidean.argmin(axis=0)
surface=np.full_like(euclidean,np.inf)
seed_counts={}
for i,b in enumerate(bones):
    owned=(closest==i)
    candidate=owned&(parameters[i]>.12)&(parameters[i]<.88)
    if b['name'] in hard: candidate=hard[b['name']]
    if not np.any(candidate): candidate=owned
    if not np.any(candidate):
        # A tiny decorative control can have no mesh surface; sockets are separate.
        seed_counts[b['name']]=0;continue
    radius=float(np.quantile(euclidean[i,candidate],.38))+.025
    seeds=np.flatnonzero(candidate&(euclidean[i]<=radius))
    if not len(seeds):seeds=np.flatnonzero(candidate)[:1]
    seed_counts[b['name']]=len(seeds)
    dist=dijkstra(graph,directed=False,indices=seeds,min_only=True)
    surface[i]=dist+euclidean[i]*.35
    print(f'{i+1:02d}/{B} {b["name"]}: {len(seeds)} seeds',flush=True)

# Choose four strongest surface influences, sharpen long rigid lengths, then
# restrict blending to directly related bones at their actual junctions.
nearest=surface.argmin(axis=0)
lookup={b['name']:i for i,b in enumerate(bones)}
for i,b in enumerate(bones):
    related={i}
    if b['parent'] in lookup:related.add(lookup[b['parent']])
    related.update(j for j,child in enumerate(bones) if child['parent']==b['name'])
    columns=np.flatnonzero(nearest==i)
    unrelated=np.array([j for j in range(B) if j not in related])
    surface[np.ix_(unrelated,columns)]=np.inf
indices=np.argpartition(surface,3,axis=0)[:4]
dist=np.take_along_axis(surface,indices,axis=0)
best=dist.min(axis=0)
weights=np.exp(-np.minimum((dist-best)/.10,80))
weights[~np.isfinite(dist)]=0
weights/=weights.sum(axis=0)
weights[weights<.018]=0
weights/=weights.sum(axis=0)
for name,region_mask in hard.items():
    idx=lookup[name];indices[:,region_mask]=idx;weights[:,region_mask]=0;weights[0,region_mask]=1
# Relax boundaries over the actual surface while pinning rigid core regions.
# This removes discontinuities at shared shoulder/hip surfaces. Long sections
# retain their unit weights because their neighbors belong to the same bone.
dense=np.zeros((N,B),dtype=np.float32)
for slot in range(4):np.add.at(dense,(np.arange(N),indices[slot]),weights[slot])
adjacency=graph.copy();adjacency.data[:]=1
average=diags(1/np.asarray(adjacency.sum(axis=1)).ravel())@adjacency
for _ in range(64):
    dense=.55*dense+.45*(average@dense)
    for name,region_mask in hard.items():
        dense[region_mask]=0;dense[region_mask,lookup[name]]=1
indices=np.argpartition(-dense,3,axis=1)[:,:4].T
weights=np.take_along_axis(dense,indices.T,axis=1).T
weights[weights<.005]=0;weights/=weights.sum(axis=0)
assert np.isfinite(weights).all()
assert np.max(np.abs(weights.sum(axis=0)-1))<1e-5
np.savez_compressed(OUT/'skin-weights.npz',indices=indices[:,inverse].T.astype(np.int32),weights=weights[:,inverse].T.astype(np.float32))
report=dict(vertices=len(verts),triangles=len(faces),surfaceVertices=N,connectedComponents=count,bones=B,
            unweightedVertices=int(np.sum(weights.sum(0)==0)),maxInfluences=4,
            sourceGeometryUnchanged=True,seeds=seed_counts,
            bonesWithoutSurface=[name for name,c in seed_counts.items() if c==0])
(OUT/'weight-report.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({k:v for k,v in report.items() if k!='seeds'}),flush=True)
