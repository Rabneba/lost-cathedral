"""Ground captured video motion and infer missing translation from material support.

Derivative only. Joint performance stays captured except modest foot-contact
cleanup for standing actions. A roll uses actual armored body surface contact,
not a rigid actor flip or planted-foot solve during inversion.
"""
import bpy,os,math,json,statistics,numpy as np
from mathutils import Vector,Matrix,Quaternion
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'))
OUT=ROOT+'/assets/player-combat-revision'
bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.open_mainfile(filepath=OUT+'/player-video-retarget-trial.blend')
scene=bpy.context.scene;rig=next(o for o in scene.objects if o.type=='ARMATURE');body=next(o for o in scene.objects if o.type=='MESH'and not o.hide_render);bones=rig.pose.bones;inv=rig.matrix_world.inverted()
source={tr.name:tr.strips[0].action for tr in rig.animation_data.nla_tracks}
for tr in rig.animation_data.nla_tracks:tr.mute=True
rig.animation_data.action=None
for b in bones:b.matrix_basis.identity()
bpy.context.view_layer.update();rest={b.name:(rig.matrix_world@b.matrix).copy()for b in bones}
def B(n):return bones['mixamorig:'+n]
def wm(b):return rig.matrix_world@b.matrix
def update():bpy.context.view_layer.update()
def setw(b,m):b.matrix=inv@m;update()
def rotate(b,q):
 m=wm(b);setw(b,Matrix.LocRotScale(m.translation,q@m.to_quaternion(),m.to_scale()))
def aim(b,c,target):
 p=wm(b).translation;rotate(b,(wm(c).translation-p).normalized().rotation_difference((target-p).normalized()))
def leg(side,target,pole):
 a,b,c=[B(side+n)for n in ['UpLeg','Leg','Foot']];p,e,w=[wm(x).translation for x in [a,b,c]];l1=(e-p).length;l2=(w-e).length;delta=target-p;axis=delta.normalized();d=min(l1+l2-.001,max(abs(l1-l2)+.001,delta.length));along=(l1*l1-l2*l2+d*d)/(2*d);h=math.sqrt(max(0,l1*l1-along*along));bend=pole-p;bend-=axis*bend.dot(axis)
 if bend.length<.001:bend=Vector((0,-1,0))
 bend.normalize();aim(a,b,p+axis*along+bend*h);aim(b,c,target)
footgroups={g.index for g in body.vertex_groups if any(n in g.name for n in ['Foot','ToeBase'])}
footids=np.array([v.index for v in body.data.vertices if sum(g.weight for g in v.groups if g.group in footgroups)>.5],dtype=int)
def mesh():
 ev=body.evaluated_get(bpy.context.evaluated_depsgraph_get());me=ev.to_mesh();p=np.empty(len(me.vertices)*3,dtype=np.float32);me.vertices.foreach_get('co',p);p=p.reshape(-1,3);m=np.array(ev.matrix_world);out=p@m[:3,:3].T+m[:3,3];ev.to_mesh_clear();return out
def capture():return {b.name:(b.location.copy(),b.rotation_quaternion.copy(),b.scale.copy())for b in bones}
def pose(a,f):
 rig.animation_data.action=a;rig.animation_data.action_slot=a.slots[0];scene.frame_set(f);update();data=capture();rig.animation_data.action=None
 for n,(l,q,s)in data.items():bones[n].location=l;bones[n].rotation_quaternion=q;bones[n].scale=s
 update()
def propverts(path,height,sword=False):
 before=set(scene.objects);bpy.ops.import_scene.gltf(filepath=ROOT+'/'+path);objects=[o for o in scene.objects if o not in before];meshes=[o for o in objects if o.type=='MESH'];verts=[]
 mat=Matrix.Rotation(-math.pi/2,4,'Z')@(Matrix.Rotation(math.pi,4,'Y')if sword else Matrix.Identity(4))
 for o in objects:o.hide_render=True
 for o in meshes:
  m=mat@o.matrix_world;verts.extend(m@v.co for v in o.data.vertices)
 lo=Vector([min(v[i]for v in verts)for i in range(3)]);hi=Vector([max(v[i]for v in verts)for i in range(3)]);center=Vector(((lo.x+hi.x)/2,(lo.y+hi.y)/2,lo.z));scale=height/(hi.z-lo.z);verts=[(v-center)*scale for v in verts]
 if sword:
  hand=[v for v in verts if .08<v.z<.25];center=Vector((statistics.median(v.x for v in hand),statistics.median(v.y for v in hand),0));verts=[v-center for v in verts]
 return np.array(verts)
swordverts=propverts('assets/create-the-exact-isolated-player-sword-s-cmu12ngf.glb',1.28,True);shieldverts=propverts('assets/create-the-exact-isolated-player-shield-cmu12nf3.glb',.73)
def propworld(v,m):
 m=np.array(m);return v@m[:3,:3].T+m[:3,3]
def wristbend(side):
 a=wm(B(side+'Hand')).translation-wm(B(side+'ForeArm')).translation;b=wm(B(side+'HandMiddle1')).translation-wm(B(side+'Hand')).translation;return math.degrees(a.angle(b))
hitmeasure=json.load(open(ROOT+'/docs/player-combat-revision/hit-source-travel-measurement.json'));hitrows=hitmeasure['rows'];hitscale=hitmeasure['metresPerPixel']
def hitvalue(time,key,side=None):
 rows=hitrows if side is None else [r for r in hitrows if len(r['boots'])==2]
 times=[r['time']for r in rows];values=[r[key]if side is None else r['boots'][0 if side=='Right'else 1][key]for r in rows]
 return float(np.interp(time,times,values))
