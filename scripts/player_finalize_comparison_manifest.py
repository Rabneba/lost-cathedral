"""Pair immutable reviewed source/raw motion with the actual corrected proof."""
from pathlib import Path
import hashlib,json,subprocess
R=Path(__file__).resolve().parent.parent
p=R/'docs/player-combat-revision/comparison-manifest.json';r=json.loads(p.read_text())
for name,row in r['pairs'].items():
 movie=R/row['correctedMovie'];row['proofStatus']='pending'
 if not movie.exists():continue
 check=subprocess.run(['/opt/homebrew/bin/ffprobe','-v','error','-show_entries','format=duration:stream=width,height,nb_frames,avg_frame_rate','-of','json',str(movie)],capture_output=True,text=True)
 if check.returncode:row['proofStatus']='incomplete';continue
 data=json.loads(check.stdout);row['proofStatus']='complete';row['movieDuration']=float(data['format']['duration']);row['movieSha256']=hashlib.sha256(movie.read_bytes()).hexdigest();row['videoStreams']=data.get('streams',[])
r['status']='All six corrected proof movies complete and paired with reviewed sources/raw motions.' if all(v['proofStatus']=='complete'for v in r['pairs'].values())else 'Some proof movies remain pending; inspect each proofStatus. Final candidate is accepted for dev integration.'
p.write_text(json.dumps(r,indent=2)+'\n');print(json.dumps({k:{'status':v['proofStatus'],'duration':v.get('movieDuration')}for k,v in r['pairs'].items()},indent=2))
