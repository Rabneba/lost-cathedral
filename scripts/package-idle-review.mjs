// Keep the approved production mesh/materials and original idle exactly as
// shipped. Add only the reviewed Blender study's animation channels.
import fs from 'node:fs';
const [out='assets/idle-trial/boss-idle-study.glb',clipName='idle-study',mode='comparison',basePath='assets/production/boss-combat.glb']=process.argv.slice(2);
function read(p){const b=fs.readFileSync(p),n=b.readUInt32LE(12);return{j:JSON.parse(b.subarray(20,20+n)),bin:b.subarray(28+n)};}
const base=read(basePath),study=read(out);
base.j.animations=mode==='single'?[]:mode==='all'?base.j.animations:base.j.animations.filter(a=>a.name==='idle');
const av=base.j.accessors.length,bv=base.j.bufferViews.length;
for(const v of study.j.bufferViews)base.j.bufferViews.push({...v,byteOffset:(v.byteOffset||0)+base.bin.length,buffer:0});
for(const a of study.j.accessors)base.j.accessors.push({...a,bufferView:a.bufferView+bv});
for(const a of study.j.animations.filter(a=>a.name===clipName)){
 for(const s of a.samplers){s.input+=av;s.output+=av;}
 for(const c of a.channels){const name=study.j.nodes[c.target.node].name;c.target.node=base.j.nodes.findIndex(n=>n.name===name);if(c.target.node<0)throw Error('Unmatched bone '+name);}
 base.j.animations.push(a);
}
const bin=Buffer.concat([base.bin,study.bin]);base.j.buffers=[{byteLength:bin.length}];
const raw=Buffer.from(JSON.stringify(base.j)),j=Buffer.alloc(Math.ceil(raw.length/4)*4,32);raw.copy(j);
const h=Buffer.alloc(20);h.write('glTF');h.writeUInt32LE(2,4);h.writeUInt32LE(28+j.length+bin.length,8);h.writeUInt32LE(j.length,12);h.writeUInt32LE(0x4e4f534a,16);
const bh=Buffer.alloc(8);bh.writeUInt32LE(bin.length,0);bh.writeUInt32LE(0x004e4942,4);
fs.writeFileSync(out,Buffer.concat([h,j,bh,bin]));console.log('Packaged approved mesh with',base.j.animations.map(a=>a.name));
