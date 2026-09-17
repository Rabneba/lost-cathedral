import * as T from 'three';
import {loadGLB} from './load-glb-node.mjs';
import {ASSETS} from '../src/game/asset-paths.js';
import {actorDimensions} from '../src/game/actor-scale.js';
const url=p=>decodeURIComponent(new URL(p).pathname);

for (const [who,path,isBoss] of [['player',ASSETS.playerRig,false],['boss',ASSETS.bossRig,true]]){
  const gltf=await loadGLB(url(path));
  const dims=actorDimensions(isBoss,ASSETS.motion[who]);
  const scene=gltf.scene; scene.updateMatrixWorld(true);
  const box=new T.Box3().setFromObject(scene);
  console.log('\n=====',who,'worldScale',dims.scale,'authored bbox y',box.min.y.toFixed(3),box.max.y.toFixed(3),'height',(box.max.y-box.min.y).toFixed(3),'=> world height',((box.max.y-box.min.y)*dims.scale).toFixed(3));
  const bones={};
  scene.traverse(n=>{if(n.isBone)bones[n.name]=n;});
  const want=['Hips','Spine','Spine1','Spine2','Neck','Head','LeftUpLeg','RightUpLeg','LeftShoulder','RightShoulder','LeftArm','RightArm','LeftLeg','RightLeg'];
  for(const b of want){const bone=bones['mixamorig'+b];if(bone){const p=bone.getWorldPosition(new T.Vector3());console.log('  bone',b.padEnd(14),p.toArray().map(v=>v.toFixed(4)).join(', '));}}
  // skinned vertex cloud in world (bind) space
  const meshes=[];scene.traverse(n=>{if(n.isSkinnedMesh)meshes.push(n);});
  console.log('  skinned meshes:',meshes.map(m=>m.name+':'+m.geometry.attributes.position.count).join(' '));
  const hips=bones.mixamorigHips, spine2=bones.mixamorigSpine2||bones.mixamorigSpine1;
  const hipY=hips?hips.getWorldPosition(new T.Vector3()).y:0;
  // Gather all skinned verts
  const pts=[];
  for(const m of meshes){
    const pos=m.geometry.attributes.position, sk=m.geometry.attributes.skinIndex, sw=m.geometry.attributes.skinWeight;
    const v=new T.Vector3();
    for(let i=0;i<pos.count;i++){
      v.fromBufferAttribute(pos,i);
      m.applyBoneTransform(i,v);
      v.applyMatrix4(m.matrixWorld);
      let topBone=-1,topW=0;
      if(sk)for(let k=0;k<4;k++){const w=sw.getComponent(i,k);if(w>topW){topW=w;topBone=sk.getComponent(i,k);}}
      const boneName=topBone>=0&&m.skeleton?m.skeleton.bones[topBone]?.name:null;
      pts.push({x:v.x,y:v.y,z:v.z,bone:boneName});
    }
  }
  console.log('  total verts',pts.length);
  // Belt band: verts whose dominant bone is Hips/Spine, in a y band around the hip bone
  const byBone={};for(const p of pts){byBone[p.bone]=(byBone[p.bone]||0)+1;}
  console.log('  verts per bone (top 12):',Object.entries(byBone).sort((a,b)=>b[1]-a[1]).slice(0,12).map(([k,v])=>k+'='+v).join(' '));
  function band(name,lo,hi,filter){
    const sel=pts.filter(p=>p.y>=lo&&p.y<hi&&(!filter||filter(p)));
    if(!sel.length){console.log('  band',name,'EMPTY');return;}
    const xs=sel.map(p=>p.x).sort((a,b)=>a-b),zs=sel.map(p=>p.z).sort((a,b)=>a-b),ys=sel.map(p=>p.y);
    const q=(a,f)=>a[Math.floor((a.length-1)*f)];
    console.log('  band',name.padEnd(16),'n='+String(sel.length).padEnd(6),
      'y',(Math.min(...ys)).toFixed(3),'..',(Math.max(...ys)).toFixed(3),
      '| x',q(xs,0).toFixed(3),q(xs,1).toFixed(3),
      '| z',q(zs,0).toFixed(3),q(zs,1).toFixed(3),
      '| rearZ(p02)',q(zs,.02).toFixed(3),'frontZ(p98)',q(zs,.98).toFixed(3));
  }
  const H=box.max.y;
  for(let f=0.30;f<=0.75;f+=0.025){
    band('y'+ (f*100).toFixed(0)+'%', H*f, H*(f+0.025));
  }
  // rear-most z at each height (the back surface) for the panel to hang against
  console.log('  --- back surface profile (min z) per height ---');
  for(let f=0.10;f<=0.95;f+=0.05){
    const sel=pts.filter(p=>p.y>=H*f&&p.y<H*(f+0.05)&&Math.abs(p.x)<0.12*H);
    if(!sel.length)continue;
    const zs=sel.map(p=>p.z).sort((a,b)=>a-b);
    console.log('   y='+(H*f).toFixed(3).padStart(6),'('+(f*100).toFixed(0)+'%)','minZ',zs[0].toFixed(4),'p05',zs[Math.floor(zs.length*.05)].toFixed(4),'maxZ',zs.at(-1).toFixed(4));
  }
  // thigh radius
  for(const side of ['Left','Right']){
    const b=bones['mixamorig'+side+'UpLeg'];if(!b)continue;
    const bp=b.getWorldPosition(new T.Vector3());
    const knee=bones['mixamorig'+side+'Leg']?.getWorldPosition(new T.Vector3());
    const sel=pts.filter(p=>p.bone==='mixamorig'+side+'UpLeg');
    if(sel.length){
      const r=sel.map(p=>Math.hypot(p.x-bp.x,p.z-bp.z));r.sort((a,b)=>a-b);
      console.log('  thigh',side,'origin',bp.toArray().map(v=>v.toFixed(3)).join(','),'knee',knee?knee.toArray().map(v=>v.toFixed(3)).join(','):'-','radius p50',r[Math.floor(r.length/2)].toFixed(3),'p90',r[Math.floor(r.length*.9)].toFixed(3));
    }
  }
}

