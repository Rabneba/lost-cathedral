import bpy, os, json, struct, hashlib
root=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
source=os.path.join(root,'assets/a-single-weathered-gothic-cathedral-fune-cmu1gsre.glb')
out=os.path.join(root,'assets/environment-lod/funerary-monument-lod.glb')
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=source)
report=[]
for obj in bpy.context.scene.objects:
    if obj.type!='MESH': continue
    before=sum(len(p.vertices)-2 for p in obj.data.polygons)
    bpy.context.view_layer.objects.active=obj
    mod=obj.modifiers.new('Distant silhouette preservation','DECIMATE')
    mod.ratio=.25
    mod.use_collapse_triangulate=True
    bpy.ops.object.modifier_apply(modifier=mod.name)
    after=sum(len(p.vertices)-2 for p in obj.data.polygons)
    report.append({'mesh':obj.name,'source_triangles':before,'lod_triangles':after})
bpy.ops.export_scene.gltf(filepath=out,export_format='GLB',export_animations=False,export_apply=True)
def image_hashes(path):
    blob=open(path,'rb').read()
    json_length=struct.unpack_from('<I',blob,12)[0]
    gltf=json.loads(blob[20:20+json_length])
    base=20+json_length+8
    result={}
    for image in gltf['images']:
        view=gltf['bufferViews'][image['bufferView']]
        start=base+view.get('byteOffset',0)
        result[image['name']]=hashlib.sha256(blob[start:start+view['byteLength']]).hexdigest()
    return result
original_hashes=image_hashes(source)
lod_hashes=image_hashes(out)
assert original_hashes==lod_hashes, 'LOD export changed embedded texture bytes'
with open(os.path.join(root,'docs/environment-lod-audit.json'),'w') as f:
    json.dump({'source':source,'asset':out,'ratio':.25,'meshes':report,'use':'Side shrines beyond 22m; near and apse shrine retain approved original.','embeddedTextureHashesIdentical':True,'textureHashes':lod_hashes,'samplerWarning':'Blender noted duplicate texture shader nodes; runtime reuses original materials and textures for both LODs.'},f,indent=2)
print(json.dumps(report))
