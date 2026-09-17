import {readFile, writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';

const brief=JSON.parse(await readFile('docs/boss-greatsword-briefs.json','utf8'));
let jobs=[];
try { jobs=JSON.parse(await readFile('docs/boss-greatsword-jobs.json','utf8')); }
catch(error) { if(error.code!=='ENOENT')throw error; }

for(const concept of brief.concepts){
  if(jobs.some(job=>job.key===concept.key&&job.id))continue;
  const result=spawnSync('npx',[
    'genex','image',brief.common+'\n\n'+concept.prompt,
    '--edit',brief.reference,'--quality',brief.quality,'--no-wait','--json'
  ],{encoding:'utf8',timeout:180000});
  if(result.status!==0){
    console.error(result.stderr||result.stdout);
    spawnSync('npx',['genex','doctor'],{stdio:'inherit'});
    process.exit(1);
  }
  const job={key:concept.key,number:concept.number,name:concept.name,...JSON.parse(result.stdout)};
  jobs.push(job);
  await writeFile('docs/boss-greatsword-jobs.json',JSON.stringify(jobs,null,2)+'\n');
  console.log(JSON.stringify(job));
}
