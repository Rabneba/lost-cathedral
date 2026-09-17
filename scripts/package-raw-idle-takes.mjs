// Keep the current corrected take; append untouched provider rotations/timing.
// Each raw take receives only one constant translation to the review floor.
import fs from 'node:fs';
import * as T from 'three';
import {loadGLB} from './load-glb-node.mjs';
function read(path){const b=fs.readFileSync(path),n=b.readUInt32LE(12);return{j:JSON.parse(b.subarray(20,20+n)),bin:Buffer.from(b.subarray(28+n))};}
function write(path,j,bin){j.buffers=[{byteLength:bin.length}];const s=Buffer.from(JSON.stringify(j)),p=Buffer.alloc(Math.ceil(s.length/4)*4,32);s.copy(p);const h=Buffer.alloc(20);h.write('glTF');h.writeUInt32LE(2,4);h.writeUInt32LE(28+p.length+bin.length,8);h.writeUInt32LE(p.length,12);h.writeUInt32LE(0x4e4f534a,16);const bh=Buffer.alloc(8);bh.writeUInt32LE(bin.length,0);bh.writeUInt32LE(0x004e4942,4);fs.writeFileSync(path,Buffer.concat([h,p,bh,bin]));}
const out='assets/idle-raw-comparison';fs.mkdirSync(out,{recursive:true});
const sources=[['idle-video-retry','docs/boss-idle-take2-result.json'],['idle-text-retry','docs/boss-idle-text2-result.json']];
const base=read('assets/idle-video-motion/boss-idle-video.glb');let chunks=[base.bin],length=base.bin.length;const reports=[];
for(const [name,resultPath]of sources){
 const result=JSON.parse(fs.readFileSync(resultPath)),path=result.saved.find(f=>f.path.endsWith('.glb')).path,raw=read(path);
 const av=base.j.accessors.length,bv=base.j.bufferViews.length;
 for(const v of raw.j.bufferViews)base.j.bufferViews.push({...v,byteOffset:(v.byteOffset||0)+length,buffer:0});
 for(const a of raw.j.accessors)base.j.accessors.push({...a,bufferView:a.bufferView+bv});
 for(const a of raw.j.animations){a.name=name;for(const s of a.samplers){s.input+=av;s.output+=av;}for(const c of a.channels){const n=raw.j.nodes[c.target.node].name;c.target.node=base.j.nodes.findIndex(b=>b.name===n);if(c.target.node<0)throw Error('Unmatched bone '+n);}base.j.animations.push(a);}
 chunks.push(raw.bin);length+=raw.bin.length;reports.push({name,generationId:result.id,source:path});
}
const bin=Buffer.concat(chunks),file=out+'/boss-raw-takes.glb';write(file,base.j,bin);
const scene=await loadGLB(file),mixer=new T.AnimationMixer(scene.scene);
scene.scene.updateMatrixWorld(true);const inverse=scene.scene.getObjectByName('mixamorigHips').parent.matrixWorld.clone().invert();
for(const report of reports){
 mixer.stopAllAction();const clip=scene.animations.find(a=>a.name===report.name),action=mixer.clipAction(clip);action.clampWhenFinished=true;action.setLoop(T.LoopOnce,1).play();const floors=[];
 for(let i=0;i<=16;i++){mixer.setTime(clip.duration*i/16);scene.scene.updateMatrixWorld(true);let low=Infinity;scene.scene.traverse(n=>{if(n.isSkinnedMesh){n.computeBoundingBox();low=Math.min(low,n.boundingBox.clone().applyMatrix4(n.matrixWorld).min.y);}});floors.push(low);}
 const ground=[...floors].sort((a,b)=>a-b)[8],shift=new T.Vector3(0,-ground,0).applyMatrix4(inverse).sub(new T.Vector3().applyMatrix4(inverse)).toArray();
 const a=base.j.animations.find(a=>a.name===report.name);
 const channel=a.channels.find(c=>c.target.path==='translation'&&base.j.nodes[c.target.node].name.replaceAll(':','')==='mixamorigHips');if(!channel)throw Error('No raw root translation');
 const acc=base.j.accessors[a.samplers[channel.sampler].output],v=base.j.bufferViews[acc.bufferView];if(acc.componentType!==5126||acc.type!=='VEC3')throw Error('Unexpected translation format');
 for(let i=0;i<acc.count;i++)for(let axis=0;axis<3;axis++){const offset=(v.byteOffset||0)+(acc.byteOffset||0)+i*(v.byteStride||12)+axis*4;bin.writeFloatLE(bin.readFloatLE(offset)+shift[axis],offset);}
 for(let axis=0;axis<3;axis++){if(acc.min)acc.min[axis]+=shift[axis];if(acc.max)acc.max[axis]+=shift[axis];}
 Object.assign(report,{duration:clip.duration,constantFloorOffset:ground,rawFloorRange:[Math.min(...floors),Math.max(...floors)]});
}
write(file,base.j,bin);fs.writeFileSync('docs/boss-raw-takes-package.json',JSON.stringify(reports,null,2));console.log(reports);
