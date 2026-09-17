import * as T from 'three';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {loadGLB} from './load-glb-node.mjs';
import {ASSETS} from '../src/game/asset-paths.js';
import {weaponSegmentFor} from '../src/game/actors.js';
import {sweptWeaponContact} from '../src/game/weapon-motion.js';
const path=process.env.VESPER_BOSS_CANDIDATE||'assets/combat-revision/boss/boss-combat-candidate.glb';
const timing=process.env.VESPER_BOSS_TIMING?JSON.parse(await fs.readFile(process.env.VESPER_BOSS_TIMING,'utf8')):null;
const g=await loadGLB(path),mixer=new T.AnimationMixer(g.scene),socket=g.scene.getObjectByName('WeaponSocket');
const root=new T.Group();root.add(g.scene);const aimYawDegrees=Number(process.env.VESPER_BOSS_AIM_YAW_DEG||0);root.rotation.y=T.MathUtils.degToRad(aimYawDegrees);
g.scene.scale.multiplyScalar(1.3);
const weapon=new T.Group();weapon.rotation.x=Math.PI/2;socket.add(weapon);
const result={path,sha256:createHash('sha256').update(await fs.readFile(path)).digest('hex'),worldScale:1.3,aimYawDegrees,contactRadius:.42,clips:{}};
for(const [name,defaultWindow]of Object.entries({sweep:[1.65,2.8],slam:[2,2.8]})){
 const spec=timing?.clips?.[name];
 const windows=spec?.hitWindows|| (spec?[[spec.windup,spec.windup+spec.active]]:[defaultWindow]);
 const clip=g.animations.find(c=>c.name===name);if(!clip)continue;
 mixer.stopAllAction();const action=mixer.clipAction(clip);action.play();action.setLoop(T.LoopOnce);action.clampWhenFinished=true;
 const rows=[];
 for(const distance of [1.4,1.55,1.75,2,2.25,2.47,2.6,2.75,3,3.1,3.2,3.25,3.35,3.5,3.75,4,4.25,6]){
  let previous=null;const hits=[];let minimum=Infinity,reach=0;
  for(let time=0;time<=action.getClip().duration;time+=1/120){
   action.time=time;mixer.update(0);root.updateMatrixWorld(true);
   const segment=weaponSegmentFor(true,ASSETS).map(p=>new T.Vector3(...p).applyMatrix4(weapon.matrixWorld).toArray());
   if(windows.some(window=>time>=window[0]&&time<=window[1])){minimum=Math.min(minimum,...segment.map(p=>p[1]));reach=Math.max(reach,...segment.map(p=>p[2]));if(sweptWeaponContact(previous,segment,[[0,.45,distance],[0,1.5,distance]],.42))hits.push(time);}
   previous=segment;
  }
  rows.push({distance,frames:hits.length,first:hits[0],last:hits.at(-1),minimumBladeY:minimum,maxForwardReach:reach});
 }
 result.clips[name]={windows,rows};
}
await fs.writeFile(process.env.VESPER_BOSS_CONTACT_REPORT||'docs/combat-revision/boss-candidate-contact.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
