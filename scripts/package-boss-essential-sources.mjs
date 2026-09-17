import fs from 'node:fs';
import path from 'node:path';

function read(file) {
 const b=fs.readFileSync(file),n=b.readUInt32LE(12);
 return {j:JSON.parse(b.subarray(20,20+n)),bin:Buffer.from(b.subarray(28+n))};
}
const base=read('assets/approved/boss-idle.glb');
const chunks=[base.bin];let length=base.bin.length;
const reports=[];
for(const [name,file] of [
 ['walk-forward','docs/boss-combat-advance-motion-result.json'],
 ['sweep','docs/boss-sweep-motion-result.json'],
 ['slam','docs/boss-slam-motion-result.json'],
]) {
 if(!fs.existsSync(file)||!fs.readFileSync(file,'utf8').trim())continue;
 const result=JSON.parse(fs.readFileSync(file));
 const source=result.saved?.find(f=>f.path.endsWith('.glb'))?.path;
 if(!source)continue;
 const raw=read(source),av=base.j.accessors.length,bv=base.j.bufferViews.length;
 for(const v of raw.j.bufferViews)base.j.bufferViews.push({...v,buffer:0,byteOffset:(v.byteOffset||0)+length});
 for(const a of raw.j.accessors)base.j.accessors.push({...a,bufferView:a.bufferView+bv});
 for(const a of raw.j.animations) {
  a.name='source-'+name;
  for(const s of a.samplers){s.input+=av;s.output+=av;}
  for(const c of a.channels){
   const n=raw.j.nodes[c.target.node].name;
   c.target.node=base.j.nodes.findIndex(b=>b.name===n);
   if(c.target.node<0)throw Error('Unmatched source node '+n);
  }
  base.j.animations.push(a);
 }
 chunks.push(raw.bin);length+=raw.bin.length;
 reports.push({name,generationId:result.id,source});
}
const bin=Buffer.concat(chunks);base.j.buffers=[{byteLength:bin.length}];
const rawJson=Buffer.from(JSON.stringify(base.j)),j=Buffer.alloc(Math.ceil(rawJson.length/4)*4,32);rawJson.copy(j);
const h=Buffer.alloc(20);h.write('glTF');h.writeUInt32LE(2,4);h.writeUInt32LE(28+j.length+bin.length,8);h.writeUInt32LE(j.length,12);h.writeUInt32LE(0x4e4f534a,16);
const bh=Buffer.alloc(8);bh.writeUInt32LE(bin.length,0);bh.writeUInt32LE(0x004e4942,4);
const out='assets/boss-essential-motion/boss-sources.glb';fs.mkdirSync(path.dirname(out),{recursive:true});
fs.writeFileSync(out,Buffer.concat([h,j,bh,bin]));
fs.writeFileSync('docs/boss-essential-sources.json',JSON.stringify(reports,null,2)+'\n');
console.log(out,base.j.animations.map(a=>a.name));
