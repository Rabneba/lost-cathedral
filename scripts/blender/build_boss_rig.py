"""Build the editable custom rig, diagnostic poses and game export in Blender.
This writes no animation actions or clips. Run after prepare_boss_weights.py.
"""
import bpy, math, json, os
import numpy as np
from mathutils import Vector, Matrix, Quaternion

ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'))
OUT=os.path.join(ROOT,'assets/rigs/reliquary-saint')
bpy.ops.wm.open_mainfile(filepath=os.path.join(OUT,'source-canonical.blend'))
body=bpy.data.objects['ReliquarySaint_Body']
anatomy=json.load(open(os.path.join(OUT,'rig-anatomy.json')))
skin=np.load(os.path.join(OUT,'skin-weights.npz'))
defs=anatomy['bones']; chains=anatomy['chains']
bpy.ops.object.select_all(action='DESELECT')
arm=bpy.data.armatures.new('ReliquarySaint_CustomSkeleton')
rig=bpy.data.objects.new('ReliquarySaint_Rig',arm);bpy.context.scene.collection.objects.link(rig)
rig.show_in_front=True;arm.display_type='OCTAHEDRAL';rig.select_set(True);bpy.context.view_layer.objects.active=rig
collections={name:arm.collections.new(name) for name in ['Body','Main arms','Spire arms','Mantle arms','Outer arms','Legs','Controls','Sockets']}
bpy.ops.object.mode_set(mode='EDIT')
def bone(name,head,tail,parent=None,deform=True):
    b=arm.edit_bones.new(name);b.head=head;b.tail=tail;b.use_deform=deform
    b.inherit_scale='NONE'
    if parent:b.parent=arm.edit_bones[parent]
    return b
bone('ROOT',(0,0,0),(0,0,.7),deform=False)
bone('CTRL_body',(0,.16,4.08),(0,.16,4.75),'ROOT',False)
for d in defs:bone(d['name'],d['head'],d['tail'],d['parent'] or 'CTRL_body')
for c in chains:
    end=arm.edit_bones[c['endBone']]
    ctrl=f'CTRL_contact_{c["key"]}';pole=f'CTRL_pole_{c["key"]}'
    bone(ctrl,end.head,end.tail,'ROOT',False)
    lower=arm.edit_bones[c['ikEnd']];upper=lower.parent
    direction=(lower.tail-upper.head).normalized()
    projection=upper.head+direction*(upper.tail-upper.head).dot(direction)
    bend=upper.tail-projection
    if bend.length<.05:bend=Vector((0,-1,0))
    pos=upper.tail+bend.normalized()*1.5
    bone(pole,pos,pos+Vector((0,0,.25)),'ROOT',False)
    c['contactControl']=ctrl;c['poleControl']=pole
for side in ['L','R']:
    hand=arm.edit_bones[f'DEF_main_02.{side}']
    # Place the shaft in the finger enclosure, not at the wrist/palm root.
    h=Vector((1.38 if side=='L' else -1.38,-.73,1.60))
    bone(f'DEF_weapon_socket.{side}',h,h+Vector((.25,0,0)),hand.name)
bone('SOCKET_cloth',(0,.28,4.28),(0,.28,4.58),'DEF_pelvis',False)
bpy.ops.object.mode_set(mode='OBJECT')
for b in arm.bones:
    if b.name.startswith('CTRL') or b.name=='ROOT':group='Controls';palette='THEME04'
    elif 'socket' in b.name or b.name.startswith('SOCKET'):group='Sockets';palette='THEME09'
    else:
        group=next((label for word,label in [('main','Main arms'),('spire','Spire arms'),('mantle','Mantle arms'),('outer','Outer arms'),('leg','Legs'),('toes','Legs')] if word in b.name),'Body')
        palette='THEME03' if b.name.endswith('.L') else 'THEME01' if b.name.endswith('.R') else 'THEME09'
    collections[group].assign(b);b.color.palette=palette
    p=rig.pose.bones[b.name];p.rotation_mode='QUATERNION'

