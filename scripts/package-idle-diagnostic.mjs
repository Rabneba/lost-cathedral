// Compare existing motion sources; no generation or pose correction.
import fs from 'node:fs';
import * as T from 'three';
import {loadGLB} from './load-glb-node.mjs';
function read(path){const b=fs.readFileSync(path),size=b.readUInt32LE(12);return {json:JSON.parse(b.subarray(20,20+size)),bin:Buffer.from(b.subarray(28+size))};}
const base=read('assets/idle-video-motion/boss-idle-video.glb');
const raw=read('assets/idle-video-motion/animate-character-cmu1gedz204a32pnwb9ti9-cmu1pj1h.glb');
const ground=JSON.parse(fs.readFileSync('docs/boss-video-raw-audit.json')).constantGroundOffset;
const reference=await loadGLB('assets/idle-video-motion/boss-idle-video.glb');
reference.scene.updateMatrixWorld(true);
const inverseParent=reference.scene.getObjectByName('mixamorigHips').parent.matrixWorld.clone().invert();
const shift=new T.Vector3(0,-ground,0).applyMatrix4(inverseParent).sub(new T.Vector3().applyMatrix4(inverseParent)).toArray();
// Translate the entire raw performance to the review floor. Leave all joint
// rotation, timing, and relative motion exactly as delivered by Uthana.
for(const animation of raw.json.animations)for(const channel of animation.channels){
 if(raw.json.nodes[channel.target.node].name.replaceAll(':','')!=='mixamorigHips'||channel.target.path!=='translation')continue;
 const accessor=raw.json.accessors[animation.samplers[channel.sampler].output],view=raw.json.bufferViews[accessor.bufferView];
 if(accessor.componentType!==5126||accessor.type!=='VEC3')throw Error('Unexpected root translation format');
 for(let i=0;i<accessor.count;i++)for(let axis=0;axis<3;axis++){const at=(view.byteOffset||0)+(accessor.byteOffset||0)+i*(view.byteStride||12)+axis*4;raw.bin.writeFloatLE(raw.bin.readFloatLE(at)+shift[axis],at);}
 for(let axis=0;axis<3;axis++){if(accessor.min)accessor.min[axis]+=shift[axis];if(accessor.max)accessor.max[axis]+=shift[axis];}
}
const av=base.json.accessors.length,bv=base.json.bufferViews.length;
for(const v of raw.json.bufferViews)base.json.bufferViews.push({...v,byteOffset:(v.byteOffset||0)+base.bin.length,buffer:0});
for(const a of raw.json.accessors)base.json.accessors.push({...a,bufferView:a.bufferView+bv});
for(const a of raw.json.animations){a.name='idle-video-raw';for(const s of a.samplers){s.input+=av;s.output+=av;}for(const c of a.channels){const name=raw.json.nodes[c.target.node].name;c.target.node=base.json.nodes.findIndex(n=>n.name===name);if(c.target.node<0)throw Error('Unmatched bone '+name);}base.json.animations.push(a);}
const bin=Buffer.concat([base.bin,raw.bin]);base.json.buffers=[{byteLength:bin.length}];const j=Buffer.from(JSON.stringify(base.json)),padded=Buffer.alloc(Math.ceil(j.length/4)*4,32);j.copy(padded);
const h=Buffer.alloc(20);h.write('glTF');h.writeUInt32LE(2,4);h.writeUInt32LE(28+padded.length+bin.length,8);h.writeUInt32LE(padded.length,12);h.writeUInt32LE(0x4e4f534a,16);const bh=Buffer.alloc(8);bh.writeUInt32LE(bin.length,0);bh.writeUInt32LE(0x004e4942,4);
fs.writeFileSync('assets/idle-video-motion/boss-idle-diagnostic.glb',Buffer.concat([h,padded,bh,bin]));
console.log('Packaged current cleanup and raw Uthana video extraction on the approved mesh.');
