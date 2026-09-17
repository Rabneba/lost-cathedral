"""Retime an accepted correction candidate without altering its source file.

Usage: blender -b --python this.py -- input.blend output-directory [slam,sweep] [timing.json]
All body/hand/socket channels share one monotone smooth time map. Approved idle,
walk and nonattack tracks retain their original actions and durations.
"""
import bpy, os, sys, math, json
from mathutils import Matrix
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'))
args=sys.argv[sys.argv.index('--')+1:]
source=os.path.abspath(args[0]);output=os.path.abspath(args[1]);os.makedirs(output,exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=source)
bpy.context.preferences.filepaths.save_version=0
scene=bpy.context.scene;scene.render.fps=30
rig=next(o for o in scene.objects if o.type=='ARMATURE')
body=next(o for o in scene.objects if o.type=='MESH'and any(m.type=='ARMATURE'for m in o.modifiers))
maps={
 'sweep':{'game':[0,1.1,1.55,1.95,3.1],'source':[0,1.65,2.8,3.3,197/30],'sourceHitWindow':[2.0,100/30]},
 'slam':{'game':[0,1.5,1.95,2.6,4.0],'source':[0,2.0,2.8,3.7,197/30],'sourceHitWindow':[2.5,2.9],'aimYawDegrees':-8},
}
if len(args)>2:
 selected=args[2].split(',')
 if not selected or any(name not in maps for name in selected):raise ValueError('Choose slam and/or sweep')
 maps={name:maps[name]for name in selected}
if len(args)>3:
 overrides=json.load(open(os.path.abspath(args[3])))
 for name,spec in overrides.items():
  if name not in maps:raise ValueError('Timing override must name a selected clip')
  maps[name]={**maps[name],**spec}
for name,spec in maps.items():
 x,y=spec['game'],spec['source']
 if len(x)!=len(y) or len(x)<2 or x[0]!=0 or y[0]!=0 or any(b<=a for values in [x,y]for a,b in zip(values,values[1:])):
  raise ValueError('Timing coordinates must have equal lengths, start at zero, and increase strictly: '+name)
def monotone_map(x,y):
 h=[b-a for a,b in zip(x,x[1:])];d=[(b-a)/step for a,b,step in zip(y,y[1:],h)];m=[d[0]]
 for i in range(1,len(x)-1):
  a,b=2*h[i]+h[i-1],h[i]+2*h[i-1]
  m.append((a+b)/(a/d[i-1]+b/d[i]))
 m.append(d[-1])
 def evaluate(t):
  if t<=x[0]:return y[0]
  if t>=x[-1]:return y[-1]
  i=next(i for i in range(len(h))if t<=x[i+1]);u=(t-x[i])/h[i]
  return (2*u**3-3*u*u+1)*y[i]+(u**3-2*u*u+u)*h[i]*m[i]+(-2*u**3+3*u*u)*y[i+1]+(u**3-u*u)*h[i]*m[i+1]
 return evaluate
for t in rig.animation_data.nla_tracks:t.mute=True
rig.animation_data.action=None
report={'input':source,'clips':{}}
for name,spec in maps.items():
 track=next(t for t in rig.animation_data.nla_tracks if t.name==name);strip=track.strips[0]
 rig.animation_data.action=strip.action;rig.animation_data.action_slot=strip.action_slot
 sample_time=monotone_map(spec['game'],spec['source']);poses=[]
 for f in range(round(spec['game'][-1]*30)+1):
  source_frame=sample_time(f/30)*30;scene.frame_set(math.floor(source_frame),subframe=source_frame%1);bpy.context.view_layer.update()
  # Aim the entire body/weapon performance, preserving all relative grip and
  # limb geometry. Ramp from/to the exact approved idle, rotate about world up.
  if spec.get('aimYawDegrees'):
   source_seconds=source_frame/30
   smooth=lambda t:(lambda u:u*u*(3-2*u))(max(0.,min(1.,t)))
   amount=smooth(source_seconds/1.0)*(1-smooth((source_seconds-3.2)/(spec['source'][-1]-3.2)))
   world_yaw=Matrix.Rotation(math.radians(spec['aimYawDegrees'])*amount,4,'Z')
   local_yaw=rig.matrix_world.inverted()@world_yaw@rig.matrix_world
   for root_bone in [p for p in rig.pose.bones if p.parent is None]:root_bone.matrix=local_yaw@root_bone.matrix
   bpy.context.view_layer.update()
  poses.append({p.name:p.matrix_basis.copy()for p in rig.pose.bones})
 rig.animation_data.action=None;rig.animation_data.nla_tracks.remove(track)
 action=bpy.data.actions.new('review-paced-'+name);rig.animation_data.action=action;previous={}
 for f,pose in enumerate(poses):
  for n,m in pose.items():
   p=rig.pose.bones[n];loc,q,scale=m.decompose()
   if n in previous and previous[n].dot(q)<0:q.negate()
   previous[n]=q.copy();p.rotation_mode='QUATERNION';p.location=loc;p.rotation_quaternion=q;p.scale=scale
   for channel in ['location','rotation_quaternion','scale']:p.keyframe_insert(channel,frame=f)
 rig.animation_data.action=None;track=rig.animation_data.nla_tracks.new();track.name=name;strip=track.strips.new(name,0,action);strip.action_slot=action.slots[0];track.mute=True
 def game_time(source_time):
  lo,hi=0.,spec['game'][-1]
  for _ in range(50):
   mid=(lo+hi)/2
   if sample_time(mid)<source_time:lo=mid
   else:hi=mid
  return (lo+hi)/2
 source_window=spec.get('sourceHitWindow',spec['source'][1:3])
 hit_window=[game_time(t)for t in source_window]
 report['clips'][name]={**spec,'duration':spec['game'][-1],'windup':hit_window[0],'active':hit_window[1]-hit_window[0],'recovery':spec['game'][-1]-hit_window[1],'hitWindows':[hit_window],
  'timeMap':[[round(f/30,6),sample_time(f/30)]for f in range(round(spec['game'][-1]*30)+1)]}
for track in rig.animation_data.nla_tracks:track.mute=False
scene.frame_set(0)
bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);body.select_set(True);bpy.context.view_layer.objects.active=rig
os.makedirs(output,exist_ok=True)
print('RETIME_SAVE_PATH',os.path.join(output,'boss-paced-candidate.blend'),'freeBytes',os.statvfs(output).f_bavail*os.statvfs(output).f_frsize,flush=True)
bpy.ops.export_scene.gltf(filepath=os.path.join(output,'boss-paced-candidate.glb'),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='NLA_TRACKS',export_nla_strips=True,export_frame_range=False,export_force_sampling=True,export_def_bones=False)
json.dump(report,open(os.path.join(output,'timing-map.json'),'w'),indent=2)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(output,'boss-paced-candidate.blend'))
print('RETIME_CANDIDATE_READY',flush=True)
