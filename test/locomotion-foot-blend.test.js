import test from 'node:test';import assert from 'node:assert/strict';import * as T from 'three';
import {loadGLB} from '../scripts/load-glb-node.mjs';import {createActor} from '../src/game/actors.js';
import {cacheFeet,cachedPosition} from '../src/game/locomotion-foot-blend.js';
import metadata from '../docs/player-essential-manifest.json' with {type:'json'};
const asset='assets/production/player-essential.glb';
const position=(actor,name)=>actor.body.getObjectByName('mixamorig'+name).getWorldPosition(new T.Vector3());
function flex(actor,side){const a=position(actor,side+'UpLeg'),b=position(actor,side+'Leg'),c=position(actor,side+'Foot');return 180-a.sub(b).angleTo(c.sub(b))*180/Math.PI;}
function delta(name,speed,yaw=0){return new T.Vector3(name.includes('left')?1:name.includes('right')?-1:0,0,name.includes('forward')?1:name.includes('back')?-1:0).normalize().multiplyScalar(speed/60).applyAxisAngle(new T.Vector3(0,1,0),yaw);}
async function pair(){const actors=await Promise.all([0,1].map(async()=>createActor(await loadGLB(asset),1.85,false,true,metadata)));actors[0].locomotionFootBlend=null;return actors;}
function pose(actor){const values=[];actor.body.traverse(n=>{if(n.isBone)values.push(...n.matrixWorld.elements);});return values;}
function sameUpperBody(a,b){
 for(const n of ['Hips','Spine2','LeftHand','RightHand']){
  const x=a.body.getObjectByName('mixamorig'+n),y=b.body.getObjectByName('mixamorig'+n);
  assert.deepEqual(x.matrix.elements,y.matrix.elements,'native bone pose');
  for(let i=0;i<16;i++)if(i!==13)assert.equal(x.matrixWorld.elements[i],y.matrixWorld.elements[i]);
  const difference=x.matrixWorld.elements[13]-y.matrixWorld.elements[13],fallback=a.visualRoot.position.y-b.visualRoot.position.y;
  assert.ok(Math.abs(difference-fallback)<1e-12,'only the existing final floor lift may differ');assert.ok(Math.abs(fallback)<.000101);
 }
}

test('cached local foot paths stay submillimetre accurate without copying mesh data',async()=>{
 const g=await loadGLB(asset),result=cacheFeet(g.scene,g.animations),mixer=new T.AnimationMixer(g.scene);let error=0;
 assert.equal(result.cache.size,16);assert.ok(result.bytes<65536);
 for(const clip of g.animations.filter(c=>result.cache.has(c.name))){const a=mixer.clipAction(clip);a.play();a.paused=true;
  for(let i=0;i<23;i++){a.time=clip.duration*(i+.137)/23;mixer.update(0);g.scene.updateMatrixWorld(true);
   for(const [side,name]of ['Left','Right'].entries())error=Math.max(error,cachedPosition(result.cache.get(clip.name),a.time,side,new T.Vector3()).distanceTo(g.scene.getObjectByName('mixamorig'+name+'Foot').getWorldPosition(new T.Vector3())));
  }a.stop();
 }assert.ok(error<.0005,`cache position error ${error}`);
});

test('the actual actor hook smooths the difficult reversal while preserving pelvis, chest and hands',async()=>{
 const actors=await pair(),from='run-forward-left',to='walk-back-left',peaks=[0,0],motion={x:0,z:0,yaw:0};
 const previous=actors.map(actor=>{actor.reset(motion);actor.moveDirection='forward-left';actor.moving=true;actor.animation.update(0,from,{speed:metadata.clips[from].sourceSpeed});actor.animation.layers.get(from).time=metadata.clips[from].duration*.375;actor.animation.update(0,from,{speed:metadata.clips[from].sourceSpeed});actor.root.updateMatrixWorld(true);actor.footPlant.correct();return ['Left','Right'].map(s=>flex(actor,s));});
 for(let frame=0;frame<20;frame++){
  const d=delta(to,metadata.clips[to].sourceSpeed);motion.x+=d.x;motion.z+=d.z;
  actors.forEach((actor,index)=>{actor.update(1/60,frame/60,{health:100,blocking:true,action:null},motion);const angles=['Left','Right'].map(s=>flex(actor,s));peaks[index]=Math.max(peaks[index],...angles.map((v,j)=>Math.abs(v-previous[index][j])));previous[index]=angles;});
  sameUpperBody(actors[0],actors[1]);
  assert.ok(actors[1].soleClearance.minimumHeight()>-.001);
 }assert.ok(peaks[1]<peaks[0]*.75&&peaks[1]<11,`baseline ${peaks[0]}, corrected ${peaks[1]}`);
});

test('pure flight, raw/direct inspection, actions and stop transitions retain the same actor pose',async()=>{
 const actors=await pair();
 for(const mode of ['pure','raw','direct','action','stop']){
  const motion={x:0,z:0,yaw:.6};actors.forEach(a=>a.reset(motion));let flight=false;
  for(let frame=0;frame<70;frame++){
   let action=null;const elapsed=frame/60;
   if(mode==='raw'||mode==='direct')action={name:'run-forward-left',elapsed,directClipTime:true,...(mode==='raw'?{rawPose:true}:{})};
   if(mode==='action'&&frame>12)action={name:'light',elapsed:(frame-12)/60};
   if(mode!=='stop'||frame<12){const d=delta('run-forward',metadata.clips['run-forward'].sourceSpeed,motion.yaw);motion.x+=d.x;motion.z+=d.z;}
   actors.forEach(a=>a.update(1/60,elapsed,{health:100,blocking:false,action},motion));
   assert.equal(actors[1].locomotionFootBlend.applied,false,mode);assert.deepEqual(pose(actors[1]),pose(actors[0]),mode);
   flight ||= actors[1].soleClearance.minimumHeight()>.01;
  }if(mode==='pure')assert.ok(flight,'authored running flight must remain');
 }
});

test('rapid interrupted directions remain grounded in a translated and rotated actor',async()=>{
 const actors=await pair(),names=['run-forward-left','walk-back-left','run-right','walk-forward-right','run-backward','walk-left','run-forward','walk-back-right'],motion={x:12,z:-7,yaw:1.1};actors.forEach(a=>a.reset(motion));let maxLayers=0,applied=0;
 for(let frame=0;frame<160;frame++){
  const name=names[Math.floor(frame/4)%names.length],d=delta(name,metadata.clips[name].sourceSpeed,motion.yaw);motion.x+=d.x;motion.z+=d.z;
  actors.forEach(a=>a.update(1/60,frame/60,{health:100,blocking:name.startsWith('walk-'),action:null},motion));
  const corrected=actors[1];assert.equal(corrected.animation.current,name);assert.ok(corrected.soleClearance.minimumHeight()>-.001);maxLayers=Math.max(maxLayers,corrected.animation.layers.size);applied+=Number(corrected.locomotionFootBlend.applied);
  sameUpperBody(actors[0],corrected);
 }assert.ok(maxLayers>=6&&applied>100);
});
