"""Render actual baseline palm/handle geometry from anatomical axes, without edits."""
import bpy, os, math, json, statistics, numpy as np
from mathutils import Vector, Matrix, Quaternion
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'))
CANDIDATE=os.environ.get('PLAYER_GRIP_CANDIDATE')=='1'
OUT=ROOT+'/docs/player-combat-revision/'+('candidate-grip' if CANDIDATE else 'baseline-grip')
os.makedirs(OUT,exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=ROOT+'/assets/production/player-essential.blend')
scene=bpy.context.scene
rig=next(o for o in scene.objects if o.type=='ARMATURE')
rig.animation_data.action=None
for t in rig.animation_data.nla_tracks:t.mute=t.name!='idle'
scene.frame_set(0);bpy.context.view_layer.update()
def wm(name):return rig.matrix_world@rig.pose.bones['mixamorig:'+name].matrix
before=set(scene.objects)
bpy.ops.import_scene.gltf(filepath=ROOT+'/assets/create-the-exact-isolated-player-sword-s-cmu12ngf.glb')
props=[o for o in scene.objects if o not in before and o.type=='MESH']
verts=[];base=Matrix.Rotation(-math.pi/2,4,'Z')@Matrix.Rotation(math.pi,4,'Y')
for o in props:
 m=base@o.matrix_world
 for v in o.data.vertices:v.co=m@v.co
 o.parent=None;o.matrix_world.identity();verts.extend(v.co.copy()for v in o.data.vertices)
lo=Vector([min(v[i]for v in verts)for i in range(3)]);hi=Vector([max(v[i]for v in verts)for i in range(3)])
center=Vector(((lo.x+hi.x)/2,(lo.y+hi.y)/2,lo.z));scale=1.28/(hi.z-lo.z)
for o in props:
 for v in o.data.vertices:v.co=(v.co-center)*scale
handle=[v.co for o in props for v in o.data.vertices if .08<v.co.z<.25]
center=Vector((statistics.median(v.x for v in handle),statistics.median(v.y for v in handle),0))
for o in props:
 for v in o.data.vertices:v.co-=center
 o.matrix_world=rig.matrix_world@rig.pose.bones['WeaponSocket'].matrix
socket=rig.matrix_world@rig.pose.bones['WeaponSocket'].matrix
names=['RightHand']+['RightHand'+finger+str(i)for finger in ['Thumb','Index','Middle','Ring','Pinky']for i in [1,2,3]]
points={n:wm(n).translation for n in names}
wrist=points['RightHand'];knuckles=sum((points['RightHand'+f+'1']for f in ['Index','Middle','Ring','Pinky']),Vector())/4
along=(knuckles-wrist).normalized();across=(points['RightHandIndex1']-points['RightHandPinky1']).normalized();normal=along.cross(across).normalized();across=normal.cross(along).normalized()
shaft=(socket.to_3x3()@Vector((0,0,1))).normalized();anchor=socket@Vector((0,0,.16));palm=wrist.lerp(knuckles,.7)
fit={}
if CANDIDATE:
 # The sword must extend toward the thumb/index side, not the pinky side.
 # Fit a common circular finger channel from the current curled finger bones.
 arc=[]
 for f in ['Index','Middle','Ring','Pinky']:
  for j in [1,2,3]:
   p=points['RightHand'+f+str(j)]-wrist;arc.append((p.dot(along),p.dot(normal)))
 xy=np.array(arc);A=np.column_stack([2*xy[:,0],2*xy[:,1],np.ones(len(xy))]);coef=np.linalg.lstsq(A,(xy*xy).sum(axis=1),rcond=None)[0]
 # Fit radius is reported; center follows the grasp channel, not a torso path.
 grip=wrist+along*float(coef[0])+normal*float(coef[1])+across*((knuckles-wrist).dot(across))
 newq=shaft.rotation_difference(across)@socket.to_quaternion()
 socket=Matrix.LocRotScale(grip-newq@Vector((0,0,.16)),newq,Vector((1,1,1)))
 for o in props:o.matrix_world=socket
 # Oppose thumb to the index middle phalanx using the existing thumb chain.
 target=points['RightHandIndex3']-normal*.010+across*.005
 inv=rig.matrix_world.inverted()
 for iteration in range(8):
  for j in [2,1]:
   bone=rig.pose.bones['mixamorig:RightHandThumb'+str(j)];m=rig.matrix_world@bone.matrix;p=m.translation
   end=wm('RightHandThumb3').translation
   delta=(end-p).normalized().rotation_difference((target-p).normalized())
   # Limit each iterative change, to avoid a single sharp thumb-base kink.
   angle=min(delta.angle,.18);delta=Quaternion(delta.axis,angle)
   bone.matrix=inv@Matrix.LocRotScale(p,delta@m.to_quaternion(),m.to_scale());bpy.context.view_layer.update()
 # The distal thumb must also curl toward the closed fingers; moving its base
 # alone leaves an extended straight tip even after opposition is correct.
 terminal=rig.pose.bones['mixamorig:RightHandThumb3'];m=rig.matrix_world@terminal.matrix
 tip=rig.matrix_world@terminal.tail;desired=grip-across*.008-normal*.018+along*.005
 q=(tip-m.translation).normalized().rotation_difference((desired-m.translation).normalized())
 q=Quaternion(q.axis,min(q.angle,math.radians(55)))
 terminal.matrix=inv@Matrix.LocRotScale(m.translation,q@m.to_quaternion(),m.to_scale());bpy.context.view_layer.update()
 shaft=(socket.to_3x3()@Vector((0,0,1))).normalized();anchor=socket@Vector((0,0,.16))
 fit={'channelCircleRadiusMeters':float(math.sqrt(max(0,coef[2]+coef[0]**2+coef[1]**2))),'channelCenterInPalmPlaneMeters':[float(coef[0]),float(coef[1])],'weaponWristOffset':[float(x)for row in (wm('RightHand').inverted()@socket)for x in row],'thumbMatrices':{('RightHandThumb'+str(j)):[float(x)for row in rig.pose.bones['mixamorig:RightHandThumb'+str(j)].matrix_basis for x in row]for j in [1,2,3]}}
