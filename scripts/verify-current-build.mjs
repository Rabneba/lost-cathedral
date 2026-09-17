import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {ASSETS} from '../src/game/asset-paths.js';

const root=fileURLToPath(new URL('..',import.meta.url));
process.chdir(root);
const report={startedAt:new Date().toISOString(),assets:{},stages:[],passed:false};
const sourceFiles=(await fs.readdir('src',{recursive:true})).filter(name=>/\.(js|css)$/.test(name)).map(name=>'src/'+name)
 .concat(['index.html','animation-review.html','motion-videos.html']).sort();
const sourceHash=createHash('sha256');
for(const path of sourceFiles)sourceHash.update(path+'\0').update(await fs.readFile(path)).update('\0');
report.sourceTreeSha256=sourceHash.digest('hex');report.sourceFileCount=sourceFiles.length;
for(const kind of ['player','boss']){
 const path=fileURLToPath(ASSETS[kind+'Rig']);
 report.assets[kind]={path,sha256:createHash('sha256').update(await fs.readFile(path)).digest('hex'),
  metadataSha256:createHash('sha256').update(JSON.stringify(ASSETS.motion[kind])).digest('hex')};
}
const stages=[
 ['tests','npm',['test']],
 ['skin-grounding','node',['scripts/audit-runtime-soles.mjs']],
 ['boss-support','node',['scripts/audit-boss-support.mjs']],
 ['foot-contact-events','node',['scripts/audit-foot-feedback.mjs']],
 ['encounter','node',['scripts/simulate-encounter.mjs']],
 ['build','npm',['run','build']],
];
for(const [name,command,args] of stages){
 const start=performance.now(),logPath=`docs/verification-${name}.log`;let output='';
 process.stdout.write(`Checking ${name}…\n`);
 const code=await new Promise(resolve=>{
  const child=spawn(command,args,{cwd:root,stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',data=>{output+=data;});child.stderr.on('data',data=>{output+=data;});
  child.on('error',error=>{output+=String(error);resolve(-1);});
  child.on('close',code=>resolve(code??-1));
 });
 await fs.writeFile(logPath,output);
 report.stages.push({name,command:[command,...args],exitCode:code,durationSeconds:+((performance.now()-start)/1000).toFixed(3),log:logPath});
 process.stdout.write(`${name}: ${code===0?'passed':'FAILED'} (${report.stages.at(-1).durationSeconds}s)\n`);
 if(code!==0){process.stderr.write(output.slice(-5000));break;}
}
report.completedAt=new Date().toISOString();
report.passed=report.stages.length===stages.length&&report.stages.every(stage=>stage.exitCode===0);
report.scope='Automated runtime/build checks on the selected assets. Browser play, visual motion review and measured rendering performance are separate evidence in docs/combat-revision/root-visual-review-20260915.md.';
await fs.writeFile('docs/current-build-verification.json',JSON.stringify(report,null,2)+'\n');
if(!report.passed)process.exitCode=1;