# Assign the four normalized surface weights without altering topology or UVs.
for i,d in enumerate(defs):
    vg=body.vertex_groups.new(name=d['name'])
    rows,slots=np.where(skin['indices']==i)
    values=np.round(skin['weights'][rows,slots]*1000).astype(np.int32)
    # Batch assignments by 0.001 weight steps. The deformation and exporter
    # normalize each vertex, keeping the approximation below 0.002 per vertex.
    for value in np.unique(values):
        if value>0:vg.add(rows[values==value].tolist(),float(value)/1000,'REPLACE')
print('WEIGHTS_BOUND',len(body.vertex_groups),flush=True)
modifier=body.modifiers.new('Custom skeletal deformation','ARMATURE');modifier.object=rig
modifier.show_viewport=False
# Linear skinning matches the glTF/Three.js runtime. Rigid sections use near-unit
# weights; joint regions blend locally. No Blender-only corrective modifier.
modifier.use_deform_preserve_volume=False
body.parent=rig

widgets=bpy.data.collections.new('Rig widgets');bpy.context.scene.collection.children.link(widgets)
def widget(name,kind='circle'):
    vertices=[];edges=[]
    if kind=='diamond':
        vertices=[(1,0,0),(-1,0,0),(0,1,0),(0,-1,0),(0,0,1),(0,0,-1)]
        edges=[(a,b) for a in range(2) for b in range(2,6)]+[(a,b) for a in range(2,4) for b in range(4,6)]
    else:
        for axis in range(3):
            start=len(vertices)
            for i in range(24):
                a=i*math.tau/24;p=[0,0,0];p[(axis+1)%3]=math.cos(a);p[(axis+2)%3]=math.sin(a);vertices.append(p);edges.append((start+i,start+(i+1)%24))
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(vertices,edges,[])
    obj=bpy.data.objects.new(name,mesh);widgets.objects.link(obj);obj.hide_render=True;obj.hide_set(True)
    return obj
circle=widget('WGT_contact');diamond=widget('WGT_pole','diamond')
for p in rig.pose.bones:
    if p.name.startswith('CTRL') or p.name=='ROOT':
        p.custom_shape=diamond if 'pole' in p.name else circle;p.use_custom_shape_bone_size=False
        size=1.4 if p.name=='ROOT' else .65 if p.name=='CTRL_body' else .11 if 'pole' in p.name else .23
        p.custom_shape_scale_xyz=(size,size,size)

# Each contact control has an explicit FK/IK blend. Calibrate pole angles against
# the approved rest pose so switching IK on does not flip elbows or knees.
calibration={}
print('CALIBRATING_CONTACTS',flush=True)
for c in chains:
    lower=rig.pose.bones[c['ikEnd']]
    reference=lower.head.copy()
    ik=lower.constraints.new('IK');ik.name=f'Contact {c["key"]}';ik.target=rig;ik.subtarget=c['contactControl']
    ik.pole_target=rig;ik.pole_subtarget=c['poleControl'];ik.chain_count=2;ik.use_stretch=False;ik.iterations=200
    best_angle=0;best_error=1e10
    for a in np.linspace(-math.pi,math.pi,25):
        ik.pole_angle=float(a);bpy.context.view_layer.update()
        error=(lower.head-reference).length
        if error<best_error:best_error=error;best_angle=float(a)
    step=math.pi/12
    for _ in range(4):
        for a in np.linspace(best_angle-step,best_angle+step,7):
            ik.pole_angle=float(a);bpy.context.view_layer.update();error=(lower.head-reference).length
            if error<best_error:best_error=error;best_angle=float(a)
        step/=4
    ik.pole_angle=best_angle;ik.influence=0
    ctrl=rig.pose.bones[c['contactControl']];ctrl['IK']=0.0
    ctrl.id_properties_ui('IK').update(min=0.0,max=1.0,description='0 = rotate deformation bones; 1 = planted contact with pole control')
    driver=ik.driver_add('influence').driver;driver.expression='blend'
    var=driver.variables.new();var.name='blend';var.type='SINGLE_PROP';var.targets[0].id=rig
    var.targets[0].data_path=f'pose.bones["{ctrl.name}"]["IK"]'
    rotation=rig.pose.bones[c['endBone']].constraints.new('COPY_ROTATION');rotation.name='Contact orientation'
    rotation.target=rig;rotation.subtarget=c['contactControl'];rotation.target_space='WORLD';rotation.owner_space='WORLD'
    dr=rotation.driver_add('influence').driver;dr.expression='blend';v=dr.variables.new();v.name='blend';v.type='SINGLE_PROP';v.targets[0].id=rig;v.targets[0].data_path=var.targets[0].data_path
    calibration[c['key']]=dict(poleAngle=best_angle,restElbowErrorMetres=best_error)
    print('IK_CALIBRATED',c['key'],best_error,flush=True)

