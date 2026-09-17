import {loadGLB} from './load-glb-node.mjs';import * as T from 'three';import{PLAYER_TIMING,BOSS_TIMING,strikeIndex,sweptWeaponContact}from'../src/game/weapon-motion.js';
for(const kind of ['player','boss']){
const g=await loadGLB(`assets/production/${kind}-combat.glb`),mixer=new T.AnimationMixer(g.scene),socket=g.scene.getObjectByName('WeaponSocket');
for(const [name,timing]of Object.entries(kind==='boss'?BOSS_TIMING:PLAYER_TIMING)){
 const a=mixer.clipAction(g.animations.find(c=>c.name===name));a.play();const result={};
 for(const distance of [1.6,1.8,2,2.3,2.65,3]){let prev=null,hits=0,minY=Infinity,maxReach=0;
 for(let time=0;time<timing.windup+timing.active+timing.recovery;time+=1/120){a.time=time;mixer.update(0);g.scene.updateMatrixWorld(true);const mat=socket.matrixWorld.clone().multiply(new T.Matrix4().makeRotationX(Math.PI/2));const coords=kind==='boss'?[[.18,3.12,-.12],[.93,2.65,-.2]]:[[0,.28,0],[0,1.27,0]];const curr=coords.map(p=>new T.Vector3(...p).applyMatrix4(mat).toArray());if(strikeIndex(name,time,kind==='boss')>=0){maxReach=Math.max(maxReach,...curr.map(p=>p[2]));minY=Math.min(minY,...curr.map(p=>p[1]));if(sweptWeaponContact(prev,curr,[[0,.45,distance],[0,kind==='boss'?1.5:2.1,distance]],kind==='boss'?.42:.54))hits++;}prev=curr;}
 result[distance]={contactFrames:hits,minY:+minY.toFixed(2),maxReach:+maxReach.toFixed(2)};
 }a.stop();console.log(kind,name,JSON.stringify(result));
}}
