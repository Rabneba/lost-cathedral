// The mobile pass (17 Sep 2026): touch detection, the phone presets, the stick maths, the texture cap, and the rule
// that none of it reaches the desktop path.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {detectTouchDevice,fovForAspect,pixelRatioFor,TOUCH_PIXEL_BUDGET} from '../src/game/device.js';
import {stickVector,followOrigin,STICK_RADIUS} from '../src/game/touch-controls.js';
import {cappedSize,TOUCH_TEXTURE_CAP} from '../src/game/texture-budget.js';
import {sanitizePreferences} from '../src/game/preferences.js';

const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const media=truthy=>q=>({matches:truthy.includes(q)});

test('touch detection: phones, tablets and iPadOS-as-a-Mac take the touch path; a desktop and a mouse laptop do not',()=>{
 assert.equal(detectTouchDevice({search:'?touch=1'}),true,'forced on');
 assert.equal(detectTouchDevice({search:'?genex_local_test=1&touch=0',matchMedia:media(['(pointer:coarse)','(hover:none)'])}),false,'forced off wins over a coarse pointer');
 assert.equal(detectTouchDevice({matchMedia:media(['(pointer:coarse)','(hover:none)']),navigator:{maxTouchPoints:5,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Twitter for iPhone'}}),true,'an iPhone inside the X app');
 assert.equal(detectTouchDevice({matchMedia:media([]),navigator:{maxTouchPoints:5,userAgent:'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/152 Mobile Safari/537.36'}}),true,'an Android phone whose media queries are unavailable');
 assert.equal(detectTouchDevice({matchMedia:media(['(pointer:coarse)','(hover:none)']),navigator:{maxTouchPoints:5,platform:'MacIntel',userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15'}}),true,'iPadOS asking for the desktop site');
 assert.equal(detectTouchDevice({matchMedia:media(['(pointer:fine)','(hover:hover)']),navigator:{maxTouchPoints:0,platform:'MacIntel',userAgent:'Mozilla/5.0 (Macintosh) Chrome/153'}}),false,'a Mac');
 assert.equal(detectTouchDevice({matchMedia:media(['(pointer:fine)','(hover:hover)']),navigator:{maxTouchPoints:10,platform:'Win32',userAgent:'Mozilla/5.0 (Windows NT 10.0) Chrome/153'}}),false,'a Windows laptop with a touch screen and a mouse');
 assert.equal(detectTouchDevice({matchMedia:()=>{throw new Error('no matchMedia');},navigator:{maxTouchPoints:0,userAgent:''}}),false,'no media queries, no touch points');
 assert.equal(detectTouchDevice(),false,'nothing known: the desktop');
});

test('the field of view opens in portrait and is untouched in landscape',()=>{
 assert.equal(fovForAspect(16/9),52);assert.equal(fovForAspect(1),52);assert.equal(fovForAspect(NaN),52);
 const tablet=fovForAspect(3/4),phone=fovForAspect(9/16),tall=fovForAspect(390/844);
 assert.ok(tablet>60&&tablet<65,`tablet ${tablet.toFixed(1)}`);
 assert.ok(phone>72&&phone<77,`phone ${phone.toFixed(1)}`);
 assert.ok(tall>82&&tall<=84,`tallest phones ${tall.toFixed(1)}, capped at 84`);assert.equal(fovForAspect(.3),84,'the cap');
});

test('pixel ratio: the desktop numbers are what shipped; a phone never renders more than its budget',()=>{
 for(const dpr of [1,2,3]){
  assert.equal(pixelRatioFor({mode:'high',dpr,width:1600,height:900}),Math.min(dpr,1.15));
  assert.equal(pixelRatioFor({mode:'balanced',dpr,width:1600,height:900}),1);
  assert.equal(pixelRatioFor({mode:'low',dpr,width:1600,height:900}),.8);
 }
 for(const [w,h,dpr] of [[390,844,3],[844,390,3],[412,915,2.625],[1024,768,2],[1366,1024,2]])for(const mode of ['high','balanced','low']){
  const ratio=pixelRatioFor({mode,touch:true,dpr,width:w,height:h});
  assert.ok(ratio<=dpr&&ratio<=2,`${w}x${h}@${dpr} ${mode}: ${ratio} under the device ratio and 2`);
  assert.ok(w*h*ratio*ratio<=TOUCH_PIXEL_BUDGET[mode]*1.001,`${w}x${h}@${dpr} ${mode}: ${Math.round(w*h*ratio*ratio)} px within ${TOUCH_PIXEL_BUDGET[mode]}`);
 }
 assert.ok(pixelRatioFor({mode:'balanced',touch:true,dpr:3,width:390,height:844})>1.5,'a phone still renders above 1x');
});

test('the stick: a dead zone, unit length at the rim, a base that follows a long swipe',()=>{
 assert.deepEqual(stickVector(0,0),{right:0,forward:0,magnitude:0});
 assert.equal(stickVector(4,4).magnitude,0,'inside the dead zone');
 const up=stickVector(0,-STICK_RADIUS);assert.ok(Math.abs(up.forward-1)<1e-9&&Math.abs(up.right)<1e-9,'screen up is forward');
 const far=stickVector(300,400);assert.ok(Math.abs(Math.hypot(far.right,far.forward)-1)<1e-9,'clamped to unit length');
 assert.ok(far.right>0&&far.forward<0,'down-right is back and right');
 const half=stickVector(STICK_RADIUS/2,0);assert.ok(Math.abs(half.right-.5)<1e-9&&half.magnitude===.5);
 assert.deepEqual(followOrigin({x:100,y:100},{x:120,y:100}),{x:100,y:100},'inside the rim the base stays');
 const moved=followOrigin({x:100,y:100},{x:100+STICK_RADIUS*3,y:100});
 assert.ok(Math.abs(moved.x-(100+STICK_RADIUS*2))<1e-9&&moved.y===100,'past the rim the base follows so the knob sits on the rim');
});

test('the texture cap shrinks the 4096 maps to 1024 and leaves smaller ones alone',()=>{
 assert.equal(TOUCH_TEXTURE_CAP,1024);
 assert.deepEqual(cappedSize(4096,4096,1024),{width:1024,height:1024});
 assert.deepEqual(cappedSize(2048,1024,1024),{width:1024,height:512});
 assert.equal(cappedSize(1024,1024,1024),null);assert.equal(cappedSize(256,1024,1024),null);
});

test('the touch path starts at Performance unless the player chose otherwise; the desktop default is unchanged',()=>{
 assert.equal(sanitizePreferences(null).quality,'high');
 assert.equal(sanitizePreferences(null,{quality:'low'}).quality,'low');
 assert.ok(read('src/game/main.js').includes("touchMode?{defaults:{quality:'low'}}:{}"),'main.js asks for Performance on the touch path only');
 assert.equal(sanitizePreferences({quality:'high'},{quality:'balanced'}).quality,'high');
 assert.equal(sanitizePreferences({quality:'nonsense'},{quality:'balanced'}).quality,'balanced');
});

test('the markup, the stylesheet and the wiring: touch only ever adds, behind body.touch and touchMode',()=>{
 const html=read('index.html'),css=read('src/game/style.css'),main=read('src/game/main.js'),rendering=read('src/game/rendering.js');
 assert.ok(html.includes('viewport-fit=cover'),'the viewport meta covers the notch');
 assert.ok(html.includes('<div id="touch" hidden'),'the touch layer ships hidden');
 for(const action of ['attack','roll','guard','flask','lock','pause'])assert.ok(html.includes(`data-action="${action}"`),`a ${action} button`);
 assert.ok(html.includes('<dl class="key-only">')&&html.includes('<dl class="touch-only">'),'two control lists in the pause band');
 assert.ok(css.includes('body:not(.touch) .touch-only{display:none!important}'),'the touch list is invisible on the desktop');
 assert.ok(css.includes('body.touch canvas{height:100dvh'),'the dynamic viewport height only under body.touch');
 assert.ok(!/^canvas\{[^}]*dvh/m.test(css),'the desktop canvas rule is untouched');
 assert.ok(main.includes("detectTouchDevice({search:location.search")&&main.includes("document.body.classList.toggle('touch',touchMode)"));
 for(const guard of ["canvas.addEventListener('pointerdown',e=>{\n if(touchMode&&e.pointerType==='touch')return;","addEventListener('pointerup',e=>{\n if(touchMode&&e.pointerType==='touch')return;","addEventListener('pointermove',e=>{\n if(touchMode&&e.pointerType==='touch')return;"])assert.ok(main.includes(guard),'the desktop pointer handlers step aside for a finger');
 assert.ok(main.includes("shadowScale:touchMode?.5:1,textureCap:touchMode?TOUCH_TEXTURE_CAP:0")&&main.includes("loadActors(scene,paths,{textureCap:touchMode?TOUCH_TEXTURE_CAP:0,serial:touchMode})"),'phones get the shadow and texture budgets, the desktop passes the shipped values');
 assert.ok(main.includes("new GameAudio(ASSETS,{routeMusic:touchMode})"),'the music routes through the context only on touch');
 assert.ok(main.includes("const baseFov=()=>touchMode?fovForAspect(camera.aspect):52;")&&main.includes('const fovTarget=baseFov()+runWiden'),'the field of view keeps its 52 base on the desktop');
 assert.ok(rendering.includes("ao.enabled=mode==='high'&&!touch")&&rendering.includes("if(!touch)return mode==='high'?Math.min(dpr,1.15):mode==='balanced'?1:.8;")||rendering.includes("ao.enabled=mode==='high'&&!touch"),'AO never runs on a phone');
 assert.ok(read('src/game/device.js').includes("if(!touch)return mode==='high'?Math.min(dpr,1.15):mode==='balanced'?1:.8;"),'the desktop pixel ratios are literal');
});

test('the version is set and shown',()=>{
 const pkg=JSON.parse(read('package.json'));
 assert.match(pkg.version,/^\d+\.\d+\.\d+$/);
 const [major,minor]=pkg.version.split('.').map(Number);assert.ok(major>1||(major===1&&minor>=1),'1.1.0 or later (1.0 was the 17 Sep release)');
 assert.ok(read('src/game/main.js').includes("$('version').textContent='v'+pkg.version"),'the pause band shows it');
 assert.ok(read('index.html').includes('<span id="version"></span>')&&read('index.html').includes('href="https://github.com/Rabneba/lost-cathedral"'),'the pause band foot carries the version and the source link');
});

// The phone copies of the heavy models (scripts/make-mobile-assets.py): same container, textures no larger than 1024.
import {ASSETS,MOBILE_ASSETS} from '../src/game/asset-paths.js';
import {fileURLToPath} from 'node:url';

function glbImages(file){
 const data=readFileSync(file);const jsonLength=data.readUInt32LE(12);const doc=JSON.parse(data.subarray(20,20+jsonLength).toString());
 const bin=data.subarray(20+jsonLength+8);
 return{doc,images:(doc.images||[]).map(image=>{const view=doc.bufferViews[image.bufferView];const bytes=bin.subarray(view.byteOffset||0,(view.byteOffset||0)+view.byteLength);
  if(image.mimeType==='image/png')return{width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)};
  let i=2;while(i<bytes.length){if(bytes[i]!==0xFF){i++;continue;}const marker=bytes[i+1];if(marker>=0xC0&&marker<=0xCF&&![0xC4,0xC8,0xCC].includes(marker))return{height:bytes.readUInt16BE(i+5),width:bytes.readUInt16BE(i+7)};i+=2+bytes.readUInt16BE(i+2);}
  return{width:0,height:0};})};
}

test('the phone copies exist, keep the mesh, rig and clips, and carry no texture above 1024; the desktop table still points at the originals',()=>{
 const pairs=[['playerRig','playerRig'],['bossRig','bossRig'],['scythe','scythe'],['playerSword','playerSword'],['playerShield','playerShield']];
 for(const [mobileKey,desktopKey] of pairs){
  const mobile=fileURLToPath(MOBILE_ASSETS[mobileKey]),desktop=fileURLToPath(ASSETS[desktopKey]);
  assert.ok(mobile.includes('/assets/mobile/')&&!desktop.includes('/assets/mobile/'),`${desktopKey}: the desktop loads the original`);
  const a=glbImages(desktop),b=glbImages(mobile);
  assert.equal(a.images.length,b.images.length,`${mobileKey}: the same number of images`);
  assert.ok(a.images.some(i=>i.width>=4096),`${desktopKey}: the original is the 4096 one`);
  for(const image of b.images)assert.ok(image.width<=1024&&image.height<=1024&&image.width>0,`${mobileKey}: ${image.width}x${image.height}`);
  for(const key of ['meshes','skins','animations','materials','nodes','accessors'])assert.equal(JSON.stringify(a.doc[key]),JSON.stringify(b.doc[key]),`${mobileKey}: ${key} identical`);
 }
 for(const key of ['monument','monumentLod'])for(const image of glbImages(fileURLToPath(MOBILE_ASSETS[key])).images)assert.ok(image.width<=1024,`${key} ${image.width}`);
 for(const key of ['floorSeal','floorSealNR']){const bytes=readFileSync(fileURLToPath(MOBILE_ASSETS[key]));assert.equal(bytes.readUInt32BE(16),1024,key+' is 1024 wide');}
 const main=read('src/game/main.js');
 assert.ok(main.includes('const paths=touchMode?{...ASSETS,...MOBILE_ASSETS}:ASSETS'),'the swap happens only on the touch path');
 assert.ok(read('src/game/actors.js').includes('serial:false')||read('src/game/actors.js').includes('serial=false'),'serial loading is opt-in');
 assert.ok(main.includes('serial:touchMode'),'and the phone opts in');
});

test('the phone light budget: 4 pooled candles, 3 uplights, shadowless cookies, no effect flashes, no SMAA at Performance; the desktop keeps 9, 5, shadows, SMAA',()=>{
 const arena=read('src/game/arena.js'),main=read('src/game/main.js'),rendering=read('src/game/rendering.js');
 assert.ok(arena.includes('const LIGHT_POOL=texturePaths.lightPool??9,lightBudget=!!texturePaths.lightBudget;'),'the pool defaults to 9');
 assert.ok(arena.includes('.filter(([z])=>!lightBudget||Math.abs(z)<=6)'),'all five uplights without a budget');
 assert.ok(arena.includes('spot.castShadow=!lightBudget;'),'cookie spots cast shadows without a budget');
 assert.ok(main.includes('lightPool:touchMode?4:9,lightBudget:touchMode'),'main.js budgets the phone only');
 assert.ok(main.includes("if(touchMode)scene.traverse(o=>{if(o.isLight&&o.userData.cosmetic&&!o.userData.weaponLight)o.visible=false;});"),'effect flashes off on the phone, before the first frame');
 assert.ok(read('src/game/weapon-fire.js').includes('light.userData.weaponLight=true;'),'the weapon fire lights are marked to stay');
 assert.ok(rendering.includes("aa.enabled=touch?mode!=='low':true;"),'SMAA stays on for every desktop preset');
});
