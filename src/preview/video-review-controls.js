export function setupVideoReview(VIDEO_URL, VIDEO_FPS=24) {
const video=document.getElementById('video');
const toggle=document.getElementById('toggle');
const time=document.getElementById('time');
video.src=VIDEO_URL;
document.getElementById('download').href=VIDEO_URL;
const sync=()=>{
 toggle.textContent=video.paused?'Play':'Pause';
 time.textContent=Number.isFinite(video.duration)?`${video.currentTime.toFixed(2)} / ${video.duration.toFixed(2)} s`:'Loading…';
};
const play=()=>video.play().catch(sync);
const step=direction=>{video.pause();video.currentTime=Math.max(0,Math.min(video.duration||0,video.currentTime+direction/VIDEO_FPS));sync();};
toggle.addEventListener('click',()=>video.paused?play():video.pause());
document.getElementById('restart').addEventListener('click',()=>{video.currentTime=0;play();});
document.getElementById('back').addEventListener('click',()=>step(-1));
document.getElementById('next').addEventListener('click',()=>step(1));
document.getElementById('speed').addEventListener('change',event=>{video.playbackRate=Number(event.target.value);});
for(const event of ['loadedmetadata','timeupdate','play','pause','seeked','ended'])video.addEventListener(event,sync);
video.addEventListener('error',()=>{time.textContent='Video could not load. Try refreshing this page.';});
document.addEventListener('keydown',event=>{
 if(event.target.matches('input,select,button,a')||event.repeat)return;
 if(event.code==='Space'){event.preventDefault();video.paused?play():video.pause();}
 if(event.code==='ArrowLeft'||event.code==='ArrowRight'){event.preventDefault();step(event.code==='ArrowLeft'?-1:1);}
});
play();

}
