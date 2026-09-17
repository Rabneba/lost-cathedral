"""Merge reviewed video-derived combat into a separate candidate; retain16 gaits."""
import bpy,os,json,math,hashlib,numpy as np
from mathutils import Matrix,Vector,Quaternion
R=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'));OUT=R+'/assets/player-combat-revision';bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.open_mainfile(filepath=R+'/assets/production/player-essential.blend');scene=bpy.context.scene;scene.render.fps=30;rig=next(o for o in scene.objects if o.type=='ARMATURE');body=next(o for o in scene.objects if o.type=='MESH'and not o.hide_render);bones=rig.pose.bones;inv=rig.matrix_world.inverted();old={tr.name:tr.strips[0].action for tr in rig.animation_data.nla_tracks};rig.animation_data.action=None
for tr in rig.animation_data.nla_tracks:tr.mute=True
wanted={'idle':'weapon-refined-guard-v2','light':'ground-video-light-v3','heavy':'weapon-refined-heavy-v2','hit':'weapon-refined-hit-v3','dodge':'roll-carry-trial'}
with bpy.data.libraries.load(OUT+'/player-video-weapon-trial.blend',link=False)as(src,dst):dst.actions=list(wanted.values())
loaded=dict(zip(wanted.values(),dst.actions));sources={n:loaded[a]for n,a in wanted.items()}
def B(n):return bones['mixamorig:'+n]
def wm(b):return rig.matrix_world@b.matrix
def up():bpy.context.view_layer.update()
def cap():return {b.name:(b.location.copy(),b.rotation_quaternion.copy(),b.scale.copy())for b in bones}
def setpose(p):
 for n,(l,q,s)in p.items():bones[n].location=l;bones[n].rotation_quaternion=q;bones[n].scale=s
 up()
def pose(a,f):
 rig.animation_data.action=a;rig.animation_data.action_slot=a.slots[0];scene.frame_set(int(f),subframe=f-int(f));up();p=cap();rig.animation_data.action=None;setpose(p);return p
fit=json.load(open(R+'/docs/player-combat-revision/candidate-grip/report.json'))['candidateFit'];offset=Matrix([fit['weaponWristOffset'][i:i+4]for i in range(0,16,4)])
def equip():
 for n,v in fit['thumbMatrices'].items():bones['mixamorig:'+n].matrix_basis=Matrix([v[i:i+4]for i in range(0,16,4)])
 up();bones['WeaponSocket'].matrix=inv@(wm(B('RightHand'))@offset);up()
footgroups={g.index for g in body.vertex_groups if any(n in g.name for n in ['Foot','ToeBase'])};footids=[v.index for v in body.data.vertices if sum(g.weight for g in v.groups if g.group in footgroups)>.5]
def ground(whole=False):
 ev=body.evaluated_get(bpy.context.evaluated_depsgraph_get());me=ev.to_mesh();ids=range(len(me.vertices))if whole else footids;low=min((ev.matrix_world@me.vertices[i].co).z for i in ids);ev.to_mesh_clear();m=wm(B('Hips'));m.translation.z+=max(0,.003-low)if whole else .003-low;B('Hips').matrix=inv@m;up();return low
base=pose(sources['idle'],30);equip();base=cap()
def blend(p,q,w):return {n:(l.lerp(q[n][0],w),r.slerp(q[n][1],w),s.lerp(q[n][2],w))for n,(l,r,s)in p.items()}
def smooth(x):x=max(0,min(1,x));return x*x*(3-2*x)
made=[];meta=json.load(open(R+'/docs/player-essential-manifest.json'));newclips={n:d for n,d in meta['clips'].items()if n not in ['idle','block','light','heavy','hit','dodge']};audit={}
def save(name,samples):
 a=bpy.data.actions.new('video-candidate-'+name);rig.animation_data.action=a
 for f,p in enumerate(samples):
  for n,(l,q,s)in p.items():
   b=bones[n];b.location=l;b.rotation_quaternion=q;b.scale=s;b.keyframe_insert('location',frame=f);b.keyframe_insert('rotation_quaternion',frame=f);b.keyframe_insert('scale',frame=f)
 a.use_fake_user=True;rig.animation_data.action=None;made.append((name,a,len(samples)-1))
# Preserve all prior noncombat body channels. Only conventional sword grip and
# thumb opposition are applied; gait hip/leg paths and phase remain unchanged.
for name,a in old.items():
 if name in wanted or name=='block':continue
 samples=[]
 for f in range(round(a.frame_range[1])+1):pose(a,f);equip();samples.append(cap())
 save(name,samples)
