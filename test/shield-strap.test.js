import test from 'node:test';
import assert from 'node:assert/strict';
import {Vector3,Quaternion} from 'three';
import {ShieldStrap} from '../src/game/shield-strap.js';

// edgeOnAngles is the analytic half of the shield's presentation: the swings about the
// forearm that turn the shield's face normal perpendicular to a given direction, so the
// 1.545 m slab is a sliver rather than a wall. Round 2 solved it only against "up", which
// for a side roll points the face straight at the camera; it now takes the target as an
// argument so the game can pass the camera's own view direction. Pure geometry, so it is
// tested on the prototype without a rig.
const solve=(axis,normal,target,maxSwing=1.9)=>
 ShieldStrap.prototype.edgeOnAngles.call({maxSwing},axis.normalize(),normal.normalize(),target.normalize());
const turned=(normal,axis,angle)=>normal.clone().applyQuaternion(new Quaternion().setFromAxisAngle(axis,angle));

test('the analytic edge-on swings really put the shield face perpendicular to the target',()=>{
 let solved=0,checked=0;
 for(let seed=0;seed<400;seed++){
  // A deterministic spread of arm axes, face normals and view directions.
  const a=s=>Math.sin(seed*s)+Math.cos(seed*s*1.7);
  const axis=new Vector3(a(1.1),a(2.3),a(3.7)),normal=new Vector3(a(5.1),a(1.9),a(4.3)),target=new Vector3(a(2.9),a(6.1),a(1.3));
  if(axis.lengthSq()<1e-6||normal.lengthSq()<1e-6||target.lengthSq()<1e-6)continue;
  axis.normalize();normal.normalize();target.normalize();
  checked++;
  const angles=solve(axis.clone(),normal.clone(),target.clone(),Math.PI);
  for(const angle of angles){
   solved++;
   assert.ok(Math.abs(turned(normal,axis,angle).dot(target))<1e-9,
    `swing ${angle.toFixed(3)} leaves |n.target| = ${Math.abs(turned(normal,axis,angle).dot(target)).toFixed(6)}`);
  }
  if(angles.length===0){
   // No solution must mean no swing can reach it, not that the solver missed one.
   let bestFacing=1;
   for(let step=0;step<720;step++)bestFacing=Math.min(bestFacing,Math.abs(turned(normal,axis,step*Math.PI/360).dot(target)));
   assert.ok(bestFacing>1e-6,`reported no edge-on swing although one gets to ${bestFacing.toFixed(6)}`);
  }
 }
 assert.ok(checked>300&&solved>300,`exercised ${checked} configurations and ${solved} solutions`);
});

test('the swing search is bounded by maxSwing so the shield cannot spin free of the arm',()=>{
 const axis=new Vector3(0,1,.35).normalize(),normal=new Vector3(1,.2,0).normalize(),target=new Vector3(0,0,1);
 for(const angle of solve(axis.clone(),normal.clone(),target.clone(),.4))assert.ok(Math.abs(angle)<=.4);
 assert.deepEqual(solve(new Vector3(0,1,0),new Vector3(0,1,0),new Vector3(0,1,0)),[],
  'a face normal along the arm axis has no reachable swing at all');
});

test('a side roll needs the camera target: the vertical one can point the face at the camera',()=>{
 // A left roll with the forearm lying across the view: rotating about it sweeps the face
 // normal through the plane that contains the view direction, so "face normal horizontal"
 // and "face normal aimed at the camera" are the same swing. This is the round-1/round-2
 // blocker in one line of geometry.
 const axis=new Vector3(1,0,0),normal=new Vector3(0,0,1),view=new Vector3(0,-.26,-.97).normalize();
 const flat=solve(axis.clone(),normal.clone(),new Vector3(0,1,0));
 assert.equal(flat.length,1,'exactly one horizontal-normal swing is in reach');
 assert.ok(Math.abs(turned(normal,axis,flat[0]).dot(view))>.9,
  'and it leaves the full face pointing at the camera');
 // Against the camera's own direction the solver finds swings that really are slivers.
 const edge=solve(axis.clone(),normal.clone(),view.clone());
 assert.ok(edge.length>0,'the camera target has reachable solutions here');
 for(const angle of edge){
  assert.ok(Math.abs(turned(normal,axis,angle).dot(view))<1e-9,'edge-on to the camera');
  assert.ok(Math.abs(angle)<=1.9,"within the strap's own swing limit");
 }
});