report={'bonePositions':{n:list(v)for n,v in points.items()},'palmCenter':list(palm),'handleGripCenter':list(anchor),'handleAxis':list(shaft),'palmWristToKnucklesAxis':list(along),'palmAcrossKnucklesAxis':list(across),'palmNormal':list(normal),'handleAngleToKnuckleSpanDegrees':math.degrees(shaft.angle(across)),'handleAngleToWristKnuckleAxisDegrees':math.degrees(shaft.angle(along)),'handleAnchorDistanceToPalmMeters':(anchor-palm).length,'candidateFit':fit,'note':'Bone landmarks are anatomical diagnostics; actual mesh renders determine whether fingers surround the shaft.'}
json.dump(report,open(OUT+'/report.json','w'),indent=2)
scene.world=bpy.data.worlds.new('Grip diagnostic world');scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.1,.13,.17,1);scene.world.node_tree.nodes['Background'].inputs[1].default_value=.5
def light(loc,power,size):
 d=bpy.data.lights.new('Grip light','AREA');d.energy=power;d.shape='DISK';d.size=size;o=bpy.data.objects.new('Grip light',d);scene.collection.objects.link(o);o.location=loc;o.rotation_euler=(palm-o.location).to_track_quat('-Z','Y').to_euler()
light(palm+Vector((-2,-3,3)),350,3);light(palm+Vector((2,-2,1)),250,2);light(palm+Vector((1,2,2)),450,2)
bpy.ops.object.camera_add();cam=bpy.context.object;scene.camera=cam;cam.data.type='ORTHO';cam.data.ortho_scale=.32
scene.render.engine='CYCLES';scene.cycles.samples=24;scene.cycles.use_denoising=True;scene.render.resolution_x=720;scene.render.resolution_y=720;scene.render.resolution_percentage=100;scene.view_settings.view_transform='AgX'
for name,direction in [('palm',normal),('side',across),('top',along),('back',-normal)]:
 cam.location=palm+direction*1.2;cam.rotation_euler=(palm-cam.location).to_track_quat('-Z','Y').to_euler();scene.render.filepath=OUT+'/'+name+'.png';bpy.ops.render.render(write_still=True)
print(json.dumps(report),flush=True)
