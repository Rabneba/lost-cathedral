import test from 'node:test';import assert from 'node:assert/strict';import *as T from'three';import{loadGLB}from'../scripts/load-glb-node.mjs';import{PLAYER_TIMING,BOSS_TIMING,strikeIndex,sweptWeaponContact,bossWeaponPose,playerWeaponPose}from'../src/game/weapon-motion.js';
// Retained to protect the archived first combat bundle; current production
// assets are exercised separately in essential-assets.test.js.
for(const kind of['player','boss'])test(`archived ${kind} combat bundle: exported attacks preserve grip constraints and contact real combat distances`,async()=>{
 const g=await loadGLB(`assets/production/${kind}-combat.glb`),mix=new T.AnimationMixer(g.scene),socket=g.scene.getObjectByName('WeaponSocket');assert.ok(socket);
 for(const[name,s]of Object.entries(kind==='boss'?BOSS_TIMING:PLAYER_TIMING)){
  const clip=g.animations.find(c=>c.name===name);assert.ok(clip);const a=mix.clipAction(clip).play();let prev=null,contacts=0,farContacts=0;
  const distance=kind==='boss'?2.3:1.7,cap=[[0,.45,distance],[0,kind==='boss'?1.5:2.1,distance]];
  for(let t=0;t<s.windup+s.active+s.recovery;t+=1/120){a.time=t;mix.update(0);g.scene.updateMatrixWorld(true);
   const matrix=socket.matrixWorld.clone().multiply(new T.Matrix4().makeRotationX(Math.PI/2));
   const expected=(kind==='boss'?bossWeaponPose:playerWeaponPose)(name,t),p=new T.Vector3().setFromMatrixPosition(matrix);
   if(kind==='player')assert.ok(p.distanceTo(new T.Vector3(...expected.position))<.04,`${name} socket discontinuity at ${t}`);
   else for(const side of ['Right','Left']){
    const wrist=g.scene.getObjectByName('mixamorig'+side+'Hand').getWorldPosition(new T.Vector3());
    const knuckle=g.scene.getObjectByName('mixamorig'+side+'HandMiddle1').getWorldPosition(new T.Vector3());
    const palm=wrist.lerp(knuckle,.62),grip=new T.Vector3(0,side==='Right'?.6:1.16,0).applyMatrix4(matrix);
    assert.ok(palm.distanceTo(grip)<.02,`${name} ${side} grip separates at ${t}: ${palm.distanceTo(grip)}`);
   }
   const ends=kind==='boss'?[[.18,3.12,-.12],[.93,2.65,-.2]]:[[0,.28,0],[0,1.27,0]];
   const seg=ends.map(v=>new T.Vector3(...v).applyMatrix4(matrix).toArray());
   if(strikeIndex(name,t,kind==='boss')>=0){if(sweptWeaponContact(prev,seg,cap,kind==='boss'?.42:.54))contacts++;if(sweptWeaponContact(prev,seg,[[0,.45,4],[0,1.8,4]],.54))farContacts++;}prev=seg;
  }
  assert.ok(contacts>1,`${name} must be able to hit at ${distance}m`);assert.equal(farContacts,0,`${name} must miss at 4m`);a.stop();
 }
 const idle=mix.clipAction(g.animations.find(c=>c.name==='idle')).play();idle.time=.3;mix.update(0);g.scene.updateMatrixWorld(true);let body;g.scene.traverse(n=>{if(n.isSkinnedMesh)body=n});body.skeleton.update();body.computeBoundingBox();const box=body.boundingBox.clone().applyMatrix4(body.matrixWorld);assert.ok(box.max.y<3&&box.min.y>-.15);assert.ok(box.max.z-box.min.z<.9, 'armor must not stretch into a spike');
});
