import * as T from 'three';
import {loadGLB} from './load-glb-node.mjs';
const path=process.env.VESPER_BOSS_CANDIDATE||'assets/combat-revision/boss/boss-combat-candidate.glb';
const gltf=await loadGLB(path);
const worldScale=1.3;gltf.scene.scale.multiplyScalar(worldScale);
const mixer=new T.AnimationMixer(gltf.scene),probes=[];
gltf.scene.traverse(mesh=>{if(!mesh.isSkinnedMesh)return;const a=mesh.geometry.attributes;
 for(let i=0;i<a.position.count;i++){let weight=0;for(let j=0;j<4;j++)if(/Foot|ToeBase/.test(mesh.skeleton.bones[a.skinIndex.getComponent(i,j)].name))weight+=a.skinWeight.getComponent(i,j);if(weight>.6)probes.push([mesh,i]);}
});
for(const name of ['idle','sweep','slam']){
 const clip=gltf.animations.find(c=>c.name===name);if(!clip)continue;
 mixer.stopAllAction();const action=mixer.clipAction(clip);action.play();action.setLoop(T.LoopOnce);action.clampWhenFinished=true;
 let worst={minimum:Infinity};const rows=[];
 for(let frame=0;frame<=Math.ceil(clip.duration*60);frame++){
  const time=Math.min(clip.duration,frame/60);action.time=time;mixer.update(0);gltf.scene.updateMatrixWorld(true);let minimum=Infinity;const p=new T.Vector3();for(const [m,i]of probes)minimum=Math.min(minimum,m.getVertexPosition(i,p).applyMatrix4(m.matrixWorld).y);
  if(minimum<worst.minimum)worst={time,minimum};
  if(frame%30===0)rows.push({time,minimum});
 }
 console.log(JSON.stringify({path,worldScale,name,duration:clip.duration,worst,rows}));
}
