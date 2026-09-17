"""Keep the captured roll and grasp; solve long-sword carry via shoulder rotation.

The source performer carries a short foam stick. The approved long sword needs
clearance during inversion. This derivative rotates the complete right-arm chain,
so captured elbow/wrist/finger relationships remain unchanged. Never production.
"""
import bpy,os,math,json,numpy as np
from mathutils import Vector,Matrix,Quaternion
from mathutils.bvhtree import BVHTree
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'));OUT=ROOT+'/assets/player-combat-revision'
bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.open_mainfile(filepath=OUT+'/player-video-grounded-trial.blend');scene=bpy.context.scene;rig=next(o for o in scene.objects if o.type=='ARMATURE');body=next(o for o in scene.objects if o.type=='MESH'and not o.hide_render);bones=rig.pose.bones;inv=rig.matrix_world.inverted();rig.animation_data.action=None
for tr in rig.animation_data.nla_tracks:tr.mute=True
source=next(tr.strips[0].action for tr in rig.animation_data.nla_tracks if tr.name=='roll-v2');end=round(source.frame_range[1])
def B(n):return bones['mixamorig:'+n]
def wm(b):return rig.matrix_world@b.matrix
def update():bpy.context.view_layer.update()
def cap():return {b.name:(b.location.copy(),b.rotation_quaternion.copy(),b.scale.copy())for b in bones}
def pose(f):
 rig.animation_data.action=source;rig.animation_data.action_slot=source.slots[0];scene.frame_set(f);update();p=cap();rig.animation_data.action=None
 for n,(l,q,s)in p.items():bones[n].location=l;bones[n].rotation_quaternion=q;bones[n].scale=s
 update()
# Existing hidden source sword objects in the grounded file are unnormalized;
# construct the exact geometry used by the runtime from their imported source.
import statistics
before=set(scene.objects);bpy.ops.import_scene.gltf(filepath=ROOT+'/assets/create-the-exact-isolated-player-sword-s-cmu12ngf.glb');objs=[o for o in scene.objects if o not in before];verts=[];base=Matrix.Rotation(-math.pi/2,4,'Z')@Matrix.Rotation(math.pi,4,'Y')
for o in objs:
 o.hide_render=True
 if o.type=='MESH':verts.extend((base@o.matrix_world)@v.co for v in o.data.vertices)
lo=Vector([min(v[i]for v in verts)for i in range(3)]);hi=Vector([max(v[i]for v in verts)for i in range(3)]);center=Vector(((lo.x+hi.x)/2,(lo.y+hi.y)/2,lo.z));verts=[(v-center)*1.28/(hi.z-lo.z)for v in verts];hv=[v for v in verts if .08<v.z<.25];center=Vector((statistics.median(v.x for v in hv),statistics.median(v.y for v in hv),0));verts=np.array([v-center for v in verts]);blade=verts[verts[:,2]>.32][::30]
def transform(v,m):
 m=np.array(m);return v@m[:3,:3].T+m[:3,3]
def clearance(p,centers):return min(float(np.min(np.linalg.norm(p-c,axis=1)))-r for c,r in centers)
excluded={g.index for g in body.vertex_groups if any(n in g.name for n in ['RightArm','RightForeArm','RightHand','RightShoulder'])};keep=[sum(g.weight for g in v.groups if g.group in excluded)<.35 for v in body.data.vertices]
line=[]
for z in np.linspace(.22,1.26,18):
 near=verts[np.abs(verts[:,2]-z)<.035]
 if len(near):line.append([float(np.median(near[:,0])),float(np.median(near[:,1])),z])
line=np.array(line)
def armor_bvh():
 ev=body.evaluated_get(bpy.context.evaluated_depsgraph_get());me=ev.to_mesh();vv=[ev.matrix_world@v.co for v in me.vertices];polys=[list(p.vertices)for p in me.polygons if all(keep[i]for i in p.vertices)];bvh=BVHTree.FromPolygons(vv,polys);ev.to_mesh_clear();return bvh
def intersections(bvh,mat):
 pts=transform(line,mat);count=0
 for a,b in zip(pts,pts[1:]):
  d=Vector(b-a);hit=bvh.ray_cast(Vector(a),d.normalized(),d.length)
  if hit[0]is not None:count+=1
 return count
