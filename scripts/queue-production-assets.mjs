import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
const jobsFile='docs/production-jobs.json';
const jobs=fs.existsSync(jobsFile)?JSON.parse(fs.readFileSync(jobsFile)):{};
const batches={
 bossBody:['model','Create the exact armored Death body from the image. Preserve blue-black hood with deep black enclosed face cavity, cool worn silver scale pauldrons and fluted gothic armor. Normal human anatomy, empty hands A pose, no weapon and no loose fabric. Front toward +Z.','--image','assets/armored-death-body-input.png','--texture','detailed','--geometry','detailed','--face-limit','60000'],
 cathedralStone:['texture','Ancient gothic cathedral limestone masonry surface, cold desaturated charcoal grey, deeply pitted worn stone, subtle fine cracks, soot and faint mineral deposits, physically realistic PBR, no large objects, no symbols, even albedo illumination','--terrain'],
 cathedralFloor:['texture','Ancient dark cathedral flagstone floor, large irregular weathered grey limestone slabs, narrow deep seams, tiny chips, ash in crevices, subtle damp rough patches, photorealistic PBR, no vegetation, no large rubble, flat neutral albedo lighting','--terrain'],
 lament:['music','Seamless loop, no intro or outro. Dark gothic boss battle instrumental, slow ominous orchestral strings and low wordless male choir in a vast ruined cathedral, tolling distant bells, heavy measured timpani, mournful powerful restrained intensity, no modern drums, no vocals or lyrics, realistic acoustic recording','--duration','90'],
 impact:['sfx','One powerful heavy steel scythe impact against battered plate armor, deep blunt metallic clang, short sharp transient, grit and debris, dark realistic medieval combat, no voice','--duration','2'],
 swing:['sfx','One heavy two-handed scythe swing whoosh, long steel blade sweeping fast through air, deep forceful realistic close perspective, no impact or voice','--duration','1.5']
};
for(const [key,args] of Object.entries(batches)) {
 if(jobs[key])continue;
 const r=spawnSync('npx',['genex',...args,'--no-wait','--json'],{encoding:'utf8'});
 console.log(key,r.stdout,r.stderr);
 if(r.status!==0){spawnSync('npx',['genex','doctor'],{stdio:'inherit'});break;}
 try{jobs[key]={args,result:JSON.parse(r.stdout),queuedAt:new Date().toISOString()};fs.writeFileSync(jobsFile,JSON.stringify(jobs,null,2));}catch(e){console.error(e);break;}
}
