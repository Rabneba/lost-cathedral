// Capture stills of the actual game (index.html) in headless Google Chrome for visual review.
// Usage: node scripts/game-capture.mjs --out DIR [--base http://127.0.0.1:5179] [--quality high|balanced|low]
//        [--width 1600] [--height 900] [--settle 3000] [--software] [--png] [--menu] [--hud 0] [--port 9336]
//        [--setup "<js evaluated once after the fight starts>"] shot=yawDeg,pitch,distance,waitMs[,lock] ...
//   Renders on the Mac GPU (Metal) by default (~60 fps headless); --software uses SwiftShader (~1 fps at high).
//   Each shot may be preceded by js:<name>=<expression> evaluated in the page before that shot's wait
//   (window.__vesper exposes fight, motion, actors, effects, arena, graphics, keys, request(name), setView(), lock).
//   e.g. node scripts/game-capture.mjs --out docs/overnight/stills nave=180,.15,5.2,2500 altar=0,.3,7,2500
//   yawDeg is the orbit yaw in degrees (0 = camera behind a player who faces -Z, looking at the boss;
//   180 = looking back toward the entrance at +Z), pitch in [-.08,.6], distance in metres [2,12];
//   lock=1 keeps the lock-on camera (yaw is then driven toward the boss), default 0 = free camera.
//   Use a different --port per concurrent run. Writes <out>/captures.json with per-shot state and page errors.
import {spawn} from 'node:child_process';
import {mkdirSync, writeFileSync, rmSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {chromeBinary} from './chrome-binary.mjs';

const arg=(name,fallback)=>{const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:fallback;};
const flag=name=>process.argv.includes(name);
// VESPER_QUERY: a query string appended to the page URL, e.g. '?genex_local_test=1' for the Genex embed SDK's local test mode (17 Sep 2026).
const QUERY=process.env.VESPER_QUERY||'';const BASE=arg('--base','http://127.0.0.1:5179'),OUT=arg('--out','docs/game-captures'),PORT=Number(arg('--port','9336')),WIDTH=Number(arg('--width','1600')),HEIGHT=Number(arg('--height','900')),QUALITY=arg('--quality','high'),SETTLE=Number(arg('--settle','3000')),PNG=flag('--png'),MENU=flag('--menu'),HUD=arg('--hud','1')!=='0',SETUP=arg('--setup',''),GPU=!flag('--software');
const optionValues=new Set();for(let i=2;i<process.argv.length;i++)if(process.argv[i].startsWith('--')&&!['--software','--png','--menu'].includes(process.argv[i]))optionValues.add(process.argv[i+1]);
const preJs=new Map();const shots=[];
for(const a of process.argv.slice(2)){
 if(a.startsWith('--')||optionValues.has(a))continue;
 if(a.startsWith('js:')){const eq=a.indexOf('=');preJs.set(a.slice(3,eq),a.slice(eq+1));continue;}
 const eq=a.indexOf('=');if(eq<0)continue;
 const name=a.slice(0,eq),[yaw,pitch,distance,wait,lock]=a.slice(eq+1).split(',').map(Number);
 shots.push({name,yaw:yaw||0,pitch:Number.isFinite(pitch)?pitch:.15,distance:distance||5.2,wait:wait||2500,lock:lock===1});
}
if(!shots.length){console.error('no shots given (name=yawDeg,pitch,distance,waitMs[,lock])');process.exit(1);}
mkdirSync(OUT,{recursive:true});
const profile=path.join(tmpdir(),`vesper-game-${process.pid}`);
// One GPU capture at a time across every agent on this machine: six parallel headless
// Chromes at high quality returned black frames and 3 fps. mkdir is atomic; a lock older
// than 12 minutes belongs to a dead run and is taken over.
const LOCK=path.join(tmpdir(),'vesper-capture.lock');
async function acquireLock(){for(let i=0;i<900;i++){try{mkdirSync(LOCK);writeFileSync(path.join(LOCK,'owner'),String(process.pid));return;}catch{try{if(Date.now()-statSync(LOCK).mtimeMs>12*60*1000)rmSync(LOCK,{recursive:true,force:true});}catch{}await new Promise(r=>setTimeout(r,2000));}}throw new Error('could not acquire the capture lock');}
const releaseLock=()=>{try{rmSync(LOCK,{recursive:true,force:true});}catch{}};
await acquireLock();
// VESPER_ANGLE=metal (default) | gl | default (no flag: the browser's own backend choice, i.e. what the user's Chrome does).
const angle=process.env.VESPER_ANGLE||'metal';const gpuFlags=GPU?[...(angle==='default'?[]:[`--use-angle=${angle}`]),'--enable-gpu','--ignore-gpu-blocklist']:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'];
const chrome=spawn(chromeBinary(),['--headless=new',`--remote-debugging-port=${PORT}`,`--user-data-dir=${profile}`,'--no-first-run',`--window-size=${WIDTH},${HEIGHT}`,...gpuFlags,'--autoplay-policy=no-user-gesture-required','--mute-audio',...(process.env.VESPER_CHROME_FLAGS||'').split(' ').filter(Boolean),'about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function target(){for(let i=0;i<150;i++){try{const list=await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();const page=list.find(t=>t.type==='page');if(page)return page;}catch{}await sleep(200);}throw new Error('Chrome did not expose a page target');}
process.on('exit',releaseLock);
const page=await target(),ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
let nextId=1;const pending=new Map(),errors=[];
ws.onmessage=({data})=>{const msg=JSON.parse(data);if(msg.id&&pending.has(msg.id)){const {resolve,reject}=pending.get(msg.id);pending.delete(msg.id);msg.error?reject(new Error(msg.error.message)):resolve(msg.result);}
 else if(msg.method==='Runtime.exceptionThrown')errors.push(msg.params.exceptionDetails.exception?.description||msg.params.exceptionDetails.text);
 else if(msg.method==='Runtime.consoleAPICalled'&&msg.params.type==='error')errors.push(msg.params.args.map(a=>a.value??a.description).join(' '));};
// A Vite full reload mid-command drops the CDP reply; without a timeout the script waited forever and held the machine-wide capture lock.
const send=(method,params={})=>new Promise((resolve,reject)=>{const id=nextId++;const timer=setTimeout(()=>{if(pending.has(id)){pending.delete(id);reject(new Error(`CDP ${method} timed out after 60s`));}},60000);pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});ws.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
async function prepare(){
 await send('Page.navigate',{url:BASE+'/'+QUERY});await sleep(1200);
 await evaluate(`localStorage.setItem('vesper.presentation.v1',JSON.stringify({quality:${JSON.stringify(QUALITY)},'show-stats':false}))`);
 await send('Page.navigate',{url:BASE+'/'+QUERY});
 const t0=Date.now();while(!(await evaluate('!!window.__vesper&&window.__vesper.ready').catch(()=>false))){if(Date.now()-t0>240000)throw new Error('game did not become ready');await sleep(1000);}
 console.log(`ready after ${((Date.now()-t0)/1000).toFixed(1)}s`);
 // Keep the page from pausing itself when the headless window is not focused.
 await evaluate(`(()=>{HTMLDialogElement.prototype.showModal=function(){};})()`);
 if(!MENU){await evaluate(`document.getElementById('begin').click()`);await sleep(600);}
 if(!HUD)await evaluate(`for(const id of ['hud','notice'])document.getElementById(id).style.visibility='hidden'`);
 if(SETUP)await evaluate(SETUP);
 await sleep(SETTLE);
}
async function capture(shot){
 if(preJs.has(shot.name))await evaluate(preJs.get(shot.name));
 if(!MENU)await evaluate(`window.__vesper.setView({yaw:${shot.yaw*Math.PI/180},pitch:${shot.pitch},distance:${shot.distance},lock:${shot.lock}})`);
 await sleep(shot.wait);
 const state=await evaluate(`(()=>{const v=window.__vesper;return{status:v.fight.status,view:v.view,player:{x:v.motion.player.x,z:v.motion.player.z,yaw:v.motion.player.yaw},boss:{x:v.motion.boss.x,z:v.motion.boss.z},bossAction:v.fight.boss.action?.name||null,playerAction:v.fight.player.action?.name||null,calls:v.graphics.renderer.info.render.calls,triangles:v.graphics.renderer.info.render.triangles,fps:document.getElementById('telemetry').textContent.split('\\n')[0]};})()`);
 const image=await send('Page.captureScreenshot',PNG?{format:'png'}:{format:'jpeg',quality:88});
 const file=path.join(OUT,`${shot.name}.${PNG?'png':'jpg'}`);writeFileSync(file,Buffer.from(image.data,'base64'));
 return {...shot,file,...state};
}
try{
 await send('Runtime.enable');await send('Page.enable');
 await prepare();
 const results=[];
 for(const shot of shots){
  let result;
  // A dev-server reload (someone else's edit) mid-capture drops window.__vesper; re-enter the fight once and retry.
  try{result=await capture(shot);}catch(error){console.log(`retrying ${shot.name}: ${error.message.slice(0,120)}`);errors.length=0;await prepare();result=await capture(shot);}
  results.push(result);console.log(JSON.stringify(result));
 }
 writeFileSync(path.join(OUT,'captures.json'),JSON.stringify({base:BASE,quality:QUALITY,gpu:GPU,results,errors},null,1));
 if(errors.length){console.log('page errors:');for(const e of errors)console.log(' -',e.slice(0,300));}
}finally{ws.close();chrome.kill();await new Promise(r=>setTimeout(r,300));try{rmSync(profile,{recursive:true,force:true});}catch{}releaseLock();}
