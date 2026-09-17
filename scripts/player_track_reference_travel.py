"""Measure fixed-camera silhouette translation from approved source footage.

This is diagnostic motion measurement, not a newly generated reference. The hit
source is a true side view, so horizontal source displacement gives forward/back
travel. Scale uses the target's1.78m standing capture height against video height.
"""
from pathlib import Path
from PIL import Image
import numpy as np,json,cv2
R=Path(__file__).resolve().parents[1];rows=[]
for p in sorted((R/'docs/player-combat-revision/hit-v3-source-frames').glob('*.png')):
 a=np.array(Image.open(p).convert('RGB'));mask=(a.max(2)<85);y,x=np.where(mask);height=y.max()-y.min();bootmask=mask.copy();bootmask[:205]=False
 count,labels,stats,cents=cv2.connectedComponentsWithStats(bootmask.astype('uint8'),8);regions=[]
 for label,(stat,c)in enumerate(zip(stats[1:],cents[1:]),1):
  xx,yy,w,h,area=map(int,stat)
  if area>55:sy,sx=np.where((labels==label)&(np.indices(mask.shape)[0]>=yy+h-12));regions.append({'soleX':float(sx.mean())if len(sx)else float(c[0]),'x':float(c[0]),'y':float(c[1]),'bottom':yy+h-1,'area':area,'bbox':[xx,yy,w,h]})
 regions=sorted(regions,key=lambda v:v['x']);rows.append({'time':(int(p.stem.split('-')[1])-1)/4,'silhouetteCentroidX':float(x.mean()),'heightPixels':int(height),'boots':regions})
scale=1.78/rows[0]['heightPixels'];start=rows[0]['silhouetteCentroidX'];running=0
for r in rows:
 running=max(running,(start-r['silhouetteCentroidX'])*scale);r['backwardDistanceMeters']=running
out={'reference':'assets/player-combat-revision/source-videos/hit-v3.mp4','metresPerPixel':scale,'calibrationNote':'Approximate1.78m captured standing mesh height; fixed-side source. Final contact cleanup required; this is not camera-calibrated motion capture.','rows':rows};(R/'docs/player-combat-revision/hit-source-travel-measurement.json').write_text(json.dumps(out,indent=2));print('Hit source measured backward travel',rows[-1]['backwardDistanceMeters'])