print('PRESERVED',len(made),'clips',flush=True)
rollrows=json.load(open(R+'/docs/player-combat-revision/grounded-trial-report.json'))['roll-v2']['rows'];xy=np.array([r['inferredTravelBlenderXY']for r in rollrows]);angle=-math.pi/2-math.atan2(xy[-1,1],xy[-1,0]);turn=Quaternion((0,0,1),angle);rotated=np.array([list(turn@Vector((x,y,0)))[:2]for x,y in xy]);distance=np.maximum.accumulate(np.maximum(0,-rotated[:,1]));hitrows=json.load(open(R+'/docs/player-combat-revision/hit-source-travel-measurement.json'))['rows']
configs={'idle':(30,150,4,0),'light':(0,140,1.5,0),'heavy':(0,154,1.9,0),'hit':(30,130,.9333333333333333,.23333333333333334),'dodge':(0,154,1.2,.23333333333333334)}
for name,(first,last,activeDuration,hold)in configs.items():
 duration=activeDuration+hold;count=round(duration*30);samples=[];curve=[];rows=[]
 for f in range(count+1):
  t=f/30;sf=first+(last-first)*min(1,t/activeDuration);p=pose(sources[name],sf)
  if name=='dodge':
   m=wm(B('Hips'));m=Matrix.LocRotScale(turn@m.translation,turn@m.to_quaternion(),m.to_scale());m.translation.x+=float(np.interp(sf,np.arange(len(rotated)),rotated[:,0]));B('Hips').matrix=inv@m;up();p=cap();dist=float(np.interp(sf,np.arange(len(distance)),distance));curve.append([t,dist])
  elif name=='hit':
   start=float(np.interp(first/30,[r['time']for r in hitrows],[r['backwardDistanceMeters']for r in hitrows]));dist=float(np.interp(sf/30,[r['time']for r in hitrows],[r['backwardDistanceMeters']for r in hitrows]))-start;curve.append([t,max(0,dist)])
  if name=='idle':
   if t>duration-.6:p=blend(p,base,smooth((t-duration+.6)/.6))
  else:
   entry=.13 if name=='dodge'else .16
   if t<entry:p=blend(base,p,smooth(t/entry))
   recover=hold if hold else(.28 if name=='heavy'else .24)
   if t>duration-recover:p=blend(p,base,smooth((t-duration+recover)/recover))
  setpose(p);equip();low=ground(name=='dodge'and .12<t<1.18);samples.append(cap());rows.append({'frame':f,'time':t,'sourceFrame':sf,'preGroundMinimum':low})
 save(name,samples);audit[name]={'duration':duration,'sourceFrames':[first,last],'rows':rows}
 newclips[name]={'duration':duration,'blendIn':.1,'sourceFrames':[first,last],'source':'generated reference video -> explicit Uthana user_video -> rest-basis/contact/prop correction','sourceVideo':'assets/player-combat-revision/source-videos/'+{'idle':'guard-v2','light':'light-v3','heavy':'heavy-v2','hit':'hit-v3','dodge':'roll-v2'}[name]+'.mp4'}
 if name=='idle':newclips[name].update(loop=True);save('block',samples);newclips['block']={**newclips[name],'source':'same captured low shield guard as idle','blendIn':.18}
 if name=='light':newclips[name].update(windup=.57,active=.30,recovery=.63,hitWindows=[[.63,.85]])
 if name=='heavy':newclips[name].update(windup=.78,active=.30,recovery=.82,hitWindows=[[.81,1.04]])
 if name in ['hit','dodge']:
  curve[0]=[0,0];newclips[name].update(travelCurve=curve,direction='forward'if name=='dodge'else'backward',distance=curve[-1][1])
 if name=='dodge':newclips[name].update(invulnerable=[.13,.63])
 print('FINAL_CANDIDATE',name,duration,flush=True)
for tr in list(rig.animation_data.nla_tracks):rig.animation_data.nla_tracks.remove(tr)
for name,a,end in made:
 tr=rig.animation_data.nla_tracks.new();tr.name=name;st=tr.strips.new(name,0,a);st.action_frame_start=0;st.action_frame_end=end;tr.mute=True
scene.frame_set(0)
for b in bones:b.matrix_basis.identity()
bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);body.select_set(True);bpy.context.view_layer.objects.active=rig;dest=OUT+'/player-video-candidate';bpy.ops.wm.save_as_mainfile(filepath=dest+'.blend')
for tr in rig.animation_data.nla_tracks:tr.mute=False
bpy.ops.export_scene.gltf(filepath=dest+'.glb',use_selection=True,export_format='GLB',export_animations=True,export_animation_mode='NLA_TRACKS',export_nla_strips=True,export_frame_range=False,export_force_sampling=True,export_skins=True,export_materials='EXPORT')
manifest={'asset':'assets/player-combat-revision/player-video-candidate.glb','characterId':'cmu1g9dee049k2pnw1spkx8ku','revision':'video-combat-candidate-2026-09-15','baselineSha256':meta['sha256'],'sha256':hashlib.sha256(open(dest+'.glb','rb').read()).hexdigest(),'locomotionSpeed':meta['locomotionSpeed'],'guardSpeed':meta['guardSpeed'],'strafeSpeed':meta['strafeSpeed'],'retreatSpeed':meta['retreatSpeed'],'clips':newclips,'reviewStatus':'candidate; actual playback and runtime audit required','rollAdditionalHeadingNormalizationDegrees':math.degrees(angle),'sourceReview':'docs/player-combat-revision/source-review.json','limitations':['Video extraction omits root travel; roll surface travel and hit fixed-camera translation reconstructed.','Heavy weapon orientation follows measured reference blade angles; body remains captured, forearm pronation/wrist flex corrected.','Approved mesh and equipment retained; detailed armor contact still requires rendered review.']};json.dump(manifest,open(R+'/docs/player-combat-revision/player-video-candidate-manifest.json','w'),indent=2);json.dump(audit,open(R+'/docs/player-combat-revision/player-video-candidate-bake-audit.json','w'),indent=2)