def reset():
    for p in rig.pose.bones:
        p.matrix_basis=Matrix.Identity(4)
        if 'IK' in p:p['IK']=0.0
    rig.update_tag();bpy.context.view_layer.update()
def turn(name,axis,degrees):
    p=rig.pose.bones[name];p.rotation_quaternion=p.rotation_quaternion@Quaternion(Vector(axis),math.radians(degrees))
def contact(key,offset=(0,0,0)):
    c=next(c for c in chains if c['key']==key);p=rig.pose.bones[c['contactControl']];p['IK']=1.0
    # Apply translation in armature/world axes, not the rotated control axes.
    m=p.matrix.copy();m.translation+=Vector(offset);p.matrix=m
    rig.update_tag();bpy.context.view_layer.update()

def close_weapon_hand():
    """Pose the two segments of each claw around the separate shaft.

    Targets are authored in the unposed hand's space and carried through the
    current hand transform. Two claws curl forward, the rear claw opposes them.
    """
    hand=rig.pose.bones['DEF_main_02.R']
    hand_delta=hand.matrix@hand.bone.matrix_local.inverted()
    for finger in range(1,4):
        first=rig.pose.bones[f'DEF_main_claw{finger}_1.R']
        second=rig.pose.bones[f'DEF_main_claw{finger}_2.R']
        a=first.bone.head_local.copy()
        c=Vector((a.x,-.87 if finger==2 else -.59,1.64))
        vector=c-a;distance=vector.length;u=vector.normalized()
        l1=first.bone.length;l2=second.bone.length
        along=(l1*l1-l2*l2+distance*distance)/(2*distance)
        height=math.sqrt(max(0,l1*l1-along*along))
        toward=Vector((0,1 if finger==2 else -1,0))
        perpendicular=(toward-u*toward.dot(u)).normalized()
        elbow=a+u*along+perpendicular*height
        for p,head,tail in [(first,a,elbow),(second,elbow,c)]:
            rotation=(p.bone.tail_local-p.bone.head_local).rotation_difference(tail-head)
            matrix=(rotation@p.bone.matrix_local.to_quaternion()).to_matrix().to_4x4()
            matrix.translation=head;p.matrix=hand_delta@matrix
            bpy.context.view_layer.update()

# Separate weapon object, rigidly weighted to its attachment bone. The original
# blade GLB and the body-only rig export remain separate reusable assets.
modifier.show_viewport=True
reset()
before=set(bpy.context.scene.objects)
bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT,'assets/create-the-exact-isolated-boss-blade-sho-cmu12nkg.glb'))
blade=next(o for o in set(bpy.context.scene.objects)-before if o.type=='MESH');blade.name='ReliquarySaint_Blade'
blade.rotation_mode='XYZ';blade.rotation_euler.z=-math.pi/2
bpy.ops.object.select_all(action='DESELECT');blade.select_set(True);bpy.context.view_layer.objects.active=blade
bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
a=np.array([v.co[:] for v in blade.data.vertices]);low=a.min(0);high=a.max(0);a=(a-(low+high)/2)*(5.5/(high[2]-low[2]));a[:,2]+=2.75
grip=np.median(a[np.abs(a[:,2]-3.36)<.07],axis=0);socket=arm.bones['DEF_weapon_socket.R'].head_local
angle=math.radians(90);rot=np.array(Matrix.Rotation(angle,3,'Y'))
a=(a-grip)@rot.T+np.array(socket)
for v,co in zip(blade.data.vertices,a):v.co=co
vg=blade.vertex_groups.new(name='DEF_weapon_socket.R');vg.add(list(range(len(blade.data.vertices))),1.0,'REPLACE')
mod=blade.modifiers.new('Rigid weapon socket','ARMATURE');mod.object=rig;blade.parent=rig
blade.hide_render=True;blade.hide_set(True)

