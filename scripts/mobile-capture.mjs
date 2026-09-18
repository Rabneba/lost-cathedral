// Play the game as a phone or a tablet in headless Chrome (device metrics, touch emulation, a mobile user agent) and
// drive the touch layer with real touch events over CDP, then screenshot. 17 Sep 2026, the mobile pass.
// Usage: node scripts/mobile-capture.mjs --out DIR [--device iphone|android|ipad|x-ios] [--landscape] [--dpr 3]
//        [--base http://127.0.0.1:5179] [--quality balanced] [--settle 2500] [--port 9345] [--force-touch] [--url URL]
//        steps...
//   Steps run in order: shot=name (screenshot) · wait=ms · stick=dx,dy,ms (hold the left stick deflected by dx,dy CSS px
//   for ms) · tap=attack|roll|guard|flask|lock|pause · hold=action,ms · look=dx,dy (one-finger drag on the right) ·
//   stickdown=dx,dy / stickup (the stick held across other steps) · press=action / release=action (a held button across other steps) · pinch=delta (two fingers, positive closes) ·
//   view=yawDeg,pitch,distance,lock · js=<expression> · state (print).
//   --url screenshots an arbitrary page (e.g. the hosted Genex page) after --settle ms instead of driving the game.
//   VESPER_QUERY (default '?genex_local_test=1') is appended to the game URL; --force-touch adds &touch=1 (otherwise the
//   run reports what device.js detected under emulation). Writes <out>/captures.json.
import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {chromeBinary} from './chrome-binary.mjs';

