// Capture bridge for the machine state where no headless Chromium can start (macOS directory
// services broken: confstr() fails, Chrome's sandbox setup CHECKs, 16 Sep 2026). A tab in the
// user's already-running Chrome loads the game or the studio with ?capture-worker=1, long-polls
// this server for jobs, renders each shot with its own WebGL context (hidden tabs still render,
// only requestAnimationFrame is throttled, so the page steps its simulation by hand) and POSTs
// the JPEG back. Clients: scripts/game-shot.mjs and scripts/studio-shot.mjs.
//   node scripts/capture-server.mjs            (default 127.0.0.1:5199, VESPER_CAPTURE_PORT)
import http from 'node:http';
import {mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
const PORT=Number(process.env.VESPER_CAPTURE_PORT||5199),ROOT=process.cwd();
const queues={game:[],studio:[]},waiters={game:[],studio:[]},jobs=new Map();let nextId=1;
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'content-type,x-shot-state','Access-Control-Allow-Methods':'GET,POST,OPTIONS'};
const json=(res,code,body)=>{res.writeHead(code,{...cors,'content-type':'application/json'});res.end(JSON.stringify(body));};
const readBody=req=>new Promise(resolve=>{const chunks=[];req.on('data',c=>chunks.push(c));req.on('end',()=>resolve(Buffer.concat(chunks)));});
const safeOut=out=>{const abs=path.resolve(ROOT,out);if(!abs.startsWith(ROOT)&&!abs.startsWith('/private/tmp')&&!abs.startsWith('/tmp'))throw new Error('out must be inside the project or /tmp');return abs;};
function wake(kind){const w=waiters[kind].shift();if(w)w();}
const STALE_MS=90000,MAX_ATTEMPTS=4;
function requeueStaleGameJobs(){const now=Date.now();for(const job of jobs.values()){if(job.kind!=='game'||job.status!=='running')continue;if(now-(job.lastActivity||0)>STALE_MS){job.attempts=(job.attempts||0)+1;if(job.attempts>=MAX_ATTEMPTS){job.status='failed';job.errors.push('worker tab kept dropping the job (page reloads?)');continue;}job.status='queued';queues.game.unshift(job.id);}}}
function nextStudioShot(){const now=Date.now();
 for(const job of jobs.values()){if(job.kind!=='studio'||job.status==='done'||job.status==='failed')continue;for(const [index,at] of Object.entries(job.pending||{}))if(!job.results[index]&&now-at>STALE_MS){job.pending[index]=now;job.attempts=(job.attempts||0)+1;if(job.attempts>=MAX_ATTEMPTS*job.shots.length){job.status='failed';job.errors.push('studio worker tab kept dropping shots');break;}job.status='running';return {id:job.id,index:Number(index),params:job.shots[index].params};}}
 for(const id of queues.studio){const job=jobs.get(id);if(job.nextShot<job.shots.length){const index=job.nextShot++;job.status='running';job.pending=job.pending||{};job.pending[index]=now;return {id,index,params:job.shots[index].params};}}return null;}
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://127.0.0.1');
  if(req.method==='OPTIONS'){res.writeHead(204,cors);return res.end();}
  if(url.pathname==='/health')return json(res,200,{ok:true,queued:{game:queues.game.length,studio:queues.studio.length},jobs:jobs.size});
  if(req.method==='POST'&&url.pathname==='/job'){
   const body=JSON.parse((await readBody(req)).toString('utf8'));const id=String(nextId++);
   const job={id,kind:body.kind==='studio'?'studio':'game',out:safeOut(body.out||'docs/game-captures'),options:body.options||{},shots:body.shots||[],results:[],errors:[],status:'queued',nextShot:0,createdAt:Date.now()};
   mkdirSync(job.out,{recursive:true});jobs.set(id,job);queues[job.kind].push(id);wake(job.kind);return json(res,200,{id});
  }
  if(req.method==='GET'&&url.pathname==='/job/next'){
   const kind=url.searchParams.get('kind')==='studio'?'studio':'game',wait=Math.min(60000,Number(url.searchParams.get('wait')||25000));
   const take=()=>{if(kind==='game'){requeueStaleGameJobs();const id=queues.game.shift();if(!id)return null;const job=jobs.get(id);job.status='running';job.lastActivity=Date.now();return {id,out:job.out,options:job.options,shots:job.shots};}const shot=nextStudioShot();if(shot){const job=jobs.get(shot.id);if(job.nextShot>=job.shots.length)queues.studio.shift();}return shot;};
   let item=take();
   if(!item){await new Promise(resolve=>{const timer=setTimeout(()=>{const i=waiters[kind].indexOf(resolve);if(i>=0)waiters[kind].splice(i,1);resolve();},wait);waiters[kind].push(()=>{clearTimeout(timer);resolve();});});item=take();}
   if(!item){res.writeHead(204,cors);return res.end();}
   return json(res,200,item);
  }
  const shot=url.pathname.match(/^\/job\/(\d+)\/shot\/(\d+)$/);
  if(req.method==='POST'&&shot){
   const job=jobs.get(shot[1]);if(!job)return json(res,404,{error:'no such job'});
   const index=Number(shot[2]),spec=job.shots[index];if(!spec)return json(res,400,{error:'no such shot'});
   const body=await readBody(req),type=req.headers['content-type']||'image/jpeg';
   let state={};try{state=JSON.parse(Buffer.from(req.headers['x-shot-state']||'','base64').toString('utf8')||'{}');}catch{}
   const file=path.join(job.out,`${spec.name}.${type.includes('png')?'png':'jpg'}`);writeFileSync(file,body);
   job.results[index]={...spec,file,...state};job.lastActivity=Date.now();if(job.pending)delete job.pending[index];
   if(job.kind==='studio'&&job.results.filter(Boolean).length>=job.shots.length){job.status='done';const q=queues.studio.indexOf(job.id);if(q>=0)queues.studio.splice(q,1);}
   return json(res,200,{ok:true});
  }
  const done=url.pathname.match(/^\/job\/(\d+)\/(done|fail)$/);
  if(req.method==='POST'&&done){
   const job=jobs.get(done[1]);if(!job)return json(res,404,{error:'no such job'});
   let body={};try{body=JSON.parse((await readBody(req)).toString('utf8')||'{}');}catch{}
   if(Array.isArray(body.errors))job.errors.push(...body.errors);if(body.error)job.errors.push(String(body.error));
   job.status=done[2]==='done'?'done':'failed';return json(res,200,{ok:true});
  }
  const get=url.pathname.match(/^\/job\/(\d+)$/);
  if(req.method==='GET'&&get){const job=jobs.get(get[1]);if(!job)return json(res,404,{error:'no such job'});return json(res,200,{id:job.id,kind:job.kind,status:job.status,results:job.results,errors:job.errors,shots:job.shots.length});}
  json(res,404,{error:'unknown route'});
 }catch(error){json(res,500,{error:error.message});}
});
server.listen(PORT,'127.0.0.1',()=>console.log(`capture server on http://127.0.0.1:${PORT} (cwd ${ROOT})`));
