# Decimate the two cathedral prop GLBs generated last night so they can be used
# sixteen times over without eating a quarter of the triangle budget.
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/blender/decimate-props.py
#
# Reads only, writes only NEW files into assets/environment-lod/. The source
# GLBs are never modified, moved or removed.
import bpy, os, sys, math

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
JOBS = [
    ("assets/a-gothic-cathedral-hooded-mourner-statue-cmu38gvb.glb",
     "assets/environment-lod/mourner-lod.glb", 8000),
    ("assets/a-gothic-cathedral-gargoyle-waterspout-g-cmu38gx4.glb",
     "assets/environment-lod/gargoyle-lod.glb", 5000),
]

def tri_count(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)

for src, dst, budget in JOBS:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT, src))
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    if not meshes:
        print("NO MESH in", src); continue
    for o in meshes:
        bpy.context.view_layer.objects.active = o
        o.select_set(True)
    bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    before = tri_count(obj)
    # Weld first: Meshy output is full of duplicate vertices, and a collapse
    # decimate on an unwelded mesh shreds the silhouette instead of simplifying.
    bpy.ops.object.modifier_add(type='WELD')
    obj.modifiers[-1].merge_threshold = 0.0006
    bpy.ops.object.modifier_apply(modifier=obj.modifiers[-1].name)
    welded = tri_count(obj)
    if welded > budget:
        bpy.ops.object.modifier_add(type='DECIMATE')
        m = obj.modifiers[-1]
        m.decimate_type = 'COLLAPSE'
        m.ratio = max(0.02, budget / float(welded))
        bpy.ops.object.modifier_apply(modifier=m.name)
    bpy.ops.object.shade_smooth()
    after = tri_count(obj)
    out = os.path.join(ROOT, dst)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB',
                              export_materials='NONE', export_yup=True,
                              use_selection=False, export_apply=True)
    print("DECIMATED %s: %d -> %d (welded %d) -> %s" % (src, before, after, welded, dst))
print("DONE")