scene=bpy.context.scene;scene.cycles.samples=24
scene.render.resolution_x=1600;scene.render.resolution_y=1200
scene.view_settings.view_transform='AgX'
for o in scene.objects:
    if o.type=='LIGHT':o.data.energy*=.75
camera=scene.camera
source=np.array([v.co[:] for v in body.data.vertices])
f=np.array([p.vertices[:] for p in body.data.polygons]);edges=np.unique(np.sort(f[:,[0,1,1,2,2,0]].reshape(-1,2),axis=1),axis=0)
base_length=np.linalg.norm(source[edges[:,0]]-source[edges[:,1]],axis=1)
valid=base_length>1e-5
def positions():
    deps=bpy.context.evaluated_depsgraph_get();ob=body.evaluated_get(deps);m=ob.to_mesh();out=np.array([v.co[:] for v in m.vertices]);ob.to_mesh_clear();return out
def pose_data():
    result={}
    for b in arm.bones:
        if not b.use_deform:continue
        pose=rig.pose.bones[b.name]
        # glTF omits non-deforming controls. Fold their transforms into the
        # nearest exported ancestor, including CTRL_body motion at the pelvis.
        parent=b.parent
        while parent and not parent.use_deform:parent=parent.parent
        rest_local=parent.matrix_local.inverted()@b.matrix_local if parent else b.matrix_local
        pose_local=rig.pose.bones[parent.name].matrix.inverted()@pose.matrix if parent else pose.matrix
        delta=rest_local.inverted()@pose_local
        result[b.name]=[float(delta[r][c]) for c in range(4) for r in range(4)]
    return result
def render(name,view='front'):
    if os.environ.get('RIG_SKIP_RENDERS')=='1':return
    camera.location=(0,-20,4) if view=='front' else (14,-18,7)
    camera.rotation_euler=(Vector((0,0,4))-camera.location).to_track_quat('-Z','Y').to_euler()
    scene.render.filepath=os.path.join(OUT,f'{name}-{view}.png');bpy.ops.render.render(write_still=True)
evaluated_poses={}
def evaluate(name):
    current=positions();stretch=np.linalg.norm(current[edges[:,0]]-current[edges[:,1]],axis=1)[valid]/base_length[valid]
    evaluated_poses[name]=current
    displacement=np.linalg.norm(current-source,axis=1)
    return dict(pose=name,finite=bool(np.isfinite(current).all()),edgeStretchP99=float(np.quantile(stretch,.99)),edgeStretchP999=float(np.quantile(stretch,.999)),
                edgesStretchedOver2x=int(np.sum(stretch>2)),maxVertexDisplacement=float(displacement.max()),
                oppositeSideDisplacement=float(displacement[source[:,0]<-.25].max()),
                minHeight=float(current[:,2].min()))

tests=[];presets={}
close_weapon_hand()
grip_pose={name:delta for name,delta in pose_data().items() if name.startswith('DEF_main_claw') and name.endswith('.R')}
reset();presets['rest']=pose_data();tests.append(evaluate('rest'));render('rig-rest')

# First proof: isolate a crowded left spire chain and then a planted leg bend.
turn('DEF_spire_01.L',(1,0,0),38);turn('DEF_spire_02.L',(1,0,0),-24)
bpy.context.view_layer.update();tests.append(evaluate('shoulder-test'));presets['shoulder']=pose_data();render('shoulder-test')
reset();contact('leg.L',(0,-.65,.35));tests.append(evaluate('leg-test'));presets['leg']=pose_data();render('leg-test','three-quarter')

