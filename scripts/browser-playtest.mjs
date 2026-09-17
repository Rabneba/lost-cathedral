// Scripted movement playtest in headless Google Chrome over the DevTools protocol.
// Holds real WASD key events in the actual game page and measures the player through
// window.__vesper (src/game/main.js). Usage:
//   node scripts/browser-playtest.mjs [--url http://127.0.0.1:5179/] [--out docs/browser-playtest] [--hold 1200]
import {spawn} from 'node:child_process';
import {mkdirSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {chromeBinary} from './chrome-binary.mjs';

const arg=(name,fallback)=>{const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:fallback;};
const URL_=arg('--url','http://127.0.0.1:5179/'),OUT=arg('--out','docs/browser-playtest'),HOLD=Number(arg('--hold','1200')),PORT=9334;
const CHROME=chromeBinary();
mkdirSync(OUT,{recursive:true});
const profile=path.join(tmpdir(),`vesper-playtest-${process.pid}`);
const chrome=spawn(CHROME,['--headless=new',`--remote-debugging-port=${PORT}`,`--user-data-dir=${profile}`,'--no-first-run','--window-size=1280,720','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required','about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function target(){for(let i=0;i<50;i++){try{const list=await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();const page=list.find(t=>t.type==='page');if(page)return page;}catch{}await sleep(200);}throw new Error('Chrome did not expose a page target');}
const page=await target();
const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
let nextId=1;const pending=new Map();const errors=[],events=[];
ws.onmessage=({data})=>{const msg=JSON.parse(data);if(msg.id&&pending.has(msg.id)){const {resolve,reject}=pending.get(msg.id);pending.delete(msg.id);msg.error?reject(new Error(msg.error.message)):resolve(msg.result);}
 else if(msg.method==='Runtime.exceptionThrown')errors.push(msg.params.exceptionDetails.exception?.description||msg.params.exceptionDetails.text);
 else if(msg.method==='Runtime.consoleAPICalled'&&msg.params.type==='error')errors.push(msg.params.args.map(a=>a.value??a.description).join(' '));
 else if(msg.method==='Runtime.consoleAPICalled'&&msg.params.type==='warning')events.push(msg.params.args.map(a=>a.value??a.description).join(' '));};
// A Vite full reload mid-command drops the CDP reply; without a timeout the script waited forever and held the machine-wide capture lock.
const send=(method,params={})=>new Promise((resolve,reject)=>{const id=nextId++;const timer=setTimeout(()=>{if(pending.has(id)){pending.delete(id);reject(new Error(`CDP ${method} timed out after 60s`));}},60000);pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});ws.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
await send('Runtime.enable');await send('Page.enable');
await send('Page.navigate',{url:URL_});
// Low graphics keeps SwiftShader frame times short enough for a meaningful dt.
await sleep(1500);await evaluate(`localStorage.setItem(${JSON.stringify(arg('--prefs-key','vesper.presentation.v1'))},JSON.stringify({quality:'low','show-stats':true}))`);
await send('Page.navigate',{url:URL_});
const t0=Date.now();while(!(await evaluate('!!window.__vesper&&window.__vesper.ready').catch(()=>false))){if(Date.now()-t0>180000)throw new Error('game did not become ready');await sleep(1000);}
console.log(`ready after ${((Date.now()-t0)/1000).toFixed(1)}s`);
// Trace anything that pauses the encounter: the pause dialog, window blur, tab visibility.
await evaluate(`(()=>{const orig=HTMLDialogElement.prototype.showModal;HTMLDialogElement.prototype.showModal=function(){console.warn('[playtest] showModal via '+new Error().stack.split('\\n').slice(2,5).join(' | '));return orig.call(this);};addEventListener('blur',()=>console.warn('[playtest] window blur'));document.addEventListener('visibilitychange',()=>console.warn('[playtest] visibility '+document.visibilityState));})()`);
await evaluate(`document.getElementById('begin').click()`);await sleep(800);
const snapshot=()=>evaluate(`(()=>{const v=window.__vesper,p=v.actors.player;return{status:v.fight.status,time:v.fight.time,x:v.motion.player.x,z:v.motion.player.z,yaw:v.motion.player.yaw,keys:[...v.keys],lock:v.lock,paused:v.paused,moving:p.moving,direction:p.moveDirection,clip:p.animation.current,speed:p.speed,bossDistance:v.motion.geometry().distance,telemetry:document.getElementById('telemetry').textContent};})()`);
const KEYS={KeyW:['w',87],KeyA:['a',65],KeyS:['s',83],KeyD:['d',68],KeyQ:['q',81]};
const key=(type,code)=>send('Input.dispatchKeyEvent',{type,code,key:KEYS[code][0],windowsVirtualKeyCode:KEYS[code][1],nativeVirtualKeyCode:KEYS[code][1]});
async function screenshot(name){const shot=await send('Page.captureScreenshot',{format:'jpeg',quality:70});writeFileSync(path.join(OUT,name),Buffer.from(shot.data,'base64'));}
const results=[];
async function hold(label,codes){let before=await snapshot();if(before.paused){events.push(`[playtest] ${label}: game was paused before the hold; resumed`);await evaluate(`document.getElementById('resume').click()`);await sleep(300);before=await snapshot();}for(const c of codes)await key('keyDown',c);await sleep(HOLD*.6);const mid=await snapshot();await screenshot(`${label}.jpg`);await sleep(HOLD*.4);for(const c of codes)await key('keyUp',c);const after=await snapshot();await sleep(400);const settled=await snapshot();
 const dx=after.x-before.x,dz=after.z-before.z,local=(()=>{const c=Math.cos(-before.yaw),s=Math.sin(-before.yaw);return{x:dx*c-dz*s,z:dx*s+dz*c};})();
 const row={label,codes,keysDuringHold:mid.keys,lock:mid.lock,pausedMid:mid.paused,gameSeconds:+(after.time-before.time).toFixed(2),dx:+dx.toFixed(2),dz:+dz.toFixed(2),distance:+Math.hypot(dx,dz).toFixed(2),localX:+local.x.toFixed(2),localZ:+local.z.toFixed(2),yawBefore:+(before.yaw*180/Math.PI).toFixed(0),yawAfter:+(after.yaw*180/Math.PI).toFixed(0),movingMid:mid.moving,directionMid:mid.direction,clipMid:mid.clip,speedMid:+mid.speed.toFixed(2),keysAfterRelease:after.keys,movingSettled:settled.moving,clipSettled:settled.clip,bossDistance:+after.bossDistance.toFixed(2)};
 results.push(row);console.log(JSON.stringify(row));}
console.log('initial',JSON.stringify(await snapshot()));
await hold('lock-forward',['KeyW']);await hold('lock-left',['KeyA']);await hold('lock-back',['KeyS']);await hold('lock-right',['KeyD']);await hold('lock-forward-left',['KeyW','KeyA']);await hold('lock-forward-right',['KeyW','KeyD']);
await key('keyDown','KeyQ');await key('keyUp','KeyQ');await sleep(300);
await hold('free-forward',['KeyW']);await hold('free-left',['KeyA']);await hold('free-back',['KeyS']);await hold('free-right',['KeyD']);await hold('free-forward-left',['KeyW','KeyA']);
const final=await snapshot();console.log('final',JSON.stringify(final));
writeFileSync(path.join(OUT,'movement-playtest.json'),JSON.stringify({url:URL_,holdMs:HOLD,results,events,errors,final},null,1));
console.log('events:');for(const e of events)console.log(' *',e.slice(0,300));console.log(`page errors: ${errors.length}`);for(const e of errors)console.log(' -',e.slice(0,300));
ws.close();chrome.kill();