rows=[];samples=[];corrections=[];previous=Quaternion()
for f in range(end+1):
 pose(f);arm=B('RightArm');m=wm(arm);sw=wm(bones['WeaponSocket']);local=m.inverted()@sw;shaft=sw.to_quaternion()@Vector((0,0,1));floor0=float(np.min(transform(verts,sw)[:,2]));centers=[(np.array(wm(B(n)).translation),r)for n,r in [('Head',.13),('Spine2',.17),('Spine1',.17),('Hips',.16)]];best=None;bvh=armor_bvh()
 # Rotate the arm as one anatomical chain. The local elbow and wrist joints
 # remain source-captured, avoiding a bent wrist used merely to pass a metric.
 for elevation in [0,.18,.36,.55]:
  for az in range(0,360,15):
   target=Vector((math.cos(math.radians(az))*math.cos(elevation),math.sin(math.radians(az))*math.cos(elevation),math.sin(elevation)));baseq=shaft.rotation_difference(target)
   for twist in [-45,0,45]:
    q=Quaternion(target,math.radians(twist))@baseq
    if q.angle>math.radians(125):continue
    newm=Matrix.LocRotScale(m.translation,q@m.to_quaternion(),m.to_scale());w=newm@local;p=transform(verts,w);floor=float(np.min(p[:,2]));clear=clearance(transform(blade,w),centers);hand=newm@(m.inverted()@wm(B('RightHand'))).translation
    penalty=max(0,.015-floor)*1000+max(0,.025-clear)*350+max(0,.07-hand.z)*500
    penalty+=intersections(bvh,w)*100
    cost=penalty+q.angle*1.0+previous.rotation_difference(q).angle*3.0
    if best is None or cost<best[0]:best=(cost,q,floor,clear,newm)
 # Pure safe source frames should not be changed merely to satisfy the search.
 sourceclear=clearance(transform(blade,sw),centers)
 if floor0>=.015 and sourceclear>=.025 and intersections(bvh,sw)==0 and previous.angle*3<best[0]:chosen=Quaternion();newm=m
 else:chosen=best[1];newm=best[4]
 corrections.append(chosen.copy())
 arm.matrix=inv@newm;update();previous=chosen.copy();w=wm(bones['WeaponSocket']);rows.append({'frame':f,'sourceSwordMinimum':floor0,'swordMinimum':float(np.min(transform(verts,w)[:,2])),'armCorrectionDegrees':math.degrees(chosen.angle),'bladeArmorIntersections':intersections(bvh,w),'bladeCapsuleClearance':clearance(transform(blade,w),centers)});samples.append(cap())
# Smooth the correction itself, not the captured body or the wrist articulation.
rawrows=rows;rows=[];samples=[];lastq=None;groundrows=json.load(open(ROOT+'/docs/player-combat-revision/grounded-trial-report.json'))['roll-v2']['rows']
for f in range(end+1):
 ref=corrections[f];acc=np.zeros(4)
 for j in range(max(0,f-4),min(end,f+4)+1):
  q=corrections[j].copy()
  if q.dot(ref)<0:q.negate()
  acc+=np.array(q)*math.exp(-.5*((j-f)/2)**2)
 smooth=Quaternion(acc.tolist()).normalized();pose(f);bvh=armor_bvh();arm=B('RightArm');m=wm(arm);local=m.inverted()@wm(bones['WeaponSocket'])
 # If smoothing crosses the floor, approach the already-clear sampled solution.
 for mix in [0,.25,.5,.75,1]:
  q=smooth.slerp(ref,mix);nm=Matrix.LocRotScale(m.translation,q@m.to_quaternion(),m.to_scale());floor=float(np.min(transform(verts,nm@local)[:,2]))
  if floor>=.006 and intersections(bvh,nm@local)==0:break
 arm.matrix=inv@nm;update();ev=body.evaluated_get(bpy.context.evaluated_depsgraph_get());me=ev.to_mesh();bodymin=min((ev.matrix_world@v.co).z for v in me.vertices);ev.to_mesh_clear()
 # The changed carry can make the elbow/pauldron the supporting surface.
 # Recompute actual body contact, a root-height reconstruction missing in raw.
 lift=max(0,.003-bodymin,.003-groundrows[f]['shieldMinimum']);hip=B('Hips');hm=wm(hip);hm.translation.z+=lift;hip.matrix=inv@hm;update()
 rows.append({**rawrows[f],'bladeArmorIntersections':intersections(bvh,nm@local),'supportHeightCorrectionMeters':lift,'swordMinimum':floor+lift,'armCorrectionDegrees':math.degrees(q.angle),'correctionFrameStepDegrees':math.degrees(lastq.rotation_difference(q).angle)if lastq else 0,'bodyMinimum':bodymin+lift,'shieldMinimum':groundrows[f]['shieldMinimum']+lift});lastq=q.copy();samples.append(cap())
a=bpy.data.actions.new('roll-carry-trial');rig.animation_data.action=a
for f,s in enumerate(samples):
 for n,(l,q,sc)in s.items():
  b=bones[n];b.location=l;b.rotation_quaternion=q;b.scale=sc;b.keyframe_insert('location',frame=f);b.keyframe_insert('rotation_quaternion',frame=f);b.keyframe_insert('scale',frame=f)
a.use_fake_user=True;rig.animation_data.action=None
tr=next(tr for tr in rig.animation_data.nla_tracks if tr.name=='roll-v2');st=tr.strips[0];st.action=a;st.action_slot=a.slots[0];st.action_frame_start=0;st.action_frame_end=end
for b in bones:b.matrix_basis.identity()
bpy.ops.wm.save_as_mainfile(filepath=OUT+'/player-video-carry-trial.blend');json.dump({'rows':rows,'note':'Diagnostic long-sword shoulder carry; captured elbow/wrist/finger articulation unchanged. Capsule clearance is preliminary, actual mesh proof required.'},open(ROOT+'/docs/player-combat-revision/roll-carry-trial-report.json','w'),indent=2);print('CARRY',min(r['swordMinimum']for r in rows),max(r['armCorrectionDegrees']for r in rows),flush=True)
