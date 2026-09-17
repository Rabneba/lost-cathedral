import {readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';

const brief=JSON.parse(await readFile('docs/boss-humanoid-briefs.json','utf8'));
let jobs=[];
try{jobs=JSON.parse(await readFile('docs/boss-humanoid-jobs.json','utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
for(const concept of brief.concepts){
  if(jobs.some(job=>job.key===concept.key&&job.id))continue;
  const args=['genex','image',brief.common+' '+concept.prompt,'--aspect','2:3','--size','1024x1536','--quality','medium','--out-dir','assets/boss-humanoid-concepts','--no-wait','--json'];
  const result=spawnSync('npx',args,{encoding:'utf8',timeout:180000});
  if(result.status!==0){console.error(result.stderr||result.stdout);spawnSync('npx',['genex','doctor'],{stdio:'inherit'});process.exit(1);}
  const output=JSON.parse(result.stdout);
  jobs.push({key:concept.key,number:concept.number,name:concept.name,...output});
  await writeFile('docs/boss-humanoid-jobs.json',JSON.stringify(jobs,null,2)+'\n');
  console.log(JSON.stringify({key:concept.key,...output}));
}
