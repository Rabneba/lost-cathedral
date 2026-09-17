// Scripted roll playtest in headless Google Chrome over the DevTools protocol.
// Holds a real direction key, presses Space in the actual game page, and samples the
// player through window.__vesper: where the roll travelled, whether the body turned into
// it, and whether lock-on brought the facing back to the boss afterwards. Usage:
//   node scripts/roll-playtest.mjs [--url http://127.0.0.1:5179/] [--out docs/…/roll] [--port 9363]
import {spawn} from 'node:child_process';
import {mkdirSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {chromeBinary} from './chrome-binary.mjs';

const arg=(name,fallback)=>{const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:fallback;};
const URL_=arg('--url','http://127.0.0.1:5179/'),OUT=arg('--out','docs/overnight-2026-09-16/C-stills/roll-playtest'),PORT=Number(arg('--port','9363'));
const CHROME=chromeBinary();
mkdirSync(OUT,{recursive:true});
const profile=path.join(tmpdir(),`vesper-roll-${process.pid}`);
const chrome=spawn(CHROME,['--headless=new',`--remote-debugging-port=${PORT}`,`--user-data-dir=${profile}`,'--no-first-run','--window-size=1280,720','--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required','--mute-audio','about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function target(){for(let i=0;i<60;i++){try{const list=await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();const page=list.find(t=>t.type==='page');if(page)return page;}catch{}await sleep(200);}throw new Error('Chrome did not expose a page target');}
const page=await target();
const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
let nextId=1;const pending=new Map(),errors=[];
ws.onmessage=({data})=>{const msg=JSON.parse(data);if(msg.id&&pending.has(msg.id)){const {resolve,reject}=pending.get(msg.id);pending.delete(msg.id);msg.error?reject(new Error(msg.error.message)):resolve(msg.result);}
 else if(msg.method==='Runtime.exceptionThrown')errors.push(msg.params.exceptionDetails.exception?.description||msg.params.exceptionDetails.text);
 else if(msg.method==='Runtime.consoleAPICalled'&&msg.params.type==='error')errors.push(msg.params.args.map(a=>a.value??a.description).join(' '));};
// A Vite full reload mid-command drops the CDP reply; without a timeout the script waited forever and held the machine-wide capture lock.
const send=(method,params={})=>new Promise((resolve,reject)=>{const id=nextId++;const timer=setTimeout(()=>{if(pending.has(id)){pending.delete(id);reject(new Error(`CDP ${method} timed out after 60s`));}},60000);pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});ws.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
await send('Runtime.enable');await send('Page.enable');
await send('Page.navigate',{url:URL_});
await sleep(1500);await evaluate(`localStorage.setItem('vesper.presentation.v1',JSON.stringify({quality:'balanced','show-stats':false}))`);
await send('Page.navigate',{url:URL_});
const t0=Date.now();while(!(await evaluate('!!window.__vesper&&window.__vesper.ready').catch(()=>false))){if(Date.now()-t0>180000)throw new Error('game did not become ready');await sleep(1000);}
await evaluate(`document.getElementById('begin').click()`).catch(()=>{});await sleep(900);

const KEYS={KeyW:['w',87],KeyA:['a',65],KeyS:['s',83],KeyD:['d',68],Space:[' ',32]};
const key=(type,code)=>send('Input.dispatchKeyEvent',{type,code,key:KEYS[code][0],windowsVirtualKeyCode:KEYS[code][1],nativeVirtualKeyCode:KEYS[code][1],text:code==='Space'?' ':undefined});
const snapshot=()=>evaluate(`(()=>{const v=window.__vesper,p=v.motion.player,b=v.motion.boss,a=v.fight.player.action;return{t:v.fight.time,x:p.x,z:p.z,yaw:p.yaw,bx:b.x,bz:b.z,camYaw:v.view.yaw,lock:v.lock,action:a?a.name:null,elapsed:a?a.elapsed:0,clip:v.actors.player.animation.current,stamina:v.fight.player.stamina,health:v.fight.player.health};})()`);
const shot=async name=>{const image=await send('Page.captureScreenshot',{format:'jpeg',quality:80});writeFileSync(path.join(OUT,name),Buffer.from(image.data,'base64'));};
const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));

/** Other agents are editing the same checkout: Vite reloads the page underneath us. */
async function ensureFighting(){
 for(let attempt=0;attempt<90;attempt++){
  const state=await evaluate(`(()=>{const v=window.__vesper;return v&&v.ready?v.fight.status:null;})()`).catch(()=>null);
  if(state==='fighting')return;
  if(state==='ready'||state==='victory'||state==='defeat'){
   await evaluate(`(document.getElementById('begin').offsetParent?document.getElementById('begin'):document.getElementById('retry')).click()`).catch(()=>{});
   await sleep(900);continue;
  }
  await sleep(1000);
 }
 throw new Error('the page never came back to a running fight');
}

async function rollCase({label,codes,lock,forward=0,right=0}){
 await ensureFighting();
 // Park the duel far apart and full on stamina so every case starts identically.
 await evaluate(`(()=>{const v=window.__vesper;v.motion.player.x=0;v.motion.player.z=12;v.motion.player.yaw=Math.PI;v.motion.boss.x=0;v.motion.boss.z=-4;v.motion.dodge=null;v.fight.player.stamina=100;v.fight.player.health=100;v.fight.player.action=null;v.fight.boss.action=null;v.setView({yaw:0,pitch:.15,distance:5.2,lock:${lock}});})()`);
 await sleep(500);
 const before=await snapshot();
 for(const code of codes)await key('keyDown',code);
 await sleep(140);
 const held=await snapshot();
 await key('keyDown','Space');await key('keyUp','Space');
 const samples=[];
 for(let i=0;i<40;i++){samples.push(await snapshot());if(i===6)await shot(`${label}-mid.jpg`);await sleep(50);}
 for(const code of codes)await key('keyUp',code);
 await sleep(300);
 samples.push(await snapshot());
 const rolling=samples.filter(s=>s.action==='dodge');
 const start=rolling[0]??held,end=rolling.at(-1)??held;
 const after=samples.at(-1);
 // Expected world heading for the held direction at the camera yaw of the roll.
 const cameraYaw=start.camYaw,magnitude=Math.hypot(right,forward)||1;
 const ix=right/magnitude,iz=forward/magnitude;
 const expected={x:ix*Math.cos(cameraYaw)-iz*Math.sin(cameraYaw),z:-ix*Math.sin(cameraYaw)-iz*Math.cos(cameraYaw)};
 const travel={x:end.x-start.x,z:end.z-start.z},distance=Math.hypot(travel.x,travel.z);
 const along=distance>1e-6?(travel.x*expected.x+travel.z*expected.z)/distance:0;
 const heading=Math.atan2(expected.x,expected.z);
 const turnedBy=Math.abs(wrap(end.yaw-start.yaw));
 const headingError=codes.length?Math.abs(wrap(end.yaw-heading)):0;
 const toBoss=Math.atan2(after.bx-after.x,after.bz-after.z);
 const bossError=Math.abs(wrap(after.yaw-toBoss));
 const row={label,codes,lock,expected:[+expected.x.toFixed(3),+expected.z.toFixed(3)],
  rollFrames:rolling.length,travel:[+travel.x.toFixed(3),+travel.z.toFixed(3)],distance:+distance.toFixed(3),
  alongRequested:+along.toFixed(3),yawTurnedDeg:+(turnedBy*180/Math.PI).toFixed(1),
  headingErrorDeg:+(headingError*180/Math.PI).toFixed(1),facingBossAfterDeg:+(bossError*180/Math.PI).toFixed(1),
  hit:after.health<100,clipAfter:after.clip,
  // How long lock-on took to swing the body back: a turn, not a snap.
  returnSeconds:(()=>{if(!lock||!rolling.length)return null;const last=rolling.at(-1);
   const back=samples.find(s=>s.t>last.t&&Math.abs(wrap(s.yaw-Math.atan2(s.bx-s.x,s.bz-s.z)))<.05);
   return back?+(back.t-last.t).toFixed(2):null;})(),
  // The turn into the roll should be over inside about 0.15 s.
  turnedInDeg:(()=>{const early=rolling.find(s=>s.elapsed>=.15);return early?+(Math.abs(wrap(early.yaw-heading))*180/Math.PI).toFixed(1):null;})()};
 const checks=[];
 if(codes.length){
  checks.push(['travels where the stick points',along>.9]);
  checks.push(['turns into the roll within 0.15 s',row.turnedInDeg!==null&&row.turnedInDeg<6]);
 }else checks.push(['keeps the pre-roll facing',turnedBy<.05]);
 checks.push(['covers the authored roll distance',distance>2.2&&distance<3.2]);
 if(lock)checks.push(['faces the boss again afterwards',bossError<.12]);
 row.checks=checks.map(([name,ok])=>({name,ok}));
 row.passed=checks.every(([,ok])=>ok);
 results.push(row);console.log(JSON.stringify(row));
 return row;
}
const results=[];
await rollCase({label:'lock-left',codes:['KeyA'],lock:true,right:-1});
await rollCase({label:'lock-right',codes:['KeyD'],lock:true,right:1});
await rollCase({label:'lock-back',codes:['KeyS'],lock:true,forward:-1});
await rollCase({label:'lock-forward',codes:['KeyW'],lock:true,forward:1});
await rollCase({label:'lock-forward-left',codes:['KeyW','KeyA'],lock:true,forward:1,right:-1});
await rollCase({label:'lock-none',codes:[],lock:true});
await rollCase({label:'free-left',codes:['KeyA'],lock:false,right:-1});
await rollCase({label:'free-back',codes:['KeyS'],lock:false,forward:-1});
const failed=results.filter(row=>!row.passed);
writeFileSync(path.join(OUT,'roll-playtest.json'),JSON.stringify({url:URL_,results,errors},null,1));
console.log(`\n${results.length-failed.length}/${results.length} cases passed · page errors ${errors.length}`);
for(const row of failed)console.log(' FAIL',row.label,row.checks.filter(c=>!c.ok).map(c=>c.name).join(', '));
for(const e of errors)console.log(' -',e.slice(0,300));
ws.close();chrome.kill();
if(failed.length||errors.length)process.exitCode=1;
