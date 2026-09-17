// Renders capture jobs inside an already-running browser tab (see scripts/capture-server.mjs).
// The page steps its own simulation with fixed 1/60 s ticks, so it works in a hidden tab where
// requestAnimationFrame never fires, and posts each frame back to the local capture server.
export function startCaptureWorker(api,server='http://127.0.0.1:5199'){
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 const post=(url,body,headers={})=>fetch(server+url,{method:'POST',headers,body});
 const runJs=async code=>{try{return await (new Function('return (async()=>{'+code+'\n})()'))();}catch(first){return await (new Function('return (async()=>{return ('+code+')})()'))();}};
 async function runJob(job){
  const errors=[],o=job.options||{};
  const onError=event=>errors.push(String(event.reason||event.message||event));
  addEventListener('error',onError);addEventListener('unhandledrejection',onError);
  try{
   api.prepare({quality:o.quality||'high',width:o.width||1600,height:o.height||900,menu:!!o.menu,hud:o.hud!==false,gizmos:!!o.gizmos});
   if(o.setup)await runJs(o.setup);
   api.advance((o.settle??3000)/1000);
   for(let index=0;index<job.shots.length;index++){
    const shot=job.shots[index];
    try{
     if(shot.js)await runJs(shot.js);
     if(!o.menu)api.setView({yaw:(shot.yaw||0)*Math.PI/180,pitch:shot.pitch,distance:shot.distance,lock:!!shot.lock});
     api.advance((shot.wait||2500)/1000);
     const state=api.state();
     const blob=await api.capture(o.png?'image/png':'image/jpeg');
     await post(`/job/${job.id}/shot/${index}`,blob,{'content-type':blob.type,'x-shot-state':btoa(unescape(encodeURIComponent(JSON.stringify(state))))});
    }catch(error){errors.push(`${shot.name}: ${error.message}`);}
   }
  }catch(error){errors.push(String(error.message||error));}
  finally{removeEventListener('error',onError);removeEventListener('unhandledrejection',onError);api.finish();}
  await post(`/job/${job.id}/done`,JSON.stringify({errors}),{'content-type':'application/json'});
 }
 (async()=>{
  console.log('[capture-worker] polling',server);
  for(;;){
   try{
    const response=await fetch(`${server}/job/next?kind=game&wait=25000`);
    if(response.status===200){const job=await response.json();console.log('[capture-worker] job',job.id,job.shots.length,'shots');await runJob(job);}
    else if(response.status!==204)await sleep(1000);
   }catch(error){await sleep(2000);}
  }
 })();
}
