"""Report actual space/time limits of a solved candidate trajectory."""
import os,json,sys,math
from mathutils import Vector,Quaternion
sys.path.insert(0,os.path.dirname(__file__))
import solve_boss_trajectory_beam as u
TAG=os.environ.get('VESPER_TRAJECTORY_TAG','v24-whole');path=os.path.join(u.ROOT,'docs/combat-revision/boss-trajectory-'+TAG+'.json');data=json.load(open(path));out={'tag':TAG,'trajectoryStatus':data['status'],'clips':{}}
for clip,entry in data['clips'].items():
 rows=[u.restore(x)for x in entry['samples']];refs=data.get('referenceOverrides',{}).get(clip,u.META['clips'][clip]);stats={};exception=[]
 def add(key,value,f):
  if key not in stats or value>stats[key]['value']:stats[key]={'value':value,'frame':f,'time':f/30}
 for f,r in enumerate(rows):
  angle=math.degrees(u.angle(r['quaternion'],Quaternion(refs[f]['quaternion'])));add('referenceWeaponDegrees',angle,f);add('referenceCenterMeters',(r['center']-Vector(refs[f]['center'])).length,f)
  if angle>20.627:exception.append({'frame':f,'degrees':angle})
  for side,h in r['hands'].items():add(side+'WristBendDegrees',abs(h['bendDegrees']),f)
  if f:
   p=rows[f-1];add('centerStepMeters',(r['center']-p['center']).length,f);add('weaponStepDegrees',math.degrees(u.angle(r['quaternion'],p['quaternion'])),f);add('spacingStepMeters',abs(r['spacing']-p['spacing']),f)
   for side,h in r['hands'].items():
    ph=p['hands'][side];add(side+'ElbowStepMeters',(h['elbow']-ph['elbow']).length,f);add(side+'WristStepMeters',(h['wrist']-ph['wrist']).length,f);add(side+'HandStepDegrees',math.degrees(u.hand_angle(h,ph)),f);add(side+'BendStepDegrees',abs(h['bendDegrees']-ph['bendDegrees']),f);add(side+'BendVectorStepDegrees',math.degrees(u.bend_vector_angle(h,ph)),f)
  if f>1:add('centerSecondDifferenceMeters',(r['center']-rows[f-1]['center']*2+rows[f-2]['center']).length,f)
 out['clips'][clip]={'complete':entry['complete'],'frames':len(rows),'maxima':stats,'referenceConeExceptions':exception,'minimumCachedShaftGap':min(r.get('minimumShaftSurfaceGap',float('inf'))for r in rows)}
output=os.path.join(u.ROOT,'docs/combat-revision/boss-trajectory-parameters-'+TAG+'.json');json.dump(out,open(output,'w'),indent=2);print(json.dumps(out,indent=2));print(output)
