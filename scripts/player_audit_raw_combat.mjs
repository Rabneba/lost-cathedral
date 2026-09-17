// Measure unmodified provider channels before any Blender retarget or cleanup.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
function read(p){const b=fs.readFileSync(p),s=b.readUInt32LE(12);return {j:JSON.parse(b.toString('utf8',20,20+s)),bin:b.subarray(28+s),hash:createHash('sha256').update(b).digest('hex')};}
function values(g,i){const a=g.j.accessors[i],v=g.j.bufferViews[a.bufferView],n={SCALAR:1,VEC3:3,VEC4:4}[a.type];return Array.from(new Float32Array(g.bin.buffer,g.bin.byteOffset+(v.byteOffset||0)+(a.byteOffset||0),a.count*n));}
function angle(a,b){const dot=Math.abs(a.reduce((s,v,i)=>s+v*b[i],0))/Math.sqrt(a.reduce((s,v)=>s+v*v,0)*b.reduce((s,v)=>s+v*v,0));return 2*Math.acos(Math.min(1,dot))*180/Math.PI;}
const out={};
for(const name of process.argv.slice(2)){
 const r=JSON.parse(fs.readFileSync(`docs/player-combat-revision/${name}-motion-result.json`)),p=r.saved.find(f=>f.path.endsWith('.glb')).path,g=read(p),a=g.j.animations[0],bones={};
 for(const c of a.channels){const n=g.j.nodes[c.target.node].name,s=a.samplers[c.sampler],time=values(g,s.input),v=values(g,s.output);if(c.target.path==='rotation'){
  const frames=Array.from({length:time.length},(_,i)=>v.slice(i*4,i*4+4)),exc=frames.map(q=>angle(frames[0],q)),speed=frames.slice(1).map((q,i)=>angle(frames[i],q)/(time[i+1]-time[i]));
  bones[n]={maxExcursionDegrees:Math.max(...exc),maxSpeedDegreesPerSecond:Math.max(...speed),firstSignificantMotionSeconds:time[exc.findIndex(x=>x>3)]??null,lastSignificantMotionSeconds:time[exc.findLastIndex(x=>x>3)]??null};
 }else if(c.target.path==='translation'){
  const frames=Array.from({length:time.length},(_,i)=>v.slice(i*3,i*3+3));bones[n+'Translation']={componentRanges:[0,1,2].map(i=>Math.max(...frames.map(x=>x[i]))-Math.min(...frames.map(x=>x[i])))};
 }}
 out[name]={generationId:r.id,rawPath:p,sha256:g.hash,bones};
}
fs.writeFileSync('docs/player-combat-revision/raw-channel-audit.json',JSON.stringify(out,null,2));
for(const[n,r]of Object.entries(out))console.log(n,Object.fromEntries(Object.entries(r.bones).filter(([b])=>/RightArm$|RightForeArm$|RightHand$|Spine2|HipsTranslation/.test(b))));
