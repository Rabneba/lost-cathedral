// Frame profiler for the live game in headless Chrome on the Mac GPU (Metal).
// Usage: node scripts/profile-frame.mjs [--base http://127.0.0.1:5179] [--width 1600] [--height 900]
//        [--frames 120] [--port 9338] [--quality high] [--out file.json]
// Reports wall FPS, per-pass GPU-synchronised cost (gl.finish at each pass boundary), CPU cost
// of each update subsystem, draw calls per pass, lights, shadow maps and program counts.
import {spawn} from 'node:child_process';
import {mkdirSync, writeFileSync, rmSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {chromeBinary} from './chrome-binary.mjs';
import {readFileSync} from 'node:fs';
const require_toggles=()=>readFileSync(TOGGLES,'utf8');

const arg=(name,fallback)=>{const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:fallback;};
const BASE=arg('--base','http://127.0.0.1:5179'),PORT=Number(arg('--port','9338')),WIDTH=Number(arg('--width','1600')),HEIGHT=Number(arg('--height','900')),FRAMES=Number(arg('--frames','120')),QUALITY=arg('--quality','high'),OUT=arg('--out','');
const profile=path.join(tmpdir(),`vesper-profile-${process.pid}`);
// VESPER_ANGLE=metal (default) | gl | swiftshader | default (no flag: the browser's own choice, i.e. what the user's Chrome does).
const angleFlags=()=>{const a=process.env.VESPER_ANGLE||'metal';return a==='default'?[]:[`--use-angle=${a}`];};
const LOCK=path.join(tmpdir(),'vesper-capture.lock');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function acquireLock(){for(let i=0;i<900;i++){try{mkdirSync(LOCK);writeFileSync(path.join(LOCK,'owner'),String(process.pid));return;}catch{try{if(Date.now()-statSync(LOCK).mtimeMs>12*60*1000)rmSync(LOCK,{recursive:true,force:true});}catch{}await sleep(2000);}}throw new Error('could not acquire the capture lock');}
const releaseLock=()=>{try{rmSync(LOCK,{recursive:true,force:true});}catch{}};
await acquireLock();process.on('exit',releaseLock);
const chrome=spawn(chromeBinary(),['--headless=new',`--remote-debugging-port=${PORT}`,`--user-data-dir=${profile}`,'--no-first-run',`--window-size=${WIDTH},${HEIGHT}`,...angleFlags(),'--enable-gpu','--ignore-gpu-blocklist','--mute-audio',...(process.env.VESPER_CHROME_FLAGS||'').split(' ').filter(Boolean),'--disable-gpu-vsync','--disable-frame-rate-limit','about:blank'],{stdio:'ignore'});
async function target(){for(let i=0;i<150;i++){try{const list=await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();const page=list.find(t=>t.type==='page');if(page)return page;}catch{}await sleep(200);}throw new Error('no page target');}
const page=await target(),ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
let nextId=1;const pending=new Map(),errors=[];
ws.onmessage=({data})=>{const msg=JSON.parse(data);if(msg.id&&pending.has(msg.id)){const {resolve,reject}=pending.get(msg.id);pending.delete(msg.id);msg.error?reject(new Error(msg.error.message)):resolve(msg.result);}else if(msg.method==='Runtime.exceptionThrown')errors.push(msg.params.exceptionDetails.exception?.description||msg.params.exceptionDetails.text);};
const send=(method,params={})=>new Promise((resolve,reject)=>{const id=nextId++;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));setTimeout(()=>{if(pending.has(id)){pending.delete(id);reject(new Error(method+' timed out'));}},900000);});
const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
const PROBE=`(async()=>{
 const v=window.__vesper,g=v.graphics,r=g.renderer,gl=r.getContext(),scene=g.scene;
 const wait=ms=>new Promise(res=>setTimeout(res,ms));
 // 1) plain wall-clock fps over ~3 s, no instrumentation
 const wall=await new Promise(res=>{const t=[];let last=performance.now();const tick=now=>{t.push(now-last);last=now;if(t.length<${FRAMES})requestAnimationFrame(tick);else res(t);};requestAnimationFrame(tick);});
 const sorted=[...wall].sort((a,b)=>a-b),mean=wall.reduce((a,b)=>a+b,0)/wall.length;
 // 2) inventory
 const lights=[],meshes={total:0,visible:0,castShadow:0,skinned:0,instanced:0,frustumOff:0,transparent:0};const materials=new Set(),geometries=new Set();let tris=0;
 scene.traverse(o=>{if(o.isLight)lights.push({type:o.type,name:o.name||o.parent?.name||'',intensity:+o.intensity.toFixed?.(2),shadow:!!o.castShadow,map:o.castShadow?o.shadow.mapSize.x:0,visible:o.visible,autoUpdate:o.castShadow?o.shadow.autoUpdate:null});
  if(o.isMesh){meshes.total++;if(o.visible)meshes.visible++;if(o.castShadow)meshes.castShadow++;if(o.isSkinnedMesh)meshes.skinned++;if(o.isInstancedMesh)meshes.instanced++;if(!o.frustumCulled)meshes.frustumOff++;const ms=Array.isArray(o.material)?o.material:[o.material];ms.forEach(m=>{materials.add(m);if(m.transparent)meshes.transparent++;});geometries.add(o.geometry);}});
 // 3) per-pass GPU-synchronised timing
 const passT={},passCalls={};
 g.composer.passes.forEach((p,i)=>{const name=i+':'+p.constructor.name+(p.enabled?'':'(off)');const orig=p.render.bind(p);p.render=(...a)=>{gl.finish();const c0=r.info.render.calls;const t0=performance.now();orig(...a);gl.finish();passT[name]=(passT[name]||0)+performance.now()-t0;passCalls[name]=(passCalls[name]||0)+r.info.render.calls-c0;};});
 // shadow map and the reflector are rendered inside RenderPass: time them separately
 const sm=r.shadowMap,smOrig=sm.render.bind(sm);let smT=0,smN=0;sm.render=(...a)=>{gl.finish();const c0=r.info.render.calls;const t0=performance.now();smOrig(...a);gl.finish();smT+=performance.now()-t0;smN+=r.info.render.calls-c0;};
 const refl=[];scene.traverse(o=>{if(o.isReflector||o.onBeforeRender&&o.onBeforeRender.toString().includes('virtualCamera'))refl.push(o);});
 let rfT=0,rfN=0;refl.forEach(o=>{const ob=o.onBeforeRender.bind(o);o.onBeforeRender=(...a)=>{gl.finish();const c0=r.info.render.calls;const t0=performance.now();ob(...a);gl.finish();rfT+=performance.now()-t0;rfN+=r.info.render.calls-c0;};});
 // CPU subsystems
 const cpu={};const wrap=(obj,key,label)=>{if(!obj||typeof obj[key]!=='function')return;const f=obj[key].bind(obj);obj[key]=(...a)=>{const t0=performance.now();const out=f(...a);cpu[label]=(cpu[label]||0)+performance.now()-t0;return out;};};
 wrap(v.actors.player,'update','player.update');wrap(v.actors.boss,'update','boss.update');wrap(v.arena,'update','arena.update');wrap(v.effects,'update','effects.update');wrap(v.motion,'step','motion.step');wrap(v.fight,'step','fight.step');wrap(g.puddles,'update','puddles.update');if(v.combat)wrap(v.combat,'update','combat.update');
 const rOrig=g.render;let renderCpu=0;
 const N=60;const frameT=[];
 await new Promise(res=>{let n=0,last=performance.now();const tick=now=>{frameT.push(now-last);last=now;if(++n<N)requestAnimationFrame(tick);else res();};requestAnimationFrame(tick);});
 const per=o=>Object.fromEntries(Object.entries(o).map(([k,x])=>[k,+(x/N).toFixed(2)]));
 const info=r.info;
 return{size:[r.domElement.width,r.domElement.height],pixelRatio:r.getPixelRatio(),fps:+(1000/mean).toFixed(1),p50:+sorted[Math.floor(sorted.length*.5)].toFixed(1),p95:+sorted[Math.floor(sorted.length*.95)].toFixed(1),
  instrumentedFrameMs:+(frameT.reduce((a,b)=>a+b,0)/N).toFixed(1),passMs:per(passT),passCalls:per(passCalls),shadowMs:+(smT/N).toFixed(2),shadowCalls:+(smN/N).toFixed(0),reflectors:refl.length,reflectorMs:+(rfT/N).toFixed(2),reflectorCalls:+(rfN/N).toFixed(0),cpuMs:per(cpu),
  totals:{calls:info.render.calls,triangles:info.render.triangles,programs:info.programs?.length,textures:info.memory.textures,geometries:info.memory.geometries},meshes,materials:materials.size,uniqueGeometries:geometries.size,lights};
})()`;
// --toggles FILE: a JS object literal {name:[onCode,offCode]} measured against interleaved baselines.
const TOGGLES=arg('--toggles','');
const CUSTOM=()=>`(async()=>{
 const v=window.__vesper,g=v.graphics,r=g.renderer,scene=g.scene,gl=r.getContext();
 v.fight.step=()=>{};
 const frame=()=>new Promise(res=>requestAnimationFrame(res));
 const measure=async n=>{for(let i=0;i<5;i++)await frame();const t=[];let last=performance.now();for(let i=0;i<n;i++){await frame();const now=performance.now();t.push(now-last);last=now;}t.sort((a,b)=>a-b);return t[Math.floor(t.length/2)];};
 const find=(test)=>{const out=[];scene.traverse(o=>{if(test(o))out.push(o);});return out;};
 const toggles=${require_toggles()};
 const out={};
 for(let round=0;round<3;round++)for(const [k,[on,off]] of Object.entries(toggles)){const b=await measure(${FRAMES});await on();for(let i=0;i<20;i++)await frame();const t=await measure(${FRAMES});await off();(out[k]=out[k]||[]).push(+(t-b).toFixed(1));out.base=(out.base||[]);out.base.push(+b.toFixed(1));}
 return out;
})()`;
const LIST=`(()=>{
 const v=window.__vesper,g=v.graphics,scene=g.scene;const out=[];const box=new (g.camera.position.constructor)();
 const path=o=>{const a=[];let n=o;while(n&&n!==scene){a.push(n.name||n.type);n=n.parent;}return a.slice(0,4).join('<');};
 scene.traverse(o=>{if(!(o.isMesh||o.isPoints||o.isSprite)||!o.visible)return;const m=[].concat(o.material)[0];
  const custom=m.onBeforeCompile&&m.onBeforeCompile.toString().length>60;
  if(!((m.type==='MeshStandardMaterial'&&!custom&&!m.transparent)||(m.type==='ShaderMaterial'&&m.transparent)))return;
  o.geometry.computeBoundingBox?.();const b=o.geometry.boundingBox;const s=b?b.getSize(box.clone()).multiply(o.getWorldScale(box.clone())):null;
  out.push({t:m.type[0]+(m.transparent?'T':''),path:path(o),tri:Math.round((o.geometry.index?o.geometry.index.count:o.geometry.attributes.position.count)/3*(o.count||1)),size:s?[s.x,s.y,s.z].map(x=>+x.toFixed(1)).join('x'):'',skinned:!!o.isSkinnedMesh,blend:m.blending,depthTest:m.depthTest,side:m.side,lights:m.lights,maps:[m.map&&'map',m.normalMap&&'nrm',m.roughnessMap&&'rgh',m.aoMap&&'ao',m.emissiveMap&&'em'].filter(Boolean).join(','),shadow:o.castShadow});});
 return out;})()`;
