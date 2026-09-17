"""Lean the kept IK performance forward as one body; retain planted boots.
Only the pelvis/root pose, leg compensation and weapon socket change.
"""
import bpy,os,math,json
from mathutils import Vector,Matrix
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'))
OUT=os.path.join(ROOT,'assets/idle-forward-lean');os.makedirs(OUT,exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=os.path.join(ROOT,'assets/idle-video-motion/boss-idle-video.blend'))
scene=bpy.context.scene;scene.render.fps=30
rig=next(o for o in scene.objects if o.type=='ARMATURE')
body=next(o for o in scene.objects if o.type=='MESH' and not o.hide_render)
bones=rig.pose.bones;inv=rig.matrix_world.inverted()
def B(n):return bones['mixamorig:'+n]
def update():bpy.context.view_layer.update()
def world(p):return rig.matrix_world@p.matrix
def pos(p):return world(p).translation.copy()
def setworld(p,m):p.matrix=inv@m;update()
def aim(p,child,target):
 m=world(p);v=m.translation.copy();q=(pos(child)-v).normalized().rotation_difference((target-v).normalized())
 setworld(p,Matrix.Translation(v)@q.to_matrix().to_4x4()@Matrix.Translation(-v)@m)
def leg(side,target,pole):
 a,b,c=[B(side+n)for n in ['UpLeg','Leg','Foot']];s,e,w=pos(a),pos(b),pos(c)
 l1,l2=(e-s).length,(w-e).length;axis=(target-s).normalized()
 d=max(abs(l1-l2)+.0001,min((target-s).length,l1+l2-.0001))
 along=(l1*l1-l2*l2+d*d)/(2*d);height=math.sqrt(max(0,l1*l1-along*along))
 bend=pole-s;bend-=axis*bend.dot(axis);bend.normalize()
 aim(a,b,s+axis*along+bend*height);aim(b,c,target)
 return (pos(c)-target).length
for t in rig.animation_data.nla_tracks:t.mute=t.name!='idle-video'
rig.animation_data.action=None
track=next(t for t in rig.animation_data.nla_tracks if t.name=='idle-video')
end=round(track.strips[0].frame_end);frames=[]
for f in range(end+1):
 scene.frame_set(f);update();frames.append({p.name:p.matrix_basis.copy()for p in bones})
for t in rig.animation_data.nla_tracks:t.mute=True
samples=[];measure=[];angle=5
for f,frame in enumerate(frames):
 scene.frame_set(f)
 for n,m in frame.items():bones[n].matrix_basis=m.copy()
 update();feet={s:world(B(s+'Foot')).copy()for s in ['Left','Right']}
 pivot=(feet['Left'].translation+feet['Right'].translation)*.5
 transform=Matrix.Translation(pivot)@Matrix.Rotation(math.radians(angle),4,'X')@Matrix.Translation(-pivot)
 oldhip=world(B('Hips')).copy();weapon=world(bones['WeaponSocket']).copy()
 knees={s:transform@pos(B(s+'Leg'))for s in feet}
 setworld(B('Hips'),transform@oldhip)
 setworld(bones['WeaponSocket'],transform@weapon)
 errors=[]
 for s,m in feet.items():
  errors.append(leg(s,m.translation,knees[s]+Vector((0,-.3,0))))
  setworld(B(s+'Foot'),m)
 update();samples.append({p.name:(p.location.copy(),p.rotation_quaternion.copy(),p.scale.copy())for p in bones})
 measure.append({'time':f/30,'footError':max(errors),'hipForwardShift':oldhip.translation.y-pos(B('Hips')).y})
action=bpy.data.actions.new('idle-forward-lean');rig.animation_data.action=action
for f,frame in enumerate(samples):
 for n,(loc,q,scale)in frame.items():
  p=bones[n];p.location=loc;p.rotation_quaternion=q;p.scale=scale
  for channel in ['location','rotation_quaternion','scale']:p.keyframe_insert(channel,frame=f)
rig.animation_data.action=None
for t in list(rig.animation_data.nla_tracks):rig.animation_data.nla_tracks.remove(t)
t=rig.animation_data.nla_tracks.new();t.name='idle-forward-lean';t.strips.new('idle-forward-lean',0,action)
scene.frame_start=0;scene.frame_end=end;scene.frame_set(0);update()
bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);body.select_set(True);bpy.context.view_layer.objects.active=rig
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT,'boss-forward-lean.blend'))
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT,'boss-forward-lean.glb'),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='NLA_TRACKS',export_nla_strips=True,export_frame_range=False,export_force_sampling=True,export_def_bones=False)
json.dump({'leanDegrees':angle,'duration':end/30,'maxFootError':max(m['footError']for m in measure),'hipForwardShiftRange':[min(m['hipForwardShift']for m in measure),max(m['hipForwardShift']for m in measure)],'samples':measure},open(os.path.join(ROOT,'docs/boss-forward-lean-bake.json'),'w'),indent=2)
print('FORWARD_LEAN_EXPORTED',flush=True)
