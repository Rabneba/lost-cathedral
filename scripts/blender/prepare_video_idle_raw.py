"""Inspect Uthana's video performance on the approved mesh before pose cleanup."""
import bpy,os,json,statistics
from mathutils import Vector
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'))
OUT=os.path.join(ROOT,'assets/idle-video-motion')
bpy.ops.wm.read_factory_settings(use_empty=True);scene=bpy.context.scene;scene.render.fps=30
bpy.ops.import_scene.gltf(filepath=os.path.join(OUT,'boss-source.glb'))
rig=next(o for o in scene.objects if o.type=='ARMATURE')
body=next(o for o in scene.objects if o.type=='MESH')
track=rig.animation_data.nla_tracks[0];track.name='video-source';strip=track.strips[0]
scene.frame_start=0;scene.frame_end=round(strip.frame_end)
positions=[];mins=[]
for frame in range(0,scene.frame_end+1,5):
 scene.frame_set(frame);bpy.context.view_layer.update()
 evaluated=body.evaluated_get(bpy.context.evaluated_depsgraph_get())
 mins.append(min((body.matrix_world@v.co).z for v in evaluated.data.vertices))
 positions.append({'time':frame/30,**{name:list((rig.matrix_world@rig.pose.bones['mixamorig:'+name].matrix).translation)for name in ['Hips','Head','RightHand','LeftHand','RightFoot','LeftFoot']}})
ground=statistics.median(mins);rig.location.z-=ground
scene.frame_set(30);bpy.context.view_layer.update()
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT,'boss-source-raw.blend'))
with open(os.path.join(ROOT,'docs/boss-video-raw-audit.json'),'w')as f:json.dump({'constantGroundOffset':ground,'groundRange':[min(mins),max(mins)],'duration':strip.frame_end/30,'samples':positions},f,indent=2)
print('RAW_READY',ground,flush=True)
