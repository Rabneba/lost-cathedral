// Capture stills of the actual game through the capture bridge (scripts/capture-server.mjs +
// a worker tab in the user's Chrome at http://127.0.0.1:5179/?capture-worker=1). Same shot
// syntax as scripts/game-capture.mjs, which needs a headless Chromium this machine cannot start:
//   node scripts/game-shot.mjs --out DIR [--quality high|balanced|low] [--width 1600] [--height 900]
//        [--settle 3000] [--png] [--menu] [--hud 0] [--gizmos] [--setup "<js>"] [--timeout 600]
//   --gizmos draws the facing lines (cyan head, amber hips, white root); off by default.
//        [js:<name>=<expression>] name=yawDeg,pitch,distance,waitMs[,lock] ...
// Writes <out>/<name>.jpg and <out>/captures.json (state per shot incl. renderMs, calls, triangles, errors).
import {mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
const arg=(name,fallback)=>{const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:fallback;};
const flag=name=>process.argv.includes(name);
const SERVER=arg('--server',process.env.VESPER_CAPTURE_SERVER||'http://127.0.0.1:5199'),OUT=path.resolve(arg('--out','docs/game-captures')),TIMEOUT=Number(arg('--timeout','600'))*1000;
const options={quality:arg('--quality','high'),width:Number(arg('--width','1600')),height:Number(arg('--height','900')),settle:Number(arg('--settle','3000')),png:flag('--png'),menu:flag('--menu'),hud:arg('--hud','1')!=='0',gizmos:flag('--gizmos'),setup:arg('--setup','')};
const optionValues=new Set();for(let i=2;i<process.argv.length;i++)if(process.argv[i].startsWith('--')&&!['--png','--menu','--gizmos'].includes(process.argv[i]))optionValues.add(process.argv[i+1]);
const preJs=new Map(),shots=[];
for(const a of process.argv.slice(2)){
 if(a.startsWith('--')||optionValues.has(a))continue;
 if(a.startsWith('js:')){const eq=a.indexOf('=');preJs.set(a.slice(3,eq),a.slice(eq+1));continue;}
 const eq=a.indexOf('=');if(eq<0)continue;
 const name=a.slice(0,eq),[yaw,pitch,distance,wait,lock]=a.slice(eq+1).split(',').map(Number);
 shots.push({name,yaw:yaw||0,pitch:Number.isFinite(pitch)?pitch:.15,distance:distance||5.2,wait:wait||2500,lock:lock===1});
}
for(const shot of shots)if(preJs.has(shot.name))shot.js=preJs.get(shot.name);
if(!shots.length){console.error('no shots given (name=yawDeg,pitch,distance,waitMs[,lock])');process.exit(1);}
mkdirSync(OUT,{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let health;try{health=await (await fetch(SERVER+'/health')).json();}catch{console.error(`capture server not reachable at ${SERVER}. Start it with: node scripts/capture-server.mjs (and keep a worker tab open on http://127.0.0.1:5179/?capture-worker=1)`);process.exit(2);}
const {id}=await (await fetch(SERVER+'/job',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kind:'game',out:OUT,options,shots})})).json();
const t0=Date.now();let job;
for(;;){job=await (await fetch(`${SERVER}/job/${id}`)).json();if(job.status==='done'||job.status==='failed')break;if(Date.now()-t0>TIMEOUT){console.error(`timed out after ${TIMEOUT/1000}s waiting for job ${id} (status ${job.status}); is the worker tab open and alive?`);process.exit(3);}await sleep(500);}
const results=job.results.filter(Boolean);
for(const r of results)console.log(JSON.stringify(r));
writeFileSync(path.join(OUT,'captures.json'),JSON.stringify({server:SERVER,quality:options.quality,bridge:'worker-tab',results,errors:job.errors},null,1));
if(job.errors.length){console.log('page errors:');for(const e of job.errors)console.log(' -',String(e).slice(0,300));}
if(results.length<shots.length){console.error(`only ${results.length}/${shots.length} shots came back`);process.exit(4);}
