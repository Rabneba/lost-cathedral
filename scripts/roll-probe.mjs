// Scripted roll playtest through the capture bridge (scripts/capture-server.mjs + a worker tab in
// the user's Chrome). scripts/roll-playtest.mjs drives a headless Chrome, which this machine cannot
// start (macOS directory services broken, 16 Sep 2026), so the same play is expressed as a game
// capture job: each case holds a key, requests a dodge and samples the real game state at a series
// of exact simulation times, then this script checks the roll went where the stick pointed, that
// the body turned into it, and that lock-on brings the facing back to the boss afterwards.
//
//   node scripts/roll-probe.mjs [--out DIR] [--server http://127.0.0.1:5199] [--width 480]
//
// Prints one row per case and exits non-zero if any assertion fails.
import {mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';

const arg=(name,fallback)=>{const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:fallback;};
const SERVER=arg('--server',process.env.VESPER_CAPTURE_SERVER||'http://127.0.0.1:5199');
const OUT=path.resolve(arg('--out','docs/overnight-2026-09-16/C-stills/roll-probe'));
const WIDTH=Number(arg('--width','640')),HEIGHT=Number(arg('--height','360')),TIMEOUT=Number(arg('--timeout','900'))*1000;

/** The camera-relative heading of a held direction, mirroring src/game/motion.js. */
function cameraRelative({forward=0,right=0,cameraYaw=0}){
 const magnitude=Math.hypot(right,forward)||1,x=right/magnitude,z=forward/magnitude;
 return {x:x*Math.cos(cameraYaw)-z*Math.sin(cameraYaw),z:-x*Math.sin(cameraYaw)-z*Math.cos(cameraYaw)};
}
const wrap=angle=>Math.atan2(Math.sin(angle),Math.cos(angle));
const degrees=radians=>Math.abs(wrap(radians))*180/Math.PI;

// Sample times inside the dodge (duration 1.43 s) and through the stand-up and turn back.
const TIMES=[.08,.15,.30,.50,.75,1.00,1.25,1.45,1.60,1.80,2.10,2.50];
const RELEASE=1.00; // the key is let go once the roll is committed, as a player would

const CASES=[
 {id:'lockA',keys:['KeyA'],lock:true,input:{right:-1}},
 {id:'lockD',keys:['KeyD'],lock:true,input:{right:1}},
 {id:'lockS',keys:['KeyS'],lock:true,input:{forward:-1}},
 {id:'lockW',keys:['KeyW'],lock:true,input:{forward:1}},
 {id:'lockWA',keys:['KeyW','KeyA'],lock:true,input:{forward:1,right:-1}},
 {id:'lockNone',keys:[],lock:true,input:null},
 {id:'freeA',keys:['KeyA'],lock:false,input:{right:-1}},
 {id:'freeS',keys:['KeyS'],lock:false,input:{forward:-1}},
];

const shots=[];
for(const test of CASES){
 const add=(key,value)=>`window.__vesper.keys.${value?'add':'delete'}('${key}');`;
 const hold=test.keys.map(key=>add(key,true)).join('');
 // Settle the case: clear every key, set the lock mode, let stamina come back.
 // Both actors are placed far apart first: a roll that runs into the boss's body or the arena
 // wall is a collision test, not a heading test, and this case is about the heading.
 shots.push({name:`${test.id}-rest`,wait:2600,lock:test.lock,yaw:0,pitch:.15,distance:5.2,
  js:`for(const k of ['KeyW','KeyA','KeyS','KeyD'])window.__vesper.keys.delete(k);window.__vesper.lock=${test.lock};`
   +`const m=window.__vesper.motion;m.player.x=0;m.player.z=6;m.boss.x=0;m.boss.z=-8;`});
 shots.push({name:`${test.id}-t000`,wait:17,lock:test.lock,yaw:0,pitch:.15,distance:5.2});
 let previous=0;
 for(const time of TIMES){
  const js=[];
  if(time===TIMES[0])js.push(hold+`window.__vesper.request('dodge');`);
  if(time===RELEASE)js.push(test.keys.map(key=>add(key,false)).join(''));
  shots.push({name:`${test.id}-t${String(Math.round(time*1000)).padStart(3,'0')}`,wait:Math.round((time-previous)*1000),
   lock:test.lock,yaw:0,pitch:.15,distance:5.2,js:js.join('')||undefined});
  previous=time;
 }
}

mkdirSync(OUT,{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
try{await (await fetch(SERVER+'/health')).json();}catch{console.error(`capture server not reachable at ${SERVER}`);process.exit(2);}
const body={kind:'game',out:OUT,options:{quality:'low',width:WIDTH,height:HEIGHT,settle:1500,hud:false},shots};
const {id}=await (await fetch(SERVER+'/job',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})).json();
const started=Date.now();let job;
for(;;){job=await (await fetch(`${SERVER}/job/${id}`)).json();if(job.status==='done'||job.status==='failed')break;
 if(Date.now()-started>TIMEOUT){console.error(`timed out waiting for job ${id} (${job.status})`);process.exit(3);}await sleep(600);}
const byName=new Map(job.results.filter(Boolean).map(result=>[result.name,result]));
writeFileSync(path.join(OUT,'roll-probe.json'),JSON.stringify({server:SERVER,results:job.results.filter(Boolean),errors:job.errors},null,1));

let failures=0;
const rows=[];
for(const test of CASES){
 const start=byName.get(`${test.id}-t000`);
 const frames=TIMES.map(time=>byName.get(`${test.id}-t${String(Math.round(time*1000)).padStart(3,'0')}`)).filter(Boolean);
 if(!start||frames.length!==TIMES.length){console.error(`${test.id}: missing shots`);failures++;continue;}
 const cameraYaw=start.view.yaw;
 const wanted=test.input?cameraRelative({...test.input,cameraYaw}):null;
 const last=frames.at(-1),endOfRoll=frames[TIMES.indexOf(1.45)];
 const travel={x:endOfRoll.player.x-start.player.x,z:endOfRoll.player.z-start.player.z};
 const distance=Math.hypot(travel.x,travel.z);
 const along=wanted&&distance>1e-6?(travel.x*wanted.x+travel.z*wanted.z)/distance:null;
 const heading=wanted?Math.atan2(wanted.x,wanted.z):start.player.yaw;
 const turnedBy=frames[TIMES.indexOf(.15)].player.yaw;
 const headingError=degrees(turnedBy-heading);
 const yawTurned=degrees(endOfRoll.player.yaw-start.player.yaw);
 const toBoss=Math.atan2(last.boss.x-last.player.x,last.boss.z-last.player.z);
 const facingError=degrees(last.player.yaw-toBoss);
 const check=(ok,message)=>{if(!ok){failures++;console.error(`  FAIL ${test.id}: ${message}`);}};
 check(Math.abs(distance-2.651)<.25,`travelled ${distance.toFixed(3)} m, expected the authored 2.65 m`);
 if(wanted)check(along>.995,`travelled ${(along??0).toFixed(3)} along the requested heading`);
 if(wanted)check(headingError<8,`body was ${headingError.toFixed(1)}° off the roll heading at 0.15 s`);
 if(!wanted)check(degrees(endOfRoll.player.yaw-start.player.yaw)<1e-3,`a no-input roll must not turn the body (${yawTurned.toFixed(1)}°)`);
 if(test.lock)check(facingError<6,`facing was ${facingError.toFixed(1)}° off the boss 1.05 s after the roll`);
 // Nothing may teleport: the largest single-sample jump stays inside the clip's own pace.
 let jump=0;for(let i=1;i<frames.length;i++)jump=Math.max(jump,Math.hypot(frames[i].player.x-frames[i-1].player.x,frames[i].player.z-frames[i-1].player.z)/(TIMES[i]-TIMES[i-1]));
 check(jump<9,`peak sampled speed ${jump.toFixed(2)} m/s`);
 rows.push({case:test.id,travel:`(${travel.x.toFixed(3)}, ${travel.z.toFixed(3)})`,metres:+distance.toFixed(3),
  along:along===null?'—':+along.toFixed(3),headingErrorDeg:+headingError.toFixed(1),yawTurnedDeg:+yawTurned.toFixed(1),
  facingErrorDeg:test.lock?+facingError.toFixed(1):'—',peakSpeed:+jump.toFixed(2)});
}
console.table(rows);
writeFileSync(path.join(OUT,'roll-probe-summary.json'),JSON.stringify({rows,errors:job.errors},null,1));
if(job.errors.length){console.log('page errors:');for(const error of job.errors)console.log(' -',String(error).slice(0,300));failures+=job.errors.length;}
console.log(failures?`${failures} failed checks`:'all roll checks passed');
process.exit(failures?1:0);
