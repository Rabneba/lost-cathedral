import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {createShieldDrop} from '../src/game/shield-drop.js';

function rig(){
 const scene=new T.Scene(),root=new T.Group(),hand=new T.Group();scene.add(root);root.add(hand);hand.position.set(.4,1.1,.2);
 const shield=new T.Group();shield.add(new T.Mesh(new T.BoxGeometry(.9,1.5,.06)));shield.rotation.set(.3,1.2,.1);hand.add(shield);
 scene.updateMatrixWorld(true);return {scene,root,hand,shield,actor:{root,shield,isBoss:false}};
}

test('the shield falls out of the hand, lands flat on the floor and returns on reset',()=>{
 const {scene,hand,shield,actor}=rig(),drop=createShieldDrop(actor);
 assert.ok(drop);
 drop.update(1/60,false,0);assert.equal(shield.parent,hand);
 let t=0,minY=Infinity;
 for(let i=0;i<60*6;i++){t+=1/60;drop.update(1/60,true,t);const box=new T.Box3().setFromObject(shield);minY=Math.min(minY,box.min.y);}
 assert.equal(shield.parent,scene);
 assert.ok(minY>-.03,`sank ${minY}`);
 const box=new T.Box3().setFromObject(shield);
 assert.ok(box.max.y<.2,`not lying flat: top at ${box.max.y}`);
 drop.reset();assert.equal(shield.parent,hand);assert.ok(Math.abs(shield.rotation.y-1.2)<1e-6);
});

test('a shield on the actor root (unrigged fallback) is left alone',()=>{
 const {root,shield,actor}=rig();root.add(shield);
 assert.equal(createShieldDrop(actor),null);
});
