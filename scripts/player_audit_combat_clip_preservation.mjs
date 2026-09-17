import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {loadGLB} from './load-glb-node.mjs';
const base=process.env.VESPER_COMPARE_BASE||'assets/player-combat-revision/player-video-candidate-v2.glb',latest=process.env.VESPER_COMPARE_CANDIDATE||'assets/player-combat-revision/player-video-candidate-v5.glb';
const [a,b]=await Promise.all([loadGLB(base),loadGLB(latest)]),rows=[];
for(const old of a.animations){const clip=b.animations.find(c=>c.name===old.name);let changed=0,maxDelta=0;for(const track of old.tracks){const other=clip.tracks.find(t=>t.name===track.name);if(!other||other.values.length!==track.values.length){changed++;continue;}let delta=0;for(let i=0;i<track.values.length;i++)delta=Math.max(delta,Math.abs(track.values[i]-other.values[i]));if(delta>0)changed++;maxDelta=Math.max(maxDelta,delta);}rows.push({clip:old.name,changedTracks:changed,maxValueDifference:maxDelta,durationDelta:clip.duration-old.duration});}
const report={createdAt:new Date().toISOString(),source:base,asset:latest,sha256:createHash('sha256').update(await fs.readFile(latest)).digest('hex'),scope:'Exact floating-point track comparison; only explicitly allowed clips may differ.',rows,passed:rows.every(r=>(process.env.VESPER_COMPARE_CHANGED||'heavy,block').split(',').includes(r.clip)||(!r.changedTracks&&!r.durationDelta))};
await fs.writeFile(process.env.VESPER_COMPARE_REPORT||'docs/player-combat-revision/candidate-v5-revision-scope-audit.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
