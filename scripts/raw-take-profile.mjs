// Frame profile of a raw Uthana take bound to the base rig: sword-hand speed relative to the
// hips, pelvis yaw and hand position, to choose trims. VESPER_RAW (comma list), VESPER_EVERY.
import {AnimationMixer, Vector3, MathUtils} from 'three';
import {loadGLB} from './load-glb-node.mjs';
const FPS=30,EVERY=+(process.env.VESPER_EVERY||3);
for(const raw of (process.env.VESPER_RAW||'').split(',').filter(Boolean)){
 const gltf=await loadGLB(raw),scene=gltf.scene,clip=gltf.animations[0];scene.updateMatrixWorld(true);
 const b=n=>scene.getObjectByName('mixamorig'+n)||scene.getObjectByName('mixamorig:'+n),P=n=>b(n).getWorldPosition(new Vector3());
 const mixer=new AnimationMixer(scene),action=mixer.clipAction(clip);action.play();const frames=Math.round(clip.duration*FPS);
 const rows=[];let prev=null;
 for(let f=0;f<=frames;f++){action.time=Math.min(clip.duration-1e-4,f/FPS);mixer.update(0);scene.updateMatrixWorld(true);
  const hips=P('Hips'),hand=P('RightHand').sub(hips),l=P('LeftUpLeg'),r=P('RightUpLeg');const fwd=l.clone().sub(r).setY(0).normalize().cross(new Vector3(0,1,0));
  const yaw=MathUtils.radToDeg(Math.atan2(fwd.x,fwd.z));const speed=prev?hand.distanceTo(prev)*FPS:0;prev=hand.clone();rows.push({f,speed,yaw,hand});}
 const peak=Math.max(...rows.map(r=>r.speed));
 console.log(`\n${raw}: ${frames} frames, hand peak ${peak.toFixed(2)} m/s`);console.log('  f   t    speed  %peak  pelvisYaw  hand(x,y,z rel hips)');
 for(const r of rows)if(r.f%EVERY===0)console.log(String(r.f).padStart(3),(r.f/FPS).toFixed(2).padStart(5),r.speed.toFixed(2).padStart(7),(100*r.speed/peak).toFixed(0).padStart(6),r.yaw.toFixed(0).padStart(10),`  ${r.hand.x.toFixed(2)},${r.hand.y.toFixed(2)},${r.hand.z.toFixed(2)}`);
}