reports={};made=[]
for name,a in source.items():
 end=round(a.frame_range[1]);isroll=name.startswith('roll');guard=name.startswith('guard');pose(a,60 if guard else 0)
 targets={side:wm(B(side+'Foot')).translation.copy()for side in ['Left','Right']};flat={};correction={};hitfeet={side:v.copy()for side,v in targets.items()}
 for side in ['Left','Right']:
  foot=B(side+'Foot');toe=B(side+'ToeBase');direction=wm(toe).translation-wm(foot).translation;rd=rest[toe.name].translation-rest[foot.name].translation;yaw=math.atan2(direction.y,direction.x)-math.atan2(rd.y,rd.x)
  flat[side]=Quaternion((0,0,1),yaw)@rest[foot.name].to_quaternion();correction[side]=flat[side]@wm(foot).to_quaternion().inverted();targets[side].z=rest[foot.name].translation.z+.003
 samples=[];rows=[];previous=None;travel=np.zeros(2);maxleg=0
 for f in range(end+1):
  pose(a,f)
  if not isroll:
   if guard:
    # The selected source has planted feet after its setup. Restore support,
    # retaining captured hips/spine/shoulder rotations and breathing.
    delta=sum((targets[side]-wm(B(side+'Foot')).translation for side in targets),Vector())/2
    m=wm(B('Hips'));m.translation+=delta;setw(B('Hips'),m)
    for side in targets:
     maxleg=max(maxleg,(targets[side]-wm(B(side+'Foot')).translation).length);pole=wm(B(side+'Leg')).translation;leg(side,targets[side],pole)
     m=wm(B(side+'Foot'));setw(B(side+'Foot'),Matrix.LocRotScale(m.translation,flat[side],m.to_scale()));B(side+'ToeBase').matrix_basis.identity()
   else:
    for side in targets:
     foot=B(side+'Foot');m=wm(foot);setw(foot,Matrix.LocRotScale(m.translation,correction[side]@m.to_quaternion(),m.to_scale()))
   if name=='hit-v3':
    # The actual reference shows backward footfalls; raw Uthana omits root
    # translation. Recover those floor paths from the fixed side camera and
    # retain captured pelvis/spine/arm rotation plus captured knee plane.
    rootback=hitvalue(f/30,'backwardDistanceMeters')
    for side in ['Left','Right']:
     target=wm(B(side+'Foot')).translation.copy();target.y=hitfeet[side].y+(hitvalue(0,'soleX',side)-hitvalue(f/30,'soleX',side))*hitscale-rootback
     target.z=targets[side].z+max(0,hitvalue(0,'bottom',side)-hitvalue(f/30,'bottom',side))*hitscale
     maxleg=max(maxleg,(target-wm(B(side+'Foot')).translation).length);q=wm(B(side+'Foot')).to_quaternion();pole=wm(B(side+'Leg')).translation;leg(side,target,pole);m=wm(B(side+'Foot'));setw(B(side+'Foot'),Matrix.LocRotScale(m.translation,q,m.to_scale()))
   update()
  p=mesh();contactids=np.arange(len(p)) if isroll else footids;low=float(np.min(p[contactids,2]));m=wm(B('Hips'));m.translation.z+=.003-low;setw(B('Hips'),m);p=mesh();low=float(np.min(p[contactids,2]))
  if previous is not None and not guard:
   ids=contactids[(p[contactids,2]<low+.018)&(previous[contactids,2]<.028)]
   if len(ids)>8:
    step=np.median(previous[ids,:2]-p[ids,:2],axis=0)
    # A single tip changing contact cannot propel the body by a large jump.
    length=float(np.linalg.norm(step));step*=min(1,.085/max(length,1e-9));travel+=step
  previous=p.copy()
  if name=='hit-v3':travel=np.array([0,hitvalue(f/30,'backwardDistanceMeters')])
  rows.append({'frame':f,'time':f/30,'bodyMinimum':float(np.min(p[:,2])),'soleMinimum':float(np.min(p[footids,2])),'inferredTravelBlenderXY':travel.tolist(),'hip':list(wm(B('Hips')).translation),'swordMinimum':float(np.min(propworld(swordverts,wm(bones['WeaponSocket']))[:,2])),'shieldMinimum':float(np.min(propworld(shieldverts,wm(bones['ShieldSocket'])@Matrix.Rotation(math.pi/2,4,'Z'))[:,2])),'rightWristFlexDegrees':wristbend('Right')})
  samples.append(capture())
 action=bpy.data.actions.new('ground-video-'+name);rig.animation_data.action=action
 for f,s in enumerate(samples):
  for n,(l,q,sc)in s.items():
   b=bones[n];b.location=l;b.rotation_quaternion=q;b.scale=sc;b.keyframe_insert('location',frame=f);b.keyframe_insert('rotation_quaternion',frame=f);b.keyframe_insert('scale',frame=f)
 action.use_fake_user=True;rig.animation_data.action=None;made.append((name,action,end));reports[name]={'duration':end/30,'maxGuardLegCorrectionMeters':maxleg,'inferredTravelMeters':travel.tolist(),'rows':rows};print('GROUNDED',name,travel,maxleg,flush=True)
for tr in list(rig.animation_data.nla_tracks):rig.animation_data.nla_tracks.remove(tr)
for name,a,end in made:
 tr=rig.animation_data.nla_tracks.new();tr.name=name;st=tr.strips.new(name,0,a);st.action_frame_start=0;st.action_frame_end=end;tr.mute=True
for b in bones:b.matrix_basis.identity()
scene.frame_set(0);bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);body.select_set(True);bpy.context.view_layer.objects.active=rig
bpy.ops.wm.save_as_mainfile(filepath=OUT+'/player-video-grounded-trial.blend')
json.dump(reports,open(ROOT+'/docs/player-combat-revision/grounded-trial-report.json','w'),indent=2)
