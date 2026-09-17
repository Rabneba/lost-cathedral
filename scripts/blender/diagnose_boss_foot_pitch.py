import os,math
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'))
exec(compile(open(ROOT+'/scripts/blender/diagnose_boss_foot_support.py').read().split('rows=[]')[0],'setup','exec'))
for deg in [-5,-3,-1,0,1,3,5]:
 apply(poses[182]);s='Left';m=M(B(s+'Foot'));d=P(B(s+'ToeBase'))-P(B(s+'Foot'));d.z=0;d.normalize();axis=Vector((0,0,1)).cross(d).normalized();q=Quaternion(axis,math.radians(deg))@flat[s]['rotation'];B(s+'Foot').matrix=inv@Matrix.LocRotScale(m.translation,q,m.to_scale());B(s+'ToeBase').matrix_basis=flat[s]['toe'];update();print('PITCH',deg,'height',P(B(s+'Foot')).z-sole(s),'required',P(B(s+'UpLeg')).z-((P(B(s+'Leg'))-P(B(s+'UpLeg'))).length+(P(B(s+'Foot'))-P(B(s+'Leg'))).length),flush=True)
