// Copy only selected animation buffers into the preserved runtime rig.
// Usage: node scripts/package-combat-clips.mjs selection.json
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const digest=b=>createHash('sha256').update(b).digest('hex');
function read(file){
 const bytes=fs.readFileSync(file);
 assert.equal(bytes.toString('ascii',0,4),'glTF');assert.equal(bytes.readUInt32LE(4),2);
 assert.equal(bytes.readUInt32LE(8),bytes.length);
 let json,bin;
 for(let offset=12;offset<bytes.length;){
  const length=bytes.readUInt32LE(offset),type=bytes.readUInt32LE(offset+4),chunk=bytes.subarray(offset+8,offset+8+length);
  assert.equal(chunk.length,length);
  if(type===0x4e4f534a)json=JSON.parse(chunk.toString('utf8'));
  if(type===0x004e4942)bin=chunk;
  offset+=8+length;
 }
 assert.ok(json&&bin);assert.equal(json.buffers.length,1);assert.ok(!json.buffers[0].uri);
 return {json,bin,hash:digest(bytes)};
}
function names(j){
 const map=new Map();j.nodes.forEach((node,index)=>{if(node.name){assert.ok(!map.has(node.name),'Duplicate node: '+node.name);map.set(node.name,index);}});return map;
}
function parents(j){const p=new Map();j.nodes.forEach((node,i)=>(node.children||[]).forEach(child=>p.set(child,j.nodes[i].name)));return p;}
const spec=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
assert.ok(!fs.existsSync(spec.output),'Refusing to overwrite an existing asset');
const base=read(spec.base),baseNames=names(base.json),baseParents=parents(base.json);
const chunks=[base.bin];let byteLength=base.bin.length;
const report={base:spec.base,baseSha256:base.hash,output:spec.output,clips:[],preserved:'Base nodes, meshes, materials, skins, images and original BIN bytes retained; only selected animations replaced.'};
for(const [name,selection] of Object.entries(spec.clips)){
 const source=read(selection.asset),sourceParents=parents(source.json);names(source.json);
 const animation=structuredClone(source.json.animations.find(a=>a.name===(selection.clip||name)));
 assert.ok(animation,'Missing animation '+name);
 for(const channel of animation.channels){
  const sourceIndex=channel.target.node,node=source.json.nodes[sourceIndex],baseIndex=baseNames.get(node.name);
  assert.notEqual(baseIndex,undefined,'Unmatched node '+node.name);
  assert.equal(sourceParents.get(sourceIndex),baseParents.get(baseIndex),'Different parent: '+node.name);
  channel.target.node=baseIndex;
 }
 // Static transforms on each hierarchy must have the same units and basis.
 for(const node of source.json.nodes){
  const index=baseNames.get(node.name);if(index===undefined)continue;
  const other=base.json.nodes[index];
  for(const [key,fallback] of [['translation',[0,0,0]],['rotation',[0,0,0,1]],['scale',[1,1,1]]]){
   const a=node[key]||fallback,b=other[key]||fallback;
   const equal=a.every((v,i)=>Math.abs(v-b[i])<.001);
   const antipodal=key==='rotation'&&a.every((v,i)=>Math.abs(v+b[i])<.001);
   assert.ok(equal||antipodal,'Incompatible initial '+key+': '+node.name);
  }
  assert.deepEqual(node.matrix,other.matrix,'Different static matrix: '+node.name);
 }
 const views=new Map(),accessors=new Map();
 function copyAccessor(index){
  if(accessors.has(index))return accessors.get(index);
  const accessor=structuredClone(source.json.accessors[index]);
  assert.ok(!accessor.sparse&&Number.isInteger(accessor.bufferView),'Unsupported animation accessor');
  const oldView=accessor.bufferView;
  if(!views.has(oldView)){
   const view=source.json.bufferViews[oldView];assert.equal(view.buffer,0);
   const padding=(4-byteLength%4)%4;if(padding){chunks.push(Buffer.alloc(padding));byteLength+=padding;}
   const bytes=source.bin.subarray(view.byteOffset||0,(view.byteOffset||0)+view.byteLength);assert.equal(bytes.length,view.byteLength);
   views.set(oldView,base.json.bufferViews.length);
   base.json.bufferViews.push({...view,buffer:0,byteOffset:byteLength});chunks.push(bytes);byteLength+=bytes.length;
  }
  accessor.bufferView=views.get(oldView);const next=base.json.accessors.length;accessors.set(index,next);base.json.accessors.push(accessor);return next;
 }
 for(const sampler of animation.samplers){sampler.input=copyAccessor(sampler.input);sampler.output=copyAccessor(sampler.output);}
 animation.name=name;const previous=base.json.animations.findIndex(a=>a.name===name);
 if(previous>=0)base.json.animations[previous]=animation;else base.json.animations.push(animation);
 report.clips.push({name,source:selection.asset,sha256:source.hash,channels:animation.channels.length,copiedBufferViews:views.size});
}
const padding=(4-byteLength%4)%4;if(padding)chunks.push(Buffer.alloc(padding));
const bin=Buffer.concat(chunks);base.json.buffers=[{byteLength:bin.length}];
const raw=Buffer.from(JSON.stringify(base.json)),json=Buffer.alloc(Math.ceil(raw.length/4)*4,32);raw.copy(json);
const header=Buffer.alloc(20);header.write('glTF');header.writeUInt32LE(2,4);header.writeUInt32LE(28+json.length+bin.length,8);header.writeUInt32LE(json.length,12);header.writeUInt32LE(0x4e4f534a,16);
const binHeader=Buffer.alloc(8);binHeader.writeUInt32LE(bin.length,0);binHeader.writeUInt32LE(0x004e4942,4);
const output=Buffer.concat([header,json,binHeader,bin]);fs.mkdirSync(path.dirname(spec.output),{recursive:true});fs.writeFileSync(spec.output,output,{flag:'wx'});
report.sha256=digest(output);report.bytes=output.length;
fs.writeFileSync(spec.output+'.provenance.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report,null,2));
