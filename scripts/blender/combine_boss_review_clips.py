"""Combine already-audited source clips without retiming or production promotion."""
import bpy,os,json
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'));TAG=os.environ.get('VESPER_COMBINED_TAG','v59-combat-review');OUT=os.path.join(ROOT,'assets/combat-revision/boss',TAG);os.makedirs(OUT,exist_ok=True);slam=os.environ.get('VESPER_COMBINED_SLAM','v52-slam-continuous-lowered');sweep=os.environ.get('VESPER_COMBINED_SWEEP','v58-close-whole-clear');bpy.ops.wm.open_mainfile(filepath=os.path.join(ROOT,'assets/combat-revision/boss',slam,'boss-combat-candidate.blend'));rig=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE');body=next(o for o in bpy.context.scene.objects if o.type=='MESH'and any(m.type=='ARMATURE'for m in o.modifiers));rig.animation_data.action=None
with bpy.data.libraries.load(os.path.join(ROOT,'assets/combat-revision/boss',sweep,'boss-combat-candidate.blend'),link=False)as(src,dst):dst.actions=[n for n in src.actions if n==sweep+'-sweep']
assert len(dst.actions)==1 and dst.actions[0];action=dst.actions[0]
for t in list(rig.animation_data.nla_tracks):
 if t.name=='sweep':rig.animation_data.nla_tracks.remove(t)
track=rig.animation_data.nla_tracks.new();track.name='sweep';strip=track.strips.new('sweep',0,action)
for t in rig.animation_data.nla_tracks:t.mute=False
bpy.context.scene.frame_set(0);bpy.context.view_layer.update();bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);body.select_set(True);bpy.context.view_layer.objects.active=rig;bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT,'boss-combat-candidate.blend'));bpy.ops.export_scene.gltf(filepath=os.path.join(OUT,'boss-combat-candidate.glb'),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='NLA_TRACKS',export_nla_strips=True,export_frame_range=False,export_force_sampling=True,export_def_bones=False)
report={}
for tag,clip in [(slam,'slam'),(sweep,'sweep')]:report[clip]=json.load(open(os.path.join(ROOT,'docs/combat-revision/boss-candidate-bake-'+tag+'.json')))[clip]
json.dump(report,open(os.path.join(ROOT,'docs/combat-revision/boss-candidate-bake-'+TAG+'.json'),'w'),indent=2);print('COMBINED_AUDITED_SOURCE_READY',OUT,[t.name for t in rig.animation_data.nla_tracks],flush=True)
