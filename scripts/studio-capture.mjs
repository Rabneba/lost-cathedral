// Capture stills of the animation studio in headless Google Chrome for review docs.
// Usage: node scripts/studio-capture.mjs --out docs/dir shot=character,clip,time,view[,facing] ...
//   e.g. node scripts/studio-capture.mjs --out docs/player-stance idle-side=player,idle,1,side,1
// Each shot becomes <out>/<name>.jpg. Requires the dev server (default http://127.0.0.1:5179).
import {spawn} from 'node:child_process';
import {mkdirSync, writeFileSync, rmSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {chromeBinary} from './chrome-binary.mjs';

const arg=(name,fallback)=>{const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:fallback;};
const BASE=arg('--base','http://127.0.0.1:5179'),OUT=arg('--out','docs/studio-captures'),PORT=Number(arg('--port','9335')),WIDTH=Number(arg('--width','1400')),HEIGHT=Number(arg('--height','900'));
const shots=process.argv.slice(2).filter(a=>a.includes('=')&&!a.startsWith('--')).map(a=>{const [name,spec]=a.split('=');const [character,clip,time,view,facing,weapons]=spec.split(',');return{name,character,clip,time,view,facing,weapons};});
if(!shots.length){console.error('no shots given');process.exit(1);}
mkdirSync(OUT,{recursive:true});
const profile=path.join(tmpdir(),`vesper-studio-${process.pid}`);
// Shared with game-capture.mjs: one headless Chrome capture at a time on this machine.
const LOCK=path.join(tmpdir(),'vesper-capture.lock');
async function acquireLock(){for(let i=0;i<900;i++){try{mkdirSync(LOCK);writeFileSync(path.join(LOCK,'owner'),String(process.pid));return;}catch{try{if(Date.now()-statSync(LOCK).mtimeMs>12*60*1000)rmSync(LOCK,{recursive:true,force:true});}catch{}await new Promise(r=>setTimeout(r,2000));}}throw new Error('could not acquire the capture lock');}
const releaseLock=()=>{try{rmSync(LOCK,{recursive:true,force:true});}catch{}};
await acquireLock();process.on('exit',releaseLock);
const chrome=spawn(chromeBinary(),['--headless=new',`--remote-debugging-port=${PORT}`,`--user-data-dir=${profile}`,'--no-first-run',`--window-size=${WIDTH},${HEIGHT}`,'--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function target(){for(let i=0;i<50;i++){try{const list=await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();const page=list.find(t=>t.type==='page');if(page)return page;}catch{}await sleep(200);}throw new Error('Chrome did not expose a page target');}
const page=await target(),ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
let nextId=1;const pending=new Map(),errors=[];
ws.onmessage=({data})=>{const msg=JSON.parse(data);if(msg.id&&pending.has(msg.id)){const {resolve,reject}=pending.get(msg.id);pending.delete(msg.id);msg.error?reject(new Error(msg.error.message)):resolve(msg.result);}
 else if(msg.method==='Runtime.exceptionThrown')errors.push(msg.params.exceptionDetails.exception?.description||msg.params.exceptionDetails.text);
 else if(msg.method==='Runtime.consoleAPICalled'&&msg.params.type==='error')errors.push(msg.params.args.map(a=>a.value??a.description).join(' '));};
// A Vite full reload mid-command drops the CDP reply; without a timeout the script waited forever and held the machine-wide capture lock.
const send=(method,params={})=>new Promise((resolve,reject)=>{const id=nextId++;const timer=setTimeout(()=>{if(pending.has(id)){pending.delete(id);reject(new Error(`CDP ${method} timed out after 60s`));}},60000);pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});ws.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
await send('Runtime.enable');await send('Page.enable');
const results=[];
for(const shot of shots){
 const params=new URLSearchParams({character:shot.character,clip:shot.clip,time:shot.time,view:shot.view||'side'});if(shot.facing==='1')params.set('facing','1');if(shot.weapons==='0')params.set('weapons','0');
 // --extra "playerRig=...&playerManifest=..." reviews a candidate bundle instead of the game's rig.
 for(const [k,v] of new URLSearchParams(arg('--extra','')))params.set(k,v);
 await send('Page.navigate',{url:`${BASE}/animation-review.html?${params}`});
 const t0=Date.now();while(!(await evaluate(`!document.getElementById('loading')||document.getElementById('loading').hidden`).catch(()=>false))){if(Date.now()-t0>180000)throw new Error('studio did not load');await sleep(500);}
 await sleep(1500);// two frames of the paused render at SwiftShader speed
 const readout=await evaluate(`(()=>{const r=document.getElementById('facing-readout');return {readout:r&&!r.hidden?r.textContent:null,stage:document.getElementById('stage-animation')?.textContent,time:document.getElementById('timeline')?.value};})()`);
 const image=await send('Page.captureScreenshot',{format:'jpeg',quality:82});
 const file=path.join(OUT,`${shot.name}.jpg`);writeFileSync(file,Buffer.from(image.data,'base64'));
 results.push({...shot,file,...readout});console.log(JSON.stringify(results.at(-1)));
}
writeFileSync(path.join(OUT,'captures.json'),JSON.stringify({base:BASE,results,errors},null,1));
if(errors.length){console.log('page errors:');for(const e of errors)console.log(' -',e.slice(0,300));}
ws.close();chrome.kill();await new Promise(r=>setTimeout(r,300));try{rmSync(profile,{recursive:true,force:true});}catch{}releaseLock();
