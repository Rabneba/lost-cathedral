import test from 'node:test';
import assert from 'node:assert/strict';
import {Scene,Vector3} from 'three';
import {FootContacts} from '../src/game/contact-feedback.js';
import {createPuddles,puddleCoverageAt} from '../src/game/puddles.js';

function patch(wet){
 for(let z=-10;z<10;z+=.25)for(let x=-8;x<8;x+=.25){const coverage=puddleCoverageAt(x,z);if(wet?coverage>.99:coverage===0)return new Vector3(x,.035,z);}
 throw new Error('Expected both wet and dry fighting-floor areas');
}
const active=puddles=>puddles.mesh.material.uniforms.uRipples.value.filter(r=>r.w>0);

test('measured wet foot planting makes one ripple, grounded idle makes none',()=>{
 const puddles=createPuddles(new Scene()),feet=new FootContacts(),wet=patch(true);puddles.update(10);
 const landings=[];
 // A real foot detector sequence: planted, lift, swing, descend, plant.
 for(const height of [0,.06,.11,.10,.06,.005,0,0])landings.push(...feet.update(.04,{Left:new Vector3(wet.x,height,wet.z)},{moving:true,groundHeight:0,settled:true}));
 assert.equal(landings.length,1);assert.equal(puddles.footstep(landings[0]),true);
 assert.equal(puddles.footstep(landings[0]),false);assert.equal(active(puddles).length,1);
 for(let i=0;i<120;i++)for(const event of feet.update(1/60,{Left:new Vector3(wet.x,0,wet.z)},{moving:false,groundHeight:0,settled:true}))puddles.footstep(event);
 assert.equal(active(puddles).length,1);puddles.update(11.5);assert.equal(active(puddles).length,0);
 puddles.dispose();
});

test('dry floor, airborne positions and non-foot events cannot allocate ripples',()=>{
 const puddles=createPuddles(new Scene()),dry=patch(false),wet=patch(true);
 assert.equal(puddles.footstep({kind:'step',position:dry}),false);
 assert.equal(puddles.footstep({kind:'step',position:new Vector3(12,.035,0)}),false);
 assert.equal(puddles.footstep({kind:'step',position:wet.clone().setY(.5)}),false);
 assert.equal(puddles.footstep({kind:'impact',position:wet}),false);
 assert.equal(active(puddles).length,0);puddles.dispose();
});

test('landing pool is bounded and encounter reset clears all old waves',()=>{
 const puddles=createPuddles(new Scene()),wet=patch(true);
 for(let i=0;i<20;i++){puddles.update(i*.01);puddles.footstep({kind:'landing',position:wet.clone()},{boss:true});}
 assert.equal(active(puddles).length,8);assert.ok(active(puddles).every(r=>r.w<=.9));
 puddles.reset();assert.equal(active(puddles).length,0);
 puddles.quality('low');assert.doesNotThrow(()=>puddles.mesh.onBeforeRender(null,null,null));
 puddles.dispose();
});
