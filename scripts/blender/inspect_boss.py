import bpy, math, json, os
import numpy as np
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
OUT = os.path.join(ROOT, 'assets/rigs/reliquary-saint')
os.makedirs(OUT, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT, 'assets/create-the-exact-isolated-boss-body-show-cmu12uau.glb'))
obj = next(o for o in bpy.context.scene.objects if o.type == 'MESH')
obj.name = 'ReliquarySaint_Body'
obj.rotation_mode = 'XYZ'
obj.rotation_euler.z -= math.pi / 2
bpy.context.view_layer.objects.active = obj
obj.select_set(True)
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
coords = np.array([v.co[:] for v in obj.data.vertices], dtype=np.float64)
low, high = coords.min(axis=0), coords.max(axis=0)
scale = 8.0 / (high[2] - low[2])
center = (low + high) / 2
offset = np.array([center[0], center[1], low[2]])
for v in obj.data.vertices: v.co = (np.array(v.co[:]) - offset) * scale
coords = np.array([v.co[:] for v in obj.data.vertices], dtype=np.float64)
tri = np.array([p.vertices[:] for p in obj.data.polygons], dtype=np.int32)
np.savez_compressed(os.path.join(OUT,'source-geometry.npz'),vertices=coords,faces=tri)
print('MESH_BOUNDS',coords.min(axis=0),coords.max(axis=0),flush=True)
print('MESH_COUNTS',len(coords),len(tri),flush=True)
scene=bpy.context.scene
scene.render.engine='CYCLES';scene.cycles.samples=16
scene.render.resolution_x=1600;scene.render.resolution_y=1200;scene.render.resolution_percentage=100
scene.world=bpy.data.worlds.new('ReviewWorld');scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.14,.16,.18,1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value=.7
scene.view_settings.view_transform='Standard'
for name,loc,energy,size in [('Key',(4,-6,11),1800,7),('Fill',(-5,-3,6),1100,5),('Rim',(2,4,9),1500,4)]:
 data=bpy.data.lights.new(name,'AREA');data.energy=energy;data.shape='DISK';data.size=size
 light=bpy.data.objects.new(name,data);scene.collection.objects.link(light);light.location=loc;light.rotation_euler=(Vector((0,0,4))-light.location).to_track_quat('-Z','Y').to_euler()
data=bpy.data.cameras.new('InspectionCamera');camera=bpy.data.objects.new('InspectionCamera',data);scene.collection.objects.link(camera);scene.camera=camera;data.type='ORTHO';data.ortho_scale=12
for view,loc in [('front',(0,-20,4)),('side',(20,0,4))]:
 camera.location=loc;camera.rotation_euler=(Vector((0,0,4))-camera.location).to_track_quat('-Z','Y').to_euler()
 scene.render.filepath=os.path.join(OUT,f'source-{view}.png');bpy.ops.render.render(write_still=True)
camera.location=(0,-20,4);camera.rotation_euler=(Vector((0,0,4))-camera.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT,'source-canonical.blend'))
