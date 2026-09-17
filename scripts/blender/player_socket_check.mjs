import {loadGLB} from '../load-glb-node.mjs';import * as T from 'three';
const g=await loadGLB('assets/production/player-combat.glb'),m=new T.AnimationMixer(g.scene),a=m.clipAction(g.animations.find(a=>a.name==='idle'));a.play();a.time=0;m.update(0);g.scene.updateMatrixWorld(true);const c=new T.Matrix4().makeRotationX(Math.PI/2);
for(const n of ['WeaponSocket','ShieldSocket','mixamorigRightHand']){const b=g.scene.getObjectByName(n);console.log(n,JSON.stringify(c.clone().multiply(b.matrixWorld).multiply(c.clone().invert()).elements));}
