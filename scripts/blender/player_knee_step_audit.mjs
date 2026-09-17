import * as T from 'three';import {loadGLB}from'../load-glb-node.mjs';
const g=await loadGLB(process.argv[2]||'assets/player-essential-motion/player-material-support-study.glb'),m=new T.AnimationMixer(g.scene),c=g.animations.find(c=>c.name==='run-forward'),a=m.clipAction(c);a.play();let last=null,rows=[];
for(let i=0;i<=144;i++){a.time=c.duration*i/144;m.update(0);g.scene.updateMatrixWorld(true);const q=['Left','Right'].map(s=>g.scene.getObjectByName('mixamorig'+s+'Leg').quaternion.clone());if(last)rows.push({i,t:a.time,left:q[0].angleTo(last[0])*180/Math.PI,right:q[1].angleTo(last[1])*180/Math.PI});last=q;}
console.log(rows.sort((a,b)=>Math.max(b.left,b.right)-Math.max(a.left,a.right)).slice(0,12));
