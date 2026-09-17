import fs from 'node:fs';
function read(file){const b=fs.readFileSync(file),size=b.readUInt32LE(12);return{json:JSON.parse(b.toString('utf8',20,20+size)),bin:b.subarray(28+size)};}
const [rigPath,resultPath,manifestPath,out]=process.argv.slice(2);const base=read(rigPath),result=JSON.parse(fs.readFileSync(resultPath)),manifest=JSON.parse(fs.readFileSync(manifestPath));let chunks=[base.bin],offset=base.bin.length;base.json.animations=[];
for(const f of result.saved.filter(f=>f.path.endsWith('.glb'))){const m=read(f.path),id=f.role.match(/uthana-(.+)-glb/)?.[1]||'';const meta=manifest.clips.find(c=>c.key.toLowerCase().endsWith(id.slice(0,8).toLowerCase()));const av=base.json.accessors.length,bv=base.json.bufferViews.length;
 for(const view of m.json.bufferViews)base.json.bufferViews.push({...view,byteOffset:(view.byteOffset||0)+offset,buffer:0});
 for(const a of m.json.accessors)base.json.accessors.push({...a,bufferView:a.bufferView+bv});
 for(const a of m.json.animations){a.name=meta?.name||id;for(const s of a.samplers){s.input+=av;s.output+=av;}for(const c of a.channels){c.target.node=base.json.nodes.findIndex(n=>n.name===m.json.nodes[c.target.node].name);}base.json.animations.push(a);}
 chunks.push(m.bin);offset+=m.bin.length;
}
const bin=Buffer.concat(chunks);base.json.buffers=[{byteLength:bin.length}];const raw=Buffer.from(JSON.stringify(base.json)),jb=Buffer.alloc(Math.ceil(raw.length/4)*4,32);raw.copy(jb);const header=Buffer.alloc(20);header.write('glTF');header.writeUInt32LE(2,4);header.writeUInt32LE(28+jb.length+bin.length,8);header.writeUInt32LE(jb.length,12);header.writeUInt32LE(0x4e4f534a,16);const bh=Buffer.alloc(8);bh.writeUInt32LE(bin.length,0);bh.writeUInt32LE(0x004e4942,4);fs.writeFileSync(out,Buffer.concat([header,jb,bh,bin]));console.log(out,base.json.animations.map(a=>a.name));