const GROUPS=`(async()=>{
 const v=window.__vesper,g=v.graphics,r=g.renderer,scene=g.scene,gl=r.getContext();
 v.fight.step=()=>{};// freeze the rules so nobody dies mid-measurement
 const measure=()=>new Promise(res=>{const t=[];let last=performance.now();const tick=now=>{t.push(now-last);last=now;if(t.length<${FRAMES})requestAnimationFrame(tick);else{t.shift();t.sort((a,b)=>a-b);res(+t[Math.floor(t.length/2)].toFixed(1));}};requestAnimationFrame(tick);});
 // bucket every visible mesh by its program key (shader), and list top-level groups
 const byShader=new Map(),byGroup=new Map();
 const topOf=o=>{let n=o;while(n.parent&&n.parent!==scene&&n.parent.parent!==scene)n=n.parent;return n;};
 scene.traverse(o=>{if(!(o.isMesh||o.isPoints||o.isLine||o.isSprite)||!o.visible)return;
  const m=[].concat(o.material)[0];const key=(m.type)+(m.onBeforeCompile&&m.onBeforeCompile.toString().length>60?'+custom:'+(m.customProgramCacheKey?.()||m.name||''):'')+(m.transparent?' T':'');
  const tri=(o.geometry.index?o.geometry.index.count:o.geometry.attributes.position.count)/3*(o.count||1);
  const e=byShader.get(key)||{objs:[],tri:0};e.objs.push(o);e.tri+=tri;byShader.set(key,e);
  const top=topOf(o);const gname=(top.name||top.type)+'#'+top.id;const ge=byGroup.get(gname)||{objs:[],tri:0};ge.objs.push(o);ge.tri+=tri;byGroup.set(gname,ge);});
 const run=async map=>{const out=[];for(const [k,e] of map){e.objs.forEach(o=>o.visible=false);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const t=await measure();e.objs.forEach(o=>o.visible=true);out.push({k,n:e.objs.length,tri:Math.round(e.tri/1000)+'k',ms:t});}return out;};
 await measure();const base=await measure();
 const shaders=await run(byShader);const groups=await run(byGroup);
 const base2=await measure();
 return{base,base2,shaders:shaders.sort((a,b)=>a.ms-b.ms),groups:groups.sort((a,b)=>a.ms-b.ms)};
})()`;
const AB=`(async()=>{
 const v=window.__vesper,g=v.graphics,r=g.renderer,scene=g.scene;
 const measure=()=>new Promise(res=>{const t=[];let last=performance.now();const tick=now=>{t.push(now-last);last=now;if(t.length<${FRAMES})requestAnimationFrame(tick);else{t.shift();t.sort((a,b)=>a-b);res(+t[Math.floor(t.length/2)].toFixed(1));}};requestAnimationFrame(tick);});
 const refl=scene.getObjectByName('Shared shallow puddle reflections');
 const toggles={
  baseline:[()=>{},()=>{}],
  noReflector:[()=>refl.visible=false,()=>refl.visible=true],
  noAO:[()=>g.ao.enabled=false,()=>g.ao.enabled=true],
  noBloom:[()=>g.bloom.enabled=false,()=>g.bloom.enabled=true],
  noShadowMaps:[()=>{r.shadowMap.enabled=false;scene.traverse(o=>{if(o.material)[].concat(o.material).forEach(m=>m.needsUpdate=true);});},()=>{r.shadowMap.enabled=true;scene.traverse(o=>{if(o.material)[].concat(o.material).forEach(m=>m.needsUpdate=true);});}],
  noPost:[()=>{g._r=g.render;g.render=()=>r.render(scene,g.camera);},()=>{g.render=g._r;}],
  noActors:[()=>{v.actors.player.root.visible=false;v.actors.boss.root.visible=false;},()=>{v.actors.player.root.visible=true;v.actors.boss.root.visible=true;}],
 };
 const out={};
 for(const [k,[on,off]] of Object.entries(toggles)){on();await measure();out[k]=await measure();off();await measure();}
 out.baseline2=await measure();
 return out;
})()`;
try{
 await send('Runtime.enable');await send('Page.enable');
 await send('Page.navigate',{url:BASE+'/'});await sleep(1200);
 await evaluate(`localStorage.setItem('vesper.presentation.v1',JSON.stringify({quality:${JSON.stringify(QUALITY)},'show-stats':false,'music-volume':0,'effects-volume':0}))`);
 await send('Page.navigate',{url:BASE+'/?'+Date.now()});
 const t0=Date.now();while(!(await evaluate('!!window.__vesper&&window.__vesper.ready').catch(()=>false))){if(Date.now()-t0>240000)throw new Error('not ready');await sleep(1000);}
 console.log(`ready after ${((Date.now()-t0)/1000).toFixed(1)}s`);
 await evaluate(`(()=>{HTMLDialogElement.prototype.showModal=function(){};})()`);
 await evaluate(`document.getElementById('begin').click()`);await sleep(5000);
 const CPU=arg('--cpuprofile','');
 if(CPU){await send('Profiler.enable');await send('Profiler.setSamplingInterval',{interval:200});await send('Profiler.start');await sleep(6000);const {profile}=await send('Profiler.stop');
  const self=new Map();const byId=new Map(profile.nodes.map(n=>[n.id,n]));const dt=profile.timeDeltas;let total=0;
  profile.samples.forEach((id,i)=>{const n=byId.get(id);const f=n.callFrame;const key=(f.functionName||'(anon)')+' '+f.url.split('/').pop().split('?')[0]+':'+(f.lineNumber+1);self.set(key,(self.get(key)||0)+(dt[i]||0));total+=dt[i]||0;});
  const top=[...self].sort((a,b)=>b[1]-a[1]).slice(0,40).map(([k,t])=>({pct:+(100*t/total).toFixed(1),k}));
  writeFileSync(CPU,JSON.stringify(profile));console.log(JSON.stringify(top,null,0).replace(/},/g,'},\n'));}
 const EVAL=arg('--eval','');
 const result=EVAL?await evaluate(readFileSync(EVAL,'utf8')):TOGGLES?await evaluate(CUSTOM()):process.argv.includes('--list')?await evaluate(LIST):process.argv.includes('--groups')?await evaluate(GROUPS):process.argv.includes('--ab')?await evaluate(AB):await evaluate(PROBE);
 result.errors=errors;
 console.log(JSON.stringify(result,null,1));
 if(OUT)writeFileSync(OUT,JSON.stringify(result,null,1));
}finally{ws.close();chrome.kill();await sleep(300);try{rmSync(profile,{recursive:true,force:true});}catch{}releaseLock();}
process.exit(0);