# Full-rig static contact/weapon checks after the isolated deformation tests.
reset();contact('leg.L');contact('leg.R')
lowered=rig.pose.bones['CTRL_body'].matrix.copy();lowered.translation.z-=.52
rig.pose.bones['CTRL_body'].matrix=lowered;rig.update_tag();bpy.context.view_layer.update()
tests.append(evaluate('planted-crouch'));presets['crouch']=pose_data();render('planted-crouch','three-quarter')
reset();turn('DEF_main_00.R',(1,0,0),-24);turn('DEF_main_01.R',(1,0,0),-40)
bpy.context.view_layer.update();close_weapon_hand();blade.hide_render=False;blade.hide_set(False)
tests.append(evaluate('weapon-grip'));presets['weapon']=pose_data();render('weapon-grip','three-quarter')
if os.environ.get('RIG_SKIP_RENDERS')!='1':
    camera.data.ortho_scale=2.7
    focus=rig.pose.bones['DEF_weapon_socket.R'].head.copy()
    for label,direction in [('front',(0,-10,0)),('side',(10,0,0))]:
        camera.location=focus+Vector(direction)
        camera.rotation_euler=(focus-camera.location).to_track_quat('-Z','Y').to_euler()
        scene.render.filepath=os.path.join(OUT,f'weapon-grip-close-{label}.png');bpy.ops.render.render(write_still=True)
    camera.data.ortho_scale=12
blade.hide_render=True;blade.hide_set(True)
reset()
print('DEFORMATION_REPORT',json.dumps(tests),flush=True)
json.dump(dict(calibration=calibration,poses=tests),open(os.path.join(OUT,'rig-validation.json'),'w'),indent=2)
json.dump(dict(poses=presets,grip=grip_pose,space='postmultiply exported rest-local matrix by column-major delta; diagnostic poses only'),open(os.path.join(OUT,'diagnostic-poses.json'),'w'),indent=2)
np.savez_compressed(os.path.join(OUT,'evaluated-poses.npz'),**evaluated_poses)
json.dump(anatomy,open(os.path.join(OUT,'rig-anatomy.json'),'w'),indent=2)

help_text='''RELIQUARY SAINT — CUSTOM RIG

Approved Genex body, original geometry/UVs preserved. Blender +Z up, -Y front.
93 weighted anatomical bones, 2 weapon sockets, 10 independent contact controls.

Select ReliquarySaint_Rig and enter Pose Mode.
ROOT moves everything. CTRL_body shifts the torso and pelvis.
Rotate DEF bones for FK posing. Each CTRL_contact_* has an IK slider in Custom
Properties: 0 = FK; 1 = place wrist/ankle with contact control + pole control.
Set both leg contacts to IK=1 before lowering CTRL_body for planted feet.
In IK mode the contact control also holds hand/foot orientation.
Every arm has independent controls; outer arms are not substitutes for legs.
Collections group the four arm pairs, body, legs, controls and weapon sockets.

Blade is a separate hidden mesh attached to DEF_weapon_socket.R. Unhide it to
review the assembled weapon. No cloth is baked into the body.

No combat animation clips or timeline actions have been created. Static
diagnostic poses are saved in diagnostic-poses.json and exposed in the web viewer.
Scripts and validation reports are in scripts/blender/ and this asset directory.
'''
text=bpy.data.texts.new('READ ME — Rig controls');text.write(help_text)
rig['rig_version']='custom-1';rig['body_plan']='two legs, four independent arm pairs';rig['diagnostic_poses_only']=True
rig['source_generation']='cmu12uauc03i02pnw86x2kuci';rig['height_metres']=8.0

def export(path,include_blade=False):
    reset();bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);body.select_set(True)
    if include_blade:blade.hide_set(False);blade.select_set(True)
    bpy.context.view_layer.objects.active=rig
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT,path),export_format='GLB',use_selection=True,
      export_animations=False,export_skins=True,export_def_bones=True,export_extras=True,
      export_apply=False,export_yup=True,export_influence_nb=4,export_all_influences=False,
      export_image_format='AUTO',export_materials='EXPORT',export_cameras=False,export_lights=False)
    blade.hide_set(True)
export('reliquary-saint-rig.glb')
export('reliquary-saint-armed-rig.glb',True)
reset();bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);bpy.context.view_layer.objects.active=rig
bpy.ops.object.mode_set(mode='POSE');arm.bones.active=arm.bones['CTRL_body']
for screen in bpy.data.screens:
 for area in screen.areas:
  if area.type=='VIEW_3D':
   space=area.spaces.active;space.shading.type='MATERIAL';space.region_3d.view_distance=13
   space.region_3d.view_location=Vector((0,0,4));space.region_3d.view_rotation=Quaternion((1,0,0),math.pi/2)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT,'reliquary-saint-rig.blend'))
print('RIG_COMPLETE',flush=True)
