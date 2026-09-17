"""Check final wrist/grip residual against current anatomical hand orientation."""
import bpy,os,json
from mathutils import Vector
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'))
bpy.ops.wm.open_mainfile(filepath='/tmp/vesper-boss-candidate-v4.blend')
scene=bpy.context.scene;rig=next(o for o in scene.objects if o.type=='ARMATURE')
def B(s):return rig.pose.bones['mixamorig:'+s]
def M(p):return rig.matrix_world@p.matrix
def P(p):return M(p).translation
def G(s):
 ps=[P(B(s+'Hand'+d+str(j)))for d in ['Index','Middle','Ring','Pinky']for j in [1,3]]
 return sum(ps,Vector())*(.8/len(ps))+P(B(s+'HandThumb3'))*.2
def frame(name,f):
 for t in rig.animation_data.nla_tracks:t.mute=True
 strip=next(t for t in rig.animation_data.nla_tracks if t.name==name).strips[0]
 rig.animation_data.action=strip.action;rig.animation_data.action_slot=strip.action_slot
 scene.frame_set(f);bpy.context.view_layer.update()
frame('idle',0)
local={s:M(B(s+'Hand')).to_quaternion().inverted()@(G(s)-P(B(s+'Hand')))for s in ['Left','Right']}
reports=json.load(open(os.path.join(ROOT,'docs/combat-revision/boss-candidate-bake-v4.json')))
out={}
for clip,f in [('sweep',53),('slam',90)]:
 frame(clip,f);r=reports[clip]['samples'][f];C=Vector(r['center']);A=Vector(r['shaft']);centers={};radii={};data={}
 for side,sign in [('Right',-1),('Left',1)]:
  w=P(B(side+'Hand'));e=P(B(side+'ForeArm'));s=P(B(side+'Arm'));q=M(B(side+'Hand')).to_quaternion();offset=A*r['spacing']*.5*sign
  target=C+offset;targetW=target-q@local[side]
  reach=(e-s).length+(w-e).length-.035
  centers[side]=s-offset+q@local[side];radii[side]=reach
  data[side]={'gripError':(G(side)-target).length,'currentWristError':(w-targetW).length,'targetReach':(targetW-s).length,'allowedReach':reach,'reachExcess':(targetW-s).length-reach,
   'localGripDelta':(q.inverted()@(G(side)-w)-local[side]).length,'localGripLength':local[side].length,'armLengths':[(e-s).length,(w-e).length]}
 data['sphereSeparation']=(centers['Left']-centers['Right']).length;data['sumRadii']=sum(radii.values());data['time']=f/30
 out[clip]=data;print('RESIDUAL',clip,json.dumps(data),flush=True)
json.dump(out,open(os.path.join(ROOT,'docs/combat-revision/boss-grip-residual-v4.json'),'w'),indent=2)
