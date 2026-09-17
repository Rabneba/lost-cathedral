import os
exec(open(os.path.join(os.path.dirname(__file__),'audit_boss_regrasp_subframes.py')).read().split('prev=None')[0])
for n in ['LeftArm','LeftForeArm','LeftHand','Hips']:
 p=rig.pose.bones['mixamorig:'+n];print('MODE',n,p.rotation_mode)
prev={}
for f in[177.875,178,178.125,178.25,178.375,178.5,178.625,178.75,178.875,179,183,183.5,184]:
 bpy.context.scene.frame_set(int(f),subframe=f%1);bpy.context.view_layer.update();row={}
 for n in['LeftArm','LeftForeArm','LeftHand','Hips']:
  p=rig.pose.bones['mixamorig:'+n];q=p.matrix_basis.to_quaternion();d=prev[n].rotation_difference(q).angle if n in prev else 0;prev[n]=q.copy();row[n]={'q':list(q),'angle':math.degrees(min(d,2*math.pi-d)),'position':list(p.matrix.translation)}
 print('FRAME',f,json.dumps(row),flush=True)
