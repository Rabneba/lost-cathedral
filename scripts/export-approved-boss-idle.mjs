// Bake the user's approved 0.25x pace into a portable idle clip.
// The review source and original timings remain untouched.
import fs from 'node:fs';
const path='assets/idle-forward-lean/boss-forward-lean.glb',bytes=fs.readFileSync(path),n=bytes.readUInt32LE(12);
const j=JSON.parse(bytes.subarray(20,20+n)),bin=Buffer.from(bytes.subarray(28+n));
const clip=j.animations.find(a=>a.name==='idle-forward-lean');if(!clip)throw Error('Approved forward idle missing');
const speed=.25;let duration=0;
for(const id of new Set(clip.samplers.map(s=>s.input))){
 const a=j.accessors[id],v=j.bufferViews[a.bufferView];if(a.componentType!==5126||a.type!=='SCALAR')throw Error('Unexpected animation time format');
 for(let i=0;i<a.count;i++){const p=(v.byteOffset||0)+(a.byteOffset||0)+i*(v.byteStride||4),t=bin.readFloatLE(p)/speed;bin.writeFloatLE(t,p);duration=Math.max(duration,t);}
 if(a.min)a.min=a.min.map(t=>t/speed);if(a.max)a.max=a.max.map(t=>t/speed);
}
clip.name='idle';j.animations=[clip];
const json=Buffer.from(JSON.stringify(j)),pad=Buffer.alloc(Math.ceil(json.length/4)*4,32);json.copy(pad);const h=Buffer.alloc(20);h.write('glTF');h.writeUInt32LE(2,4);h.writeUInt32LE(28+pad.length+bin.length,8);h.writeUInt32LE(pad.length,12);h.writeUInt32LE(0x4e4f534a,16);const bh=Buffer.alloc(8);bh.writeUInt32LE(bin.length,0);bh.writeUInt32LE(0x004e4942,4);
fs.mkdirSync('assets/approved',{recursive:true});const out='assets/approved/boss-idle.glb';fs.writeFileSync(out,Buffer.concat([h,pad,bh,bin]));
const manifest={source:path,sourceClip:'idle-forward-lean',asset:out,clip:'idle',leanDegrees:5,approvedSourcePlaybackRate:speed,timingBaked:true,runtimePlaybackRate:1,duration,weapon:'assets/idle-video-motion/scythe-fitted.glb',weaponHeight:2.85,note:'Timing already contains the approved quarter-speed pace; do not slow this exported clip again. Existing inspector uses the original source at 0.25x.'};
fs.writeFileSync('docs/boss-approved-idle.json',JSON.stringify(manifest,null,2));console.log(manifest);
