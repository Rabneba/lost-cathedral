import fs from 'node:fs';import * as T from 'three';
import {loadGLB} from '../load-glb-node.mjs';
import {ActorAnimation} from '../../src/game/animation-controller.js';
import {SoleClearance} from '../../src/game/sole-clearance.js';
import {FootPlant} from '../../src/game/foot-plant.js';
import {cacheFeet,cachedPosition,CachedFootBlend} from './player_cached_foot_blend.mjs';
import meta from '../../docs/player-essential-manifest.json' with {type:'json'};
const asset='assets/production/player-essential.glb',g=await loadGLB(asset),built=cacheFeet(g.scene,g.animations);
const pos=(r,n)=>r.getObjectByName('mixamorig'+n).getWorldPosition(new T.Vector3());
const flex=(r,s)=>180-pos(r,s+'UpLeg').sub(pos(r,s+'Leg')).angleTo(pos(r,s+'Foot').sub(pos(r,s+'Leg')))*180/Math.PI;
const reference=new T.AnimationMixer(g.scene);let cacheError=0;
for(const clip of g.animations.filter(c=>built.cache.has(c.name))){const a=reference.clipAction(clip);a.play();a.paused=true;for(let i=0;i<37;i++){a.time=clip.duration*(i+.137)/37;reference.update(0);g.scene.updateMatrixWorld(true);for(const [j,side]of ['Left','Right'].entries())cacheError=Math.max(cacheError,cachedPosition(built.cache.get(clip.name),a.time,j,new T.Vector3()).distanceTo(pos(g.scene,side+'Foot')));}a.stop();}
const interrupted=['run-forward-left','walk-back-left','run-right','walk-forward-right','run-backward','walk-left','run-forward','walk-back-right'];
const report={asset,cache:{...built,cache:undefined,maximumPositionErrorMeters:cacheError},scenarios:{}};
for(const scenario of ['worst','interrupted','pure','raw','direct','action'])for(const enabled of [false,true]){
 const g=await loadGLB(asset),a=new ActorAnimation(g.scene,g.animations,meta),s=new SoleClearance(g.scene),floor=new FootPlant(g.scene,s),proto=new CachedFootBlend(g.scene,s,built.cache);
 const from='run-forward-left',to='walk-back-left';a.update(0,from,{speed:meta.clips[from].sourceSpeed});a.layers.get(from).time=meta.clips[from].duration*.375-.2;a.update(0,from,{speed:meta.clips[from].sourceSpeed});
 let previous=null,maxStep=0,minSole=Infinity,maxLayers=0,applied=0,maxDeltaWhenDisabled=0;const samples=[],rows=[];
 for(let frame=0;frame<180;frame++){
  const name=scenario==='pure'?from:scenario==='interrupted'?interrupted[Math.floor(frame/4)%interrupted.length]:frame<=12?from:to;
  const action=scenario==='action'?{name:'light',elapsed:Math.min(.5,frame/60)}:null;
  const begin=performance.now();a.update(frame?1/60:0,action?'light':name,{speed:meta.clips[name].sourceSpeed,action,duration:1.4});g.scene.updateMatrixWorld(true);
  const before=g.scene.getObjectByName('mixamorigLeftLeg').quaternion.clone();
  const t=performance.now();if(enabled)proto.apply(a,{rawPose:scenario==='raw',directClipTime:scenario==='direct'});const elapsed=performance.now()-t;
  if(proto.applied)applied++;else maxDeltaWhenDisabled=Math.max(maxDeltaWhenDisabled,Math.max(...before.toArray().map((v,i)=>Math.abs(v-g.scene.getObjectByName('mixamorigLeftLeg').quaternion.toArray()[i]))));
  floor.correct();const total=performance.now()-begin;
  if(frame>20)samples.push({prototypeMs:elapsed,totalMs:total});
  const feet=['Left','Right'].map(side=>flex(g.scene,side)),step=previous?Math.max(...feet.map((v,i)=>Math.abs(v-previous[i]))):0;previous=feet;maxStep=Math.max(maxStep,step);minSole=Math.min(minSole,s.minimumHeight());maxLayers=Math.max(maxLayers,a.layers.size);
  rows.push({frame,step,sole:s.minimumHeight(),applied:proto.applied,hip:pos(g.scene,'Hips').toArray(),chest:pos(g.scene,'Spine2').toArray(),feet:['Left','Right'].map(side=>pos(g.scene,side+'Foot').toArray())});
 }
 const quantile=(key,q)=>samples.map(s=>s[key]).sort((a,b)=>a-b)[Math.floor((samples.length-1)*q)];
 report.scenarios[scenario+(enabled?'-prototype':'-baseline')]={maxStep,minSole,maxLayers,applied,maxDeltaWhenDisabled,prototypeMedianMs:quantile('prototypeMs',.5),prototypeP95Ms:quantile('prototypeMs',.95),totalMedianMs:quantile('totalMs',.5),totalP95Ms:quantile('totalMs',.95),rows};
}
for(const name of ['worst','interrupted','pure','raw','direct','action']){
 const a=report.scenarios[name+'-baseline'].rows,b=report.scenarios[name+'-prototype'].rows;let hip=0,chest=0,foot=0;
 for(let i=0;i<a.length;i++){hip=Math.max(hip,new T.Vector3(...a[i].hip).distanceTo(new T.Vector3(...b[i].hip)));chest=Math.max(chest,new T.Vector3(...a[i].chest).distanceTo(new T.Vector3(...b[i].chest)));for(let side=0;side<2;side++)foot=Math.max(foot,new T.Vector3(...a[i].feet[side]).distanceTo(new T.Vector3(...b[i].feet[side])));}
 report.scenarios[name+'-prototype'].preservation={maxHipDifferenceMeters:hip,maxChestDifferenceMeters:chest,maxFootDifferenceMeters:foot};
}
fs.writeFileSync('docs/player-cached-foot-blend-audit.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({cache:report.cache,scenarios:Object.fromEntries(Object.entries(report.scenarios).map(([k,{rows,...v}])=>[k,v]))},null,2));