// ---- Anchor arcs: the rear surface of the garment the cloth must sit on ----
console.log('\n\n#### ANCHOR ARCS ####');
for (const [who,path,isBoss] of [['player',ASSETS.playerRig,false],['boss',ASSETS.bossRig,true]]){
  const gltf=await loadGLB(url(path));const scene=gltf.scene;scene.updateMatrixWorld(true);
  const bones={};scene.traverse(n=>{if(n.isBone)bones[n.name]=n;});
  const pts=[];const meshes=[];scene.traverse(n=>{if(n.isSkinnedMesh)meshes.push(n);});
  for(const m of meshes){
    const pos=m.geometry.attributes.position,sk=m.geometry.attributes.skinIndex,sw=m.geometry.attributes.skinWeight;const v=new T.Vector3();
    for(let i=0;i<pos.count;i++){v.fromBufferAttribute(pos,i);m.applyBoneTransform(i,v);v.applyMatrix4(m.matrixWorld);
      let tb=-1,tw=0;for(let k=0;k<4;k++){const w=sw.getComponent(i,k);if(w>tw){tw=w;tb=sk.getComponent(i,k);}}
      pts.push({x:v.x,y:v.y,z:v.z,bone:m.skeleton.bones[tb]?.name||''});}
  }
  const H=Math.max(...pts.map(p=>p.y));
  console.log('\n##',who,'height',H.toFixed(3));
  const torso=p=>/Hips|Spine|Spine1|Spine2|Neck/.test(p.bone.replace('mixamorig',''))&&!/Leg|Arm|Shoulder|Hand|Foot/.test(p.bone);
  // rear arc of the hip armour / belt: torso-skinned verts only
  function arc(label,lo,hi,filter){
    console.log(' ',label,'y in',lo.toFixed(3),hi.toFixed(3));
    for(let x=-0.34;x<=0.34;x+=0.04){
      const sel=pts.filter(p=>p.y>=lo&&p.y<hi&&p.x>=x&&p.x<x+0.04&&(!filter||filter(p)));
      if(sel.length<3)continue;
      const zs=sel.map(p=>p.z).sort((a,b)=>a-b);
      console.log('    x=',x.toFixed(2),'n='+String(sel.length).padEnd(5),'backZ',zs[Math.floor(zs.length*.02)].toFixed(4),'frontZ',zs[Math.floor(zs.length*.98)].toFixed(4));
    }
  }
  if(!isBoss){
    // hip / belt region and the bottom edge of the hip armour
    for(const [lo,hi] of [[0.96,1.00],[1.00,1.04],[1.04,1.08],[1.08,1.12]]) arc('BELT',lo,hi,torso);
    // where does the torso mesh (hip plates) end going down?
    const hipVerts=pts.filter(p=>p.bone==='mixamorigHips');
    console.log('  Hips-skinned verts y range',Math.min(...hipVerts.map(p=>p.y)).toFixed(3),Math.max(...hipVerts.map(p=>p.y)).toFixed(3),'count',hipVerts.length);
  } else {
    for(const [lo,hi] of [[2.02,2.08],[2.08,2.14],[2.14,2.20],[2.20,2.26]]) arc('SHOULDER',lo,hi);
    for(const [lo,hi] of [[1.44,1.50],[1.50,1.56],[1.56,1.62]]) arc('BELT',lo,hi,torso);
    const hipVerts=pts.filter(p=>p.bone==='mixamorigHips');
    console.log('  Hips-skinned verts y range',Math.min(...hipVerts.map(p=>p.y)).toFixed(3),Math.max(...hipVerts.map(p=>p.y)).toFixed(3),'count',hipVerts.length);
    // widest back extent at shoulder blade height
    for(const y of [1.9,2.0,2.1,2.2,2.3]){
      const sel=pts.filter(p=>Math.abs(p.y-y)<0.03);
      if(!sel.length)continue;
      const xs=sel.map(p=>p.x).sort((a,b)=>a-b),zs=sel.map(p=>p.z).sort((a,b)=>a-b);
      console.log('  y='+y.toFixed(2),'x',xs[0].toFixed(3),xs.at(-1).toFixed(3),'z',zs[0].toFixed(3),zs.at(-1).toFixed(3));
    }
  }
}