const arg=(name,fallback)=>{const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:fallback;};
const flag=name=>process.argv.includes(name);
const DEVICES={
 iphone:{width:390,height:844,dpr:3,platform:'iPhone',agent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'},
 // The X (Twitter) in-app browser on an iPhone: a WKWebView whose user agent carries no Safari token.
 'x-ios':{width:390,height:844,dpr:3,platform:'iPhone',agent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Twitter for iPhone/10.50'},
 android:{width:412,height:915,dpr:2.625,platform:'Linux armv8l',agent:'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Mobile Safari/537.36'},
 // iPadOS asks for desktop sites by default and calls itself a Mac; only its touch points and media queries give it away.
 ipad:{width:1024,height:768,dpr:2,platform:'MacIntel',agent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'},
};
const DEVICE=DEVICES[arg('--device','iphone')];if(!DEVICE){console.error('unknown device');process.exit(1);}
const LANDSCAPE=flag('--landscape');const WIDTH=LANDSCAPE?DEVICE.height:DEVICE.width,HEIGHT=LANDSCAPE?DEVICE.width:DEVICE.height,DPR=Number(arg('--dpr',DEVICE.dpr));
const QUERY=process.env.VESPER_QUERY??'?genex_local_test=1';const BASE=arg('--base','http://127.0.0.1:5179'),OUT=arg('--out','docs/mobile-captures'),PORT=Number(arg('--port','9345')),QUALITY=arg('--quality','balanced'),SETTLE=Number(arg('--settle','2500')),URL_ONLY=arg('--url',''),FORCE=flag('--force-touch');
const optionValues=new Set();for(let i=2;i<process.argv.length;i++)if(process.argv[i].startsWith('--')&&!['--landscape','--force-touch','--software','--real-dialog'].includes(process.argv[i]))optionValues.add(process.argv[i+1]);
const steps=process.argv.slice(2).filter(a=>!a.startsWith('--')&&!optionValues.has(a));
mkdirSync(OUT,{recursive:true});
const profile=path.join(tmpdir(),`vesper-mobile-${process.pid}`);
// --software: SwiftShader instead of the Mac GPU. Slow, but its fragment work is CPU time, so the renderMs it reports
// moves with shader cost the way a fill-rate-bound phone does; the Metal path's gl.finish() returns before the GPU is done.
const gpuFlags=flag('--software')?['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist'];
const chrome=spawn(chromeBinary(),['--headless=new',`--remote-debugging-port=${PORT}`,`--user-data-dir=${profile}`,'--no-first-run','--window-size=1280,1280',...gpuFlags,'--autoplay-policy=no-user-gesture-required','--mute-audio','about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function target(){for(let i=0;i<150;i++){try{const list=await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();const page=list.find(t=>t.type==='page');if(page)return page;}catch{}await sleep(200);}throw new Error('Chrome did not expose a page target');}
const page=await target(),ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
let nextId=1;const pending=new Map(),errors=[],logs=[];
ws.onmessage=({data})=>{const msg=JSON.parse(data);if(msg.id&&pending.has(msg.id)){const {resolve,reject}=pending.get(msg.id);pending.delete(msg.id);msg.error?reject(new Error(msg.error.message)):resolve(msg.result);}
 else if(msg.method==='Runtime.exceptionThrown')errors.push(msg.params.exceptionDetails.exception?.description||msg.params.exceptionDetails.text);
 else if(msg.method==='Runtime.consoleAPICalled'){const text=msg.params.args.map(a=>a.value??a.description).join(' ');if(msg.params.type==='error')errors.push(text);else if(msg.params.type==='info'||/Lost Cathedral|local test/i.test(text))logs.push(text);}};
const send=(method,params={})=>new Promise((resolve,reject)=>{const id=nextId++;const timer=setTimeout(()=>{if(pending.has(id)){pending.delete(id);reject(new Error(`CDP ${method} timed out after 60s`));}},60000);pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});ws.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};

async function emulate(){
 await send('Emulation.setUserAgentOverride',{userAgent:DEVICE.agent,platform:DEVICE.platform});
 await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
 await send('Emulation.setDeviceMetricsOverride',{width:WIDTH,height:HEIGHT,deviceScaleFactor:DPR,mobile:true,screenOrientation:LANDSCAPE?{type:'landscapePrimary',angle:90}:{type:'portraitPrimary',angle:0}});
}
// Touch primitives (CSS px of the emulated viewport). A finger is an id; several may be down at once.
const fingers=new Map();
const points=()=>[...fingers].map(([id,p])=>({id,x:p.x,y:p.y,radiusX:6,radiusY:6,force:1}));
async function down(id,x,y){fingers.set(id,{x,y});await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:points()});}
async function move(id,x,y){fingers.set(id,{x,y});await send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:points()});}
async function up(id){fingers.delete(id);await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:points()});}
async function centre(selector){const c=await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)return null;const r=el.getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2];})()`);if(!c)throw new Error(`no element ${selector}`);return c;}
async function tap(action,holdMs=60){const [x,y]=await centre(`button[data-action="${action}"]`);await down(9,x,y);await sleep(holdMs);await up(9);}
async function stick(dx,dy,ms){const x=WIDTH*.25,y=HEIGHT*.62;await down(1,x,y);for(let i=1;i<=6;i++){await move(1,x+dx*i/6,y+dy*i/6);await sleep(16);}await sleep(ms);await up(1);}
async function look(dx,dy){const x=WIDTH*.72,y=HEIGHT*.38;await down(2,x,y);for(let i=1;i<=10;i++){await move(2,x+dx*i/10,y+dy*i/10);await sleep(30);}await up(2);}
async function pinch(delta){const cx=WIDTH*.72,cy=HEIGHT*.4;let gap=90;await down(3,cx-gap/2,cy);await down(4,cx+gap/2,cy);for(let i=1;i<=10;i++){const g=90-delta*i/10;await move(3,cx-g/2,cy);await move(4,cx+g/2,cy);await sleep(30);}await up(3);await up(4);}
const state=()=>evaluate(`(()=>{const v=window.__vesper;if(!v)return{ready:false};const r=v.graphics.renderer;const rect=s=>{const el=document.querySelector(s);if(!el||el.hidden)return null;const b=el.getBoundingClientRect();return b.width?[Math.round(b.left),Math.round(b.top),Math.round(b.right),Math.round(b.bottom)]:null;};
 const boxes={bossBar:rect('.boss-vitals'),vitals:rect('.vitals'),attack:rect('.t-attack'),roll:rect('.t-roll'),guard:rect('.t-guard'),flask:rect('.t-flask'),lock:rect('.t-lock'),pause:rect('.t-pause'),notice:rect('#notice')};
 const overlaps=[];const hud=['bossBar','vitals'],btn=['attack','roll','guard','flask','lock','pause'];for(const a of hud)for(const b of btn){const A=boxes[a],B=boxes[b];if(A&&B&&A[0]<B[2]&&B[0]<A[2]&&A[1]<B[3]&&B[1]<A[3])overlaps.push(a+'/'+b);}
 return{ready:v.ready,touch:v.touch,layerVisible:!document.getElementById('touch').hidden,bodyTouch:document.body.classList.contains('touch'),status:v.fight.status,paused:v.paused,lock:v.lock,version:v.version,
  viewport:[innerWidth,innerHeight],dpr:devicePixelRatio,pixelRatio:r.getPixelRatio(),framebuffer:[r.domElement.width,r.domElement.height],fov:+v.graphics.camera.fov.toFixed(1),aspect:+v.graphics.camera.aspect.toFixed(3),
  ao:v.graphics.ao.enabled,bloom:v.graphics.bloom.enabled,quality:document.getElementById('quality').value,player:{x:+v.motion.player.x.toFixed(2),z:+v.motion.player.z.toFixed(2)},playerAction:v.fight.player.action?.name||null,hp:v.fight.player.health,stamina:Math.round(v.fight.player.stamina),blocking:v.fight.player.blocking,flasks:v.fight.player.flasks,
  stick:v.touchControls?{...v.touchControls.vector}:null,renderMs:(()=>{const gl=r.getContext();const t0=performance.now();for(let i=0;i<8;i++){v.graphics.render();gl.finish();}return +((performance.now()-t0)/8).toFixed(2);})(),lights:(()=>{const c={point:0,spot:0,spotShadow:0,dir:0,hemi:0,off:0};v.graphics.scene.traverse(o=>{if(!o.isLight)return;if(!o.visible||!o.parent?.visible){c.off++;return;}if(o.isPointLight)c.point++;else if(o.isSpotLight){c.spot++;if(o.castShadow)c.spotShadow++;}else if(o.isDirectionalLight)c.dir++;else if(o.isHemisphereLight)c.hemi++;});return c;})(),smaa:v.graphics.composer.passes.some(p=>p.constructor.name==='SMAAPass'&&p.enabled),heapMB:performance.memory?Math.round(performance.memory.usedJSHeapSize/1048576):null,textureMB:(()=>{const seen=new Set();let bytes=0;v.graphics.scene.traverse(o=>{const ms=Array.isArray(o.material)?o.material:o.material?[o.material]:[];for(const m of ms)for(const t of Object.values(m))if(t?.isTexture&&t.image&&!seen.has(t)){seen.add(t);const w=t.image.width||0,h=t.image.height||0;bytes+=w*h*4*(t.generateMipmaps?1.333:1);}});return Math.round(bytes/1048576);})(),textures:r.info.memory.textures,geometries:r.info.memory.geometries,fps:document.getElementById('telemetry').textContent.split('\\n')[0],calls:r.info.render.calls,triangles:r.info.render.triangles,boxes,overlaps,coarse:matchMedia('(pointer:coarse)').matches,hover:matchMedia('(hover:hover)').matches,maxTouchPoints:navigator.maxTouchPoints};})()`);
async function shot(name){const image=await send('Page.captureScreenshot',{format:'jpeg',quality:88});const file=path.join(OUT,`${name}.jpg`);writeFileSync(file,Buffer.from(image.data,'base64'));return file;}

const results=[];
try{
 await send('Runtime.enable');await send('Page.enable');await emulate();
 if(URL_ONLY){
  await send('Page.navigate',{url:URL_ONLY});await sleep(SETTLE);
  const file=await shot('page');const info=await evaluate(`(()=>({title:document.title,url:location.href,viewport:[innerWidth,innerHeight],iframes:[...document.querySelectorAll('iframe')].map(f=>{const r=f.getBoundingClientRect();return{src:f.src.slice(0,120),box:[Math.round(r.left),Math.round(r.top),Math.round(r.width),Math.round(r.height)]};}),canvases:document.querySelectorAll('canvas').length}))()`);
  results.push({file,...info});console.log(JSON.stringify(results[0]));
 }else{
  const url=BASE+'/'+QUERY+(FORCE?(QUERY?'&':'?')+'touch=1':'');
  await send('Page.navigate',{url});await sleep(1500);
  await evaluate(`localStorage.setItem('vesper.presentation.v1',JSON.stringify({quality:${JSON.stringify(QUALITY)},'show-stats':false}))`);
  await send('Page.navigate',{url});
  const t0=Date.now();while(!(await evaluate('!!window.__vesper&&window.__vesper.ready').catch(()=>false))){if(Date.now()-t0>240000)throw new Error('game did not become ready');await sleep(1000);}
  console.log(`ready after ${((Date.now()-t0)/1000).toFixed(1)}s`);
  if(!flag('--real-dialog'))await evaluate(`(()=>{HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};})()`);
  await evaluate(`document.getElementById('begin').click()`);await sleep(SETTLE);
  for(const step of steps){
   const eq=step.indexOf('=');const name=eq<0?step:step.slice(0,eq),value=eq<0?'':step.slice(eq+1);const nums=value.split(',').map(Number);
   if(name==='shot'){const file=await shot(value);const s=await state();results.push({step,file,...s});console.log(JSON.stringify({step,file,fps:s.fps,framebuffer:s.framebuffer,pixelRatio:s.pixelRatio,fov:s.fov,overlaps:s.overlaps,player:s.player,action:s.playerAction}));}
   else if(name==='wait')await sleep(nums[0]||500);
   else if(name==='stick')await stick(nums[0]||0,nums[1]||0,nums[2]||800);
   else if(name==='tap')await tap(value);
   else if(name==='hold'){const [action,ms]=value.split(',');await tap(action,Number(ms)||500);}
   else if(name==='stickdown'){const x=WIDTH*.25,y=HEIGHT*.62;await down(1,x,y);for(let i=1;i<=6;i++){await move(1,x+(nums[0]||0)*i/6,y+(nums[1]||0)*i/6);await sleep(16);}}
   else if(name==='stickup')await up(1);
   else if(name==='press'){const [x,y]=await centre(`button[data-action="${value}"]`);await down(9,x,y);}
   else if(name==='release')await up(9);
   else if(name==='look')await look(nums[0]||0,nums[1]||0);
   else if(name==='pinch')await pinch(nums[0]||0);
   else if(name==='view')await evaluate(`window.__vesper.setView({yaw:${(nums[0]||0)*Math.PI/180},pitch:${nums[1]??.15},distance:${nums[2]||5.2},lock:${nums[3]===1}})`);
   else if(name==='js')await evaluate(value);
   else if(name==='state'){const s=await state();results.push({step,...s});console.log(JSON.stringify(s));}
   else console.log('unknown step',step);
  }
 }
 writeFileSync(path.join(OUT,'captures.json'),JSON.stringify({device:arg('--device','iphone'),landscape:LANDSCAPE,viewport:[WIDTH,HEIGHT],dpr:DPR,quality:QUALITY,forceTouch:FORCE,results,logs,errors},null,1));
 if(logs.length){console.log('page logs:');for(const l of logs)console.log(' -',l.slice(0,200));}
 if(errors.length){console.log('page errors:');for(const e of errors)console.log(' -',e.slice(0,300));}
}finally{ws.close();chrome.kill();await sleep(300);try{rmSync(profile,{recursive:true,force:true});}catch{}}
