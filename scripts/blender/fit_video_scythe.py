"""Create a separate equipment-fit copy. Preserve the approved blade and
surface detail; narrow the oversized handle to the approved video's scale.
The original generated scythe is retained unchanged.
"""
import bpy,os,math,statistics
from mathutils import Matrix,Vector
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'))
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT,'assets/exact-isolated-scythe-from-this-image-si-cmu1fy15.glb'))
meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
for o in meshes:
 m=Matrix.Rotation(-math.pi/2,4,'Z')@o.matrix_world
 for v in o.data.vertices:v.co=m@v.co
 o.parent=None;o.matrix_world.identity()
points=[v.co for o in meshes for v in o.data.vertices]
lo=Vector([min(p[i]for p in points)for i in range(3)]);hi=Vector([max(p[i]for p in points)for i in range(3)]);scale=3.2/(hi.z-lo.z);center=Vector(((lo.x+hi.x)/2,(lo.y+hi.y)/2,lo.z))
for o in meshes:
 for v in o.data.vertices:v.co=(v.co-center)*scale
handle=[v.co for o in meshes for v in o.data.vertices if .55<v.co.z<1.25]
center=Vector((statistics.median(p.x for p in handle),statistics.median(p.y for p in handle),0))
for o in meshes:
 for v in o.data.vertices:
  v.co-=center
  radius=math.hypot(v.co.x,v.co.y)
  taper=max(0,min(1,(2.5-v.co.z)/.45));taper=taper*taper*(3-2*taper)
  if radius<.22:
   amount=1-.5*taper;v.co.x*=amount;v.co.y*=amount
 # Runtime's existing prop loader applies -90 degrees; keep that convention.
 o.matrix_world=Matrix.Rotation(math.pi/2,4,'Z')
bpy.ops.export_scene.gltf(filepath=os.path.join(ROOT,'assets/idle-video-motion/scythe-fitted.glb'),export_format='GLB',export_animations=False)
print('FITTED_SCYTHE_EXPORTED',flush=True)
