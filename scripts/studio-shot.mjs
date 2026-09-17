// Capture animation-studio stills through the capture bridge (scripts/capture-server.mjs + a
// worker tab in the user's Chrome at http://127.0.0.1:5179/animation-review.html?capture-worker=1).
// Same shot syntax as scripts/studio-capture.mjs:
//   node scripts/studio-shot.mjs --out DIR [--extra "playerRig=...&playerManifest=..."] [--timeout 900]
//        name=character,clip,time,view[,facing[,weapons]] ...
// Each shot is one navigation of the worker tab (the studio reloads its rigs per shot, ~3-8 s each).
import {mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
const arg=(name,fallback)=>{const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:fallback;};
const SERVER=arg('--server',process.env.VESPER_CAPTURE_SERVER||'http://127.0.0.1:5199'),OUT=path.resolve(arg('--out','docs/studio-captures')),TIMEOUT=Number(arg('--timeout','900'))*1000,EXTRA=arg('--extra','');
const optionValues=new Set();for(let i=2;i<process.argv.length;i++)if(process.argv[i].startsWith('--'))optionValues.add(process.argv[i+1]);
const shots=process.argv.slice(2).filter(a=>a.includes('=')&&!a.startsWith('--')&&!optionValues.has(a)).map(a=>{const eq=a.indexOf('=');const name=a.slice(0,eq);const [character,clip,time,view,facing,weapons]=a.slice(eq+1).split(',');
 const params=new URLSearchParams({character,clip,time,view:view||'side'});if(facing==='1')params.set('facing','1');if(weapons==='0')params.set('weapons','0');for(const [k,v] of new URLSearchParams(EXTRA))params.set(k,v);
 return {name,character,clip,time,view,facing,weapons,params:params.toString()};});
if(!shots.length){console.error('no shots given (name=character,clip,time,view[,facing[,weapons]])');process.exit(1);}
mkdirSync(OUT,{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
try{await (await fetch(SERVER+'/health')).json();}catch{console.error(`capture server not reachable at ${SERVER}. Start it with: node scripts/capture-server.mjs (and keep a worker tab open on http://127.0.0.1:5179/animation-review.html?capture-worker=1)`);process.exit(2);}
const {id}=await (await fetch(SERVER+'/job',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kind:'studio',out:OUT,shots})})).json();
const t0=Date.now();let job;
for(;;){job=await (await fetch(`${SERVER}/job/${id}`)).json();if(job.status==='done'||job.status==='failed')break;if(Date.now()-t0>TIMEOUT){console.error(`timed out after ${TIMEOUT/1000}s waiting for studio job ${id} (status ${job.status}); is the studio worker tab open?`);process.exit(3);}await sleep(700);}
const results=job.results.filter(Boolean);
for(const r of results)console.log(JSON.stringify(r));
writeFileSync(path.join(OUT,'captures.json'),JSON.stringify({server:SERVER,bridge:'worker-tab',results,errors:job.errors},null,1));
if(job.errors.length){console.log('page errors:');for(const e of job.errors)console.log(' -',String(e).slice(0,300));}
if(results.length<shots.length){console.error(`only ${results.length}/${shots.length} shots came back`);process.exit(4);}
