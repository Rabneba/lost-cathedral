"""One production login, immediate session diagnosis and already-authorized jobs.
No credentials are printed or copied. Stop if auth fails. Existing job IDs guard
against billing a duplicate. This is a temporary diagnostic workflow.
"""
from pathlib import Path
import subprocess,json,sys
ROOT=Path(__file__).resolve().parents[1]
subprocess.run(['npx','genex','auth','--force'],cwd=ROOT,check=True)
doctor=subprocess.run(['npx','genex','doctor'],cwd=ROOT)
if doctor.returncode:raise SystemExit('Authentication is still rejected; no jobs submitted.')
probe=r"""
import {readUserToken,apiFetch} from './node_modules/@genex-ai/cli-demo/dist/chunk-OJAXYQ5L.js';
import fs from 'node:fs';
const token=await readUserToken();
const r=await apiFetch('https://api.genex.games/api/auth/get-session',{headers:{Authorization:`Bearer ${token}`}});
const d=await r.json().catch(()=>null);
const out={checkedUTC:new Date().toISOString(),status:r.status,userPresent:!!d?.user,sessionPresent:!!d?.session};
for(const key of ['createdAt','updatedAt','expiresAt'])if(d?.session?.[key])out[key]=d.session[key];
fs.writeFileSync('docs/combat-revision/auth-fresh-session-metadata.json',JSON.stringify(out,null,2)+'\n');
console.log(JSON.stringify(out));
if(!d?.user)process.exit(1);
"""
subprocess.run(['node','--input-type=module','-e',probe],cwd=ROOT,check=True)
doc=ROOT/'docs/player-combat-revision'
for name,verb in [('guard-v2','low shield guard breathing'),('roll-v2','forward shoulder roll')]:
 job=doc/(name+'-motion-job.jsonl')
 if job.exists() and any('"id"' in line for line in job.read_text().splitlines()):
  print('Already recorded, skip',name,flush=True);continue
 cmd=['npx','genex','character','animate','cmu1g9dee049k2pnw1spkx8ku',verb,
      '--video','assets/player-combat-revision/source-videos/'+name+'.mp4','--no-wait','--json']
 result=subprocess.run(cmd,cwd=ROOT,text=True,capture_output=True)
 job.write_text(result.stdout);(doc/(name+'-motion-stderr.log')).write_text(result.stderr)
 print(name,result.stdout,result.stderr,flush=True)
 if result.returncode:raise SystemExit('Motion request failed; stopped without further requests.')
for name in ['light-v2','hit-v3']:
 subprocess.run([sys.executable,'scripts/player_queue_combat_videos.py',name],cwd=ROOT,check=True)
