import {runSpeedForDirection} from '../game/motion.js';

const directions=['forward','forward-left','left','back-left','backward','back-right','right','forward-right'];
/** Settled game pace for a single clip; transition previews use the runtime. */
export function gamePlaybackRate(character,name,metadata={}) {
 const clip=metadata.clips?.[name]||{};
 if(!/^(walk|run)-/.test(name)||!clip.sourceSpeed)return clip.rate??1;
 let speed=metadata.locomotionSpeed;
 if(character==='player'){
  const index=Math.max(0,directions.indexOf(name.replace(/^(walk|run)-/,''))),angle=index*Math.PI/4;
  speed=name.startsWith('walk-')?metadata.guardSpeed??1.45:
   runSpeedForDirection({x:Math.sin(angle),z:Math.cos(angle)},0,metadata);
 }
 return Math.min(1.4,Math.max(.5,speed/clip.sourceSpeed))*(clip.rate??1);
}
