// Round 3 (16-17 Sep 2026): the graphics pass. Fences around the two regressions the user reported after the
// optimization pass (frozen shadow maps, black blocks on the floor) and the new pieces that need no GPU.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as T from 'three';
import {createPuddles} from '../src/game/puddles.js';
import {BossFissure} from '../src/game/boss-fissure.js';
import {floorDamageDecals} from '../src/game/nave-dressing.js';
await import('../src/game/rendering.js');

const read=name=>readFileSync(new URL('../src/game/'+name,import.meta.url),'utf8');

test('renderMirror refreshes the shadow maps inside the mirror pass (Reflector switches autoUpdate off around its nested render)',()=>{
 const scene=new T.Scene(),puddles=createPuddles(scene);
 const camera=new T.PerspectiveCamera(52,1.8,.1,100);camera.position.set(0,3,10);camera.lookAt(0,0,0);camera.updateMatrixWorld();
 const seen=[];
 const renderer={coordinateSystem:T.WebGLCoordinateSystem,shadowMap:{enabled:true,autoUpdate:true,needsUpdate:false},xr:{enabled:false},autoClear:true,
  getRenderTarget:()=>null,setRenderTarget(){},clear(){},state:{buffers:{depth:{setMask(){}}},viewport(){}},
  render(){seen.push({auto:renderer.shadowMap.autoUpdate,needs:renderer.shadowMap.needsUpdate});renderer.shadowMap.needsUpdate=false;}};
 assert.equal(puddles.renderMirror(renderer,scene,camera),true);
 assert.equal(seen.length,1,'one nested render');
 assert.equal(seen[0].auto,false,'Reflector turns autoUpdate off for its own render');
 assert.equal(seen[0].needs,true,'needsUpdate is what carries the refresh through it: without it the moon froze and the cookie spots never baked');
 assert.equal(renderer.shadowMap.autoUpdate,true,'restored afterwards');
 renderer.shadowMap.enabled=false;seen.length=0;puddles.renderMirror(renderer,scene,camera);
 assert.equal(seen[0].needs,false,'no refresh is asked for when shadows are off');
});

test('half-float overflow cannot reach the frame: material output is capped, the puddle taps are capped and NaN-tested, bloom tests NaN explicitly',()=>{
 assert.match(T.ShaderChunk.opaque_fragment,/min\( outgoingLight, vec3\( 32\.0 \) \)/,'every built-in material caps its HDR output');
 const puddles=read('puddles.js');
 assert.match(puddles,/vec3 tap\(vec2 uv,float lod\)\{[^}]*isnan\(c\)[^}]*min\(c,vec3\(10\.\)\)/,'the reflection taps drop NaN and cap at 10');
 assert.ok(!/texture2DLodEXT\(tDiffuse,uv\+vec2\(0\.,streak\)/.test(puddles),'no raw tap survives beside the capped one');
 const rendering=read('rendering.js');
 assert.ok(rendering.split('vec3(isnan(').length>=4,'bloom bright pass, bloom composite and the grade all test NaN explicitly');
});

test('the fissure effect places itself on the boss facing, follows the rule\'s progress and dies after its life',()=>{
 const scene=new T.Scene(),fissure=new BossFissure(scene,{count:2});
 assert.equal(scene.children.filter(o=>o.name==='Grave fissure').length,2);
 assert.ok(scene.children.some(o=>o.isPointLight),'one point light, created at load, never mid-fight');
 fissure.warnAt({x:1,z:2},Math.PI/2,6,.5);
 assert.equal(fissure.warn.visible,true);assert.ok(Math.abs(fissure.warn.scale.x-6)<1e-9);
 fissure.warnAt(null,0,0,0);assert.equal(fissure.warn.visible,false);
 const item=fissure.strike({x:1,y:.04,z:2},Math.PI/2,{reach:8,width:1.3,power:1,life:1.9});
 assert.equal(item.group.visible,true);
 assert.ok(Math.abs(item.group.rotation.y-0)<1e-9,'facing +X (yaw pi/2) lays the line along local +X unrotated');
 assert.ok(Math.abs(item.group.scale.x-8)<1e-9&&Math.abs(item.group.scale.z-1.3*1.9)<1e-9);
 fissure.track(.5);const p=fissure.frontPosition(new T.Vector3());
 assert.ok(Math.abs(p.x-5)<1e-9&&Math.abs(p.z-2)<1e-9,'the front is 4 m down the +X line from the origin');
 fissure.track(.25);assert.ok(Math.abs(fissure.frontPosition(new T.Vector3()).x-5)<1e-9,'the front never runs backwards');
 fissure.update(.1,1);assert.ok(fissure.light.intensity>0,'lit while burning');
 fissure.update(2,3);assert.equal(item.group.visible,false,'gone after its life');assert.equal(fissure.light.intensity,0);
 fissure.strike({x:0,z:0},0,{reach:4});fissure.reset();assert.ok(!fissure.active);
 fissure.dispose();
});

test('the floor damage decals are cut from the four atlas cells and lie inside the fighting floor',()=>{
 const parts=floorDamageDecals();
 assert.equal(parts.length,15);
 for(const g of parts){
  const uv=g.attributes.uv,p=g.attributes.position;
  let minU=1,maxU=0,minV=1,maxV=0;for(let i=0;i<uv.count;i++){minU=Math.min(minU,uv.getX(i));maxU=Math.max(maxU,uv.getX(i));minV=Math.min(minV,uv.getY(i));maxV=Math.max(maxV,uv.getY(i));}
  assert.ok(maxU-minU<=.46+1e-6&&maxV-minV<=.46+1e-6,'one cell, inset');
  assert.ok((minU<.5)===(maxU<.5)&&(minV<.5)===(maxV<.5),'never straddles a cell boundary');
  for(let i=0;i<p.count;i++){assert.ok(Math.abs(p.getX(i))<=9.9&&p.getZ(i)>=-15.6&&p.getZ(i)<=16.1,'inside the railings');assert.ok(Math.abs(p.getY(i)-.010)<1e-6,'under the Reflector at y .012');}
  g.dispose();
 }
});
