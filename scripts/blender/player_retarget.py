"""Preserve approved repaired player mesh and retarget two essential full-body Uthana performances.
Equipment follows the hands. Raw/provider assets and old combat bundle stay intact.
"""
import bpy,os,json,math,sys
from mathutils import Vector,Matrix,Quaternion
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'))
bpy.ops.wm.open_mainfile(filepath=ROOT+'/assets/production/player-combat.blend')
scene=bpy.context.scene;scene.render.fps=30
rig=next(o for o in scene.objects if o.type=='ARMATURE');body=next(o for o in scene.objects if o.type=='MESH' and not o.hide_render)
for t in rig.animation_data.nla_tracks:t.mute=True
oldacts={a.name:a for a in bpy.data.actions}
bones=rig.pose.bones
for b in bones:b.rotation_mode='QUATERNION'
def update():bpy.context.view_layer.update()
def B(n):return bones['mixamorig:'+n]
def wm(b):return rig.matrix_world@b.matrix
def apply_action(a,frame):
 rig.animation_data.action=a;rig.animation_data.action_slot=a.slots[0];scene.frame_set(int(frame),subframe=frame-int(frame));update()
def reset():
 rig.animation_data.action=None
 for b in bones:b.matrix_basis.identity()
 update()
reset();rests={b.name:wm(b).copy() for b in bones};targetscale=rig.matrix_world.to_scale();inv=rig.matrix_world.inverted()
apply_action(oldacts['idle'],0)
weapOffset=wm(B('RightHand')).inverted()@wm(bones['WeaponSocket'])
shieldOffset=wm(B('LeftHand')).inverted()@wm(bones['ShieldSocket'])
fingerPose={b.name:b.matrix_basis.copy() for b in bones if any(x in b.name for x in ['Thumb','Index','Middle','Ring','Pinky'])}
oldidle={b.name:b.matrix_basis.copy() for b in bones}
footgroups={g.index for g in body.vertex_groups if any(n in g.name for n in ['Foot','ToeBase'])}
footverts=[v.index for v in body.data.vertices if sum(g.weight for g in v.groups if g.group in footgroups)>.5]
reset()
# Record gait originals before importing a second skeleton (which renames bones).
source_data={};reports={}
for kind in ['strike','dodge']:
 before=set(scene.objects)
 bpy.ops.import_scene.gltf(filepath=ROOT+'/assets/player-essential-motion/'+kind+'-source.glb')
 sr=next(o for o in scene.objects if o not in before and o.type=='ARMATURE')
 for o in scene.objects:
  if o not in before:o.hide_render=True
 sa=sr.animation_data.action
 if sa is None:
  st=next(iter(sr.animation_data.nla_tracks));sa=st.strips[0].action
 for t in sr.animation_data.nla_tracks:t.mute=True
 sr.animation_data.action=sa;sr.animation_data.action_slot=sa.slots[0]
 dur=(sa.frame_range[1]-sa.frame_range[0])/30
 sr.animation_data.action=None
 for b in sr.pose.bones:b.matrix_basis.identity()
 update();srrest={b.name:(sr.matrix_world@b.matrix).copy() for b in sr.pose.bones}
 scale=(rests['mixamorig:Hips'].translation-rests['mixamorig:LeftFoot'].translation).length/(srrest['mixamorig:Hips'].translation-srrest['mixamorig:LeftFoot'].translation).length
 poses=[]
 sr.animation_data.action=sa;sr.animation_data.action_slot=sa.slots[0]
 for fi in range(round(dur*30)+1):
  scene.frame_set(fi);update()
  poses.append({b.name:(sr.matrix_world@b.matrix).copy() for b in sr.pose.bones})
 sr.animation_data.action=None
 source_data[kind]=(poses,srrest,scale)
 reports[kind]={'rawDuration':dur,'frames':len(poses),'sourceScale':scale,'rawHipStart':list(poses[0]['mixamorig:Hips'].translation),'rawHipEnd':list(poses[-1]['mixamorig:Hips'].translation)}
# For initial inspection preserve full time range; final ranges selected after seeing it.
actions=[]
for kind,(poses,srrest,scale) in source_data.items():
 reset();samples=[]
 for fi,pose in enumerate(poses):
  for b in bones:b.matrix_basis.identity()
  update()
  for b in bones:
   if b.name not in pose:continue
   current=wm(b)
   if b.name.endswith(':Hips'):
    hip=pose[b.name].translation*scale+Vector((rig.matrix_world.translation.x,rig.matrix_world.translation.y,0))
    current.translation=hip
   # Bone local axes are identical. Align actual world orientation, not the
   # old T-pose animation delta onto the repaired A-pose arm rest.
   b.matrix=inv@Matrix.LocRotScale(current.translation,pose[b.name].to_quaternion(),targetscale)
   update()
  # Uthana fixed the root height, so flexing knees raised both soles. Restore sole contact.
  ev=body.evaluated_get(bpy.context.evaluated_depsgraph_get());mesh=ev.to_mesh();floor=min((ev.matrix_world@mesh.vertices[i].co).z for i in footverts);ev.to_mesh_clear()
  hipmat=wm(B('Hips'));hipmat.translation.z-=floor-.004;B('Hips').matrix=inv@hipmat;update()
  for n,m in fingerPose.items():bones[n].matrix_basis=m.copy()
  update()
  bones['WeaponSocket'].matrix=inv@(wm(B('RightHand'))@weapOffset)
  bones['ShieldSocket'].matrix=inv@(wm(B('LeftHand'))@shieldOffset)
  update()
  samples.append({b.name:(b.location.copy(),b.rotation_quaternion.copy(),b.scale.copy()) for b in bones})
 action=bpy.data.actions.new('essential-'+kind);rig.animation_data.action=action
 for fi,sample in enumerate(samples):
  for n,(loc,rot,scl) in sample.items():
   b=bones[n];b.location=loc;b.rotation_quaternion=rot;b.scale=scl
   b.keyframe_insert('location',frame=fi);b.keyframe_insert('rotation_quaternion',frame=fi);b.keyframe_insert('scale',frame=fi)
 action.use_fake_user=True;actions.append((kind,action,len(samples)))
reset()
for t in list(rig.animation_data.nla_tracks):rig.animation_data.nla_tracks.remove(t)
for n,a,count in actions:
 t=rig.animation_data.nla_tracks.new();t.name=n;st=t.strips.new(n,0,a);st.action_frame_start=0;st.action_frame_end=count-1;t.mute=True
bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);body.select_set(True);bpy.context.view_layer.objects.active=rig
scene.frame_start=0;scene.frame_end=180
bpy.ops.wm.save_as_mainfile(filepath=ROOT+'/assets/player-essential-motion/player-retarget-study.blend')
json.dump(reports,open(ROOT+'/docs/player-essential-source-report.json','w'),indent=2)
print('RETARGET_READY',reports,flush=True)
