import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {capTexture,capObjectTextures} from './texture-budget.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {weatherStone,floorStyleUniforms,FLOOR_STYLES,scaleStoneUV,vaultSection,archSpandrel,pointedGateShape} from './stone-weathering.js';
import {cathedralGlass} from './cathedral-glass.js';
import {brokenSlab,fracturedRock,stoneFragmentTint} from './rubble-geometry.js';
import {CANDLE_STANDS,CANDLE_BASE_RADIUS,candleGroundColliders} from './arena-layout.js';
import {ASSETS} from './asset-paths.js';
import {createBanners} from './banners.js';
import {addFittings,candleStand,ironwork,bannerRods,stainDecals,floorStains,votiveCluster} from './set-dressing.js';
import {debrisScatter,censers,apseShafts,floorDamageDecals} from './nave-dressing.js';
const rand=(()=>{let s=84721;return()=>{s=(s*16807)%2147483647;return(s-1)/2147483646}})();
// Load one generated prop, normalise it to a height, bake a transform per
// placement into a copy and merge the lot into ONE geometry. Cloning sixteen
// Object3Ds would cost sixteen times the material count in draw calls and
// sixteen copies of the GLB's own textures; this costs one mesh and one
// material - the arena's shared limestone - and the orphaned maps are disposed.
async function mergedProp(loader,url,height,placements,tint){
 const gltf=await loader.loadAsync(url).catch(()=>null);
 if(!gltf)return null;
 const scene=gltf.scene;scene.updateMatrixWorld(true);
 const bounds=new T.Box3().setFromObject(scene);
 if(!isFinite(bounds.min.y))return null;
 const size=bounds.getSize(new T.Vector3()),centre=bounds.getCenter(new T.Vector3());
 const k=height/Math.max(size.y,1e-4);
 const normalise=new T.Matrix4().makeTranslation(-centre.x*k,-bounds.min.y*k,-centre.z*k)
  .multiply(new T.Matrix4().makeScale(k,k,k));
 const pieces=[],orphans=new Set();
 scene.traverse(n=>{
  if(!n.isMesh)return;
  for(const material of (Array.isArray(n.material)?n.material:[n.material])){
   if(!material)continue;
   for(const value of Object.values(material))if(value?.isTexture)orphans.add(value);
   material.dispose();
  }
  for(const [x,y,z,yaw=0,pitch=0,roll=0,scale=1] of placements){
   const g=n.geometry.clone();
   for(const key of Object.keys(g.attributes))if(key!=='position'&&key!=='normal'&&key!=='uv')g.deleteAttribute(key);
   if(!g.attributes.uv)g.setAttribute('uv',new T.Float32BufferAttribute(new Float32Array(g.attributes.position.count*2),2));
   const m=new T.Matrix4().compose(new T.Vector3(x,y,z),
    new T.Quaternion().setFromEuler(new T.Euler(pitch,yaw,roll)),new T.Vector3(scale,scale,scale));
   g.applyMatrix4(m.multiply(normalise).multiply(n.matrixWorld));
   tint(g,[x,y,z]);
   pieces.push(g.index?g.toNonIndexed():g);
  }
 });
 orphans.forEach(texture=>texture.dispose());
 if(!pieces.length)return null;
 const merged=mergeGeometries(pieces,false);pieces.forEach(g=>g.dispose());
 return merged;
}

// Triplanar-ish world projection for geometry that is merged outside put().
function projectWorldUV(g){const p=g.attributes.position,n=g.attributes.normal,uv=g.attributes.uv;if(!p||!n||!uv)return g;
 for(let i=0;i<p.count;i++){if(Math.abs(n.getY(i))>.5)uv.setXY(i,p.getX(i),p.getZ(i));else if(Math.abs(n.getX(i))>.5)uv.setXY(i,p.getZ(i),p.getY(i));else uv.setXY(i,p.getX(i),p.getY(i));}
 uv.needsUpdate=true;return g;}
const v=(x,y,z)=>new T.Vector3(x,y,z);
const fract=x=>x-Math.floor(x);
const placeHash=(a,b,c,salt)=>fract(Math.sin(a*12.9898+b*78.233+c*37.719+salt*4.1414)*43758.5453);
const smooth=(e0,e1,x)=>{const t=Math.max(0,Math.min(1,(x-e0)/(e1-e0)));return t*t*(3-2*t);};
// put() already allocated a full Float32 colour attribute for every stone
// geometry and filled it with 1.0 - about 1.5 M floats of VRAM doing nothing.
// Filling it is free tonal variation at zero texture and zero draw-call cost,
// and it is the standard fix for merged geometry reading as one extrusion:
//   per-primitive value jitter, a two-quarry hue split, a damp ramp that
//   anchors everything within 1.8 m of the floor, and soot above the gallery.
function tintByPlacement(g,p){
 const pos=g.attributes.position,count=pos.count;
 const existing=g.attributes.color;
 const out=existing?existing.array:new Float32Array(count*3);
 const value=1+(placeHash(p[0],p[1],p[2],1)-.5)*.18;
 const quarry=placeHash(p[0],p[1],p[2],7);
 const r0=1.03+(0.92-1.03)*quarry,g0=1.00+(0.96-1.00)*quarry,b0=0.94+(1.00-0.94)*quarry;
 for(let i=0;i<count;i++){
  const y=pos.getY(i);
  const damp=.72+.28*smooth(0,1.8,y);
  const soot=Math.min(1,Math.max(0,(y-9)/7))*.55;
  let r=value*r0*damp,gg=value*g0*damp,b=value*b0*damp;
  r+=(0.82-r)*soot;gg+=(0.80-gg)*soot;b+=(0.79-b)*soot;
  if(existing){out[i*3]*=r;out[i*3+1]*=gg;out[i*3+2]*=b;}
  else{out[i*3]=r;out[i*3+1]=gg;out[i*3+2]=b;}
 }
 if(existing)existing.needsUpdate=true;
 else g.setAttribute('color',new T.Float32BufferAttribute(out,3));
 return g;
}
export async function buildArena(scene,texturePaths={}){
 // main.js passes only the two legacy maps on a dense shared line. The arena
 // reads the rest of its own surfaces straight from the asset table.
 // The spread used to run the other way round, which put main.js's two legacy
 // 2024 maps LAST - so they won and the cathedral set generated for this room
 // was never drawn at all. The arena's own surfaces take precedence now.
 // Round 2 (16 Sep, ENV): the wall carries a derived relief map (normal xyz,
 // roughness in alpha) and the floor's own set is the grey flagstone; the
 // chequer and tomb sets are blended in by stone-weathering.js (floor zones).
 texturePaths={...texturePaths,stone:{map:ASSETS.cathedralWall,normalMap:ASSETS.wallAshlarNR},floor:{map:ASSETS.floorFlagstoneGrey,normalMap:ASSETS.floorFlagstoneGreyNR}};
 // Touch (17 Sep 2026): main.js passes shadowScale (.5 on a phone: the moon's 3072 map becomes 1536, the cookie spots
 // halve) and textureCap (1024: the monument's 4096 maps and the 2048 seal are shrunk before their first upload,
 // texture-budget.js). Both default to what shipped.
 const shadowScale=texturePaths.shadowScale??1,textureCap=texturePaths.textureCap??0;
 const root=new T.Group();root.name='Cathedral of the Last Rite';scene.add(root);
 const loader=new T.TextureLoader();
 const cameraColliders=[];
 function cameraBox(x,y,z,w,h,d){cameraColliders.push(new T.Box3(v(x-w/2,y-h/2,z-d/2),v(x+w/2,y+h/2,z+d/2)));}
 // Every map in a set is fetched at once; with several PBR sets a serial
 // await inside the loop turned the loading screen into twenty round trips.
 async function material(paths,color,repeat){const m=new T.MeshStandardMaterial({color,roughness:.89,metalness:.04});
 const entries=Object.entries(paths||{}).filter(([,path])=>path);
 const loaded=await Promise.all(entries.map(([,path])=>loader.loadAsync(path).catch(()=>null)));
 const [ru,rv]=Array.isArray(repeat)?repeat:[repeat,repeat];
 entries.forEach(([role],i)=>{const tex=loaded[i];if(!tex)return;tex.wrapS=tex.wrapT=T.RepeatWrapping;tex.repeat.set(ru,rv);tex.anisotropy=16;if(role==='map')tex.colorSpace=T.SRGBColorSpace;m[role]=tex;});
 // The bump map stays bound alongside a normal map with zero scale: every
 // procedural relief injection in stone-weathering.js lives behind
 // #ifdef USE_BUMPMAP and silently disappears the moment it is unbound.
 if(m.normalMap){m.normalScale.set(.7,.7);if(m.map){m.bumpMap=m.map;m.bumpScale=0;}}
 else if(m.map){m.bumpMap=m.map;m.bumpScale=.08;}return m;}
 // The floor plane carried stock 0-1 UVs at repeat 6, which stretched one
 // flagstone to 4.0 m across the nave and 6.67 m along it. worldUV re-projects
 // it in put() to world XZ metres, so 1/2.4 is one 2.4 m tile square - the same
 // grid the grave covers and the pier bases already sit on.
 // The two extra paving sets the floor shader blends in by world-space zone
 // (chequered marble in the nave centre, tomb slabs in the aisles). sRGB for
 // the colour maps, linear for the derived normal/roughness maps.
 // Relief maps get anisotropy 4, not 16: at a grazing floor anisotropic
 // filtering keeps millimetre facets alive ten metres away and they shimmer
 // under camera motion (see stone-weathering.js). Colour keeps 16.
 const zoneTexture=async(path,srgb)=>{const tex=await loader.loadAsync(path).catch(()=>null);if(!tex)return null;tex.wrapS=tex.wrapT=T.RepeatWrapping;tex.anisotropy=srgb?16:4;if(srgb)tex.colorSpace=T.SRGBColorSpace;return tex;};
 // 0x5f666a was tuned against the warm 2024-style flagstone (linear mean
 // .196/.174/.134); the grey set is lighter and neutral (.225/.231/.225), so
 // the colour is pulled down to keep the floor's mean albedo where it was,
 // a touch cooler than equal-mean (0x595953) for the DS3 blue-grey.
 const [stone,floorMat,chequerMap,chequerNR,tombMap,tombNR]=await Promise.all([material(texturePaths.stone,0x7d858a,.45),material(texturePaths.floor,0x565d62,1/2.4),
  zoneTexture(ASSETS.floorChequer,true),zoneTexture(ASSETS.floorChequerNR,false),zoneTexture(ASSETS.floorTomb,true),zoneTexture(ASSETS.floorTombNR,false)]);
 floorMat.userData.worldUV=true;
 // The nave set can be swapped for a darker one (pause menu, Floor); the others load on first use.
 const floorUniforms=floorStyleUniforms('chequer',chequerMap,chequerNR);
 const floorSets={chequer:Promise.resolve([chequerMap,chequerNR]),
  basalt:null,marble:null},floorSources={basalt:[ASSETS.floorBasalt,ASSETS.floorBasaltNR],marble:[ASSETS.floorMarble,ASSETS.floorMarbleNR]};
 let floorRequest=0;
 async function setFloorStyle(style){
  if(!FLOOR_STYLES[style])style='chequer';
  const request=++floorRequest;
  floorSets[style]??=Promise.all([zoneTexture(floorSources[style][0],true),zoneTexture(floorSources[style][1],false)]);
  const [map,nr]=await floorSets[style];
  if(request!==floorRequest||!map||!nr)return;
  const next=floorStyleUniforms(style,map,nr);
  for(const key of Object.keys(next))floorUniforms[key].value=next[key].value;
 }
 weatherStone(stone);weatherStone(floorMat,{floor:true,zones:{chequer:{map:chequerMap,nr:chequerNR,uniforms:floorUniforms},tomb:{map:tombMap,nr:tombNR}}});floorMat.envMapIntensity=.32;
 stone.vertexColors=true;
 floorMat.bumpScale=.032;
 // Per-surface relief strength: the vault is seen at 15 m and only aliases at
 // full strength; the masonry draws its own procedural courses on top.
 if(stone.normalMap)stone.normalScale.set(1.0,1.0);
 if(floorMat.normalMap){floorMat.normalScale.set(.75,.75);floorMat.normalMap.anisotropy=4;}
 const masonry=weatherStone(stone.clone(),{masonry:true});masonry.userData.worldUV=true;masonry.normalScale.set(.65,.65);
 const carved=weatherStone(stone.clone());carved.color.set(0x707a80);carved.normalScale.set(.85,.85);
 const vaultMat=weatherStone(stone.clone());vaultMat.side=T.DoubleSide;vaultMat.color.set(0x68747a);vaultMat.normalScale.set(.5,.5);
 // Integration fix (16 Sep, round 3). The vault was built, ribbed, bossed and
 // gargoyled and NONE of it reached a camera the player can reach: at the
 // highest look-up the game allows (pitch -.08) the top 12-15 % of the frame
 // measured a flat 0-6 between the chandeliers, so the coronae and the crimson
 // swag hung in nothing. Two dials, because one alone does not do it:
 //  - the webs get a floor under their value, so the masonry between the
 //    chandeliers is dim cool stone instead of the absence of geometry. This is
 //    NOT a glow: linear ~.006 before exposure, an order of magnitude under the
 //    candle pools, and it cannot brighten anything the direct lights already
 //    reach because it is added, not multiplied.
 //  - the ribs get their own batch (one draw call) with twice that floor, so
 //    the lattice reads AGAINST the web instead of with it. The rib structure
 //    is the thing the user's references sell height with.
 // The uplights below carry the actual modelling; this only stops the result
 // being carved out of black.
 vaultMat.emissive=new T.Color(0x0e161c);vaultMat.emissiveIntensity=.55;
 const vaultRib=weatherStone(stone.clone());vaultRib.color.set(0x707a80);vaultRib.normalScale.set(.6,.6);
 vaultRib.emissive=new T.Color(0x1b2733);vaultRib.emissiveIntensity=.62;
 // Real leaded glass instead of a flat emissive slab. alphaTest keeps the
 // broken panes as actual holes and keeps the panes out of the transparent
 // sort, so they still occlude and still light the floor beneath them.
 const [lancetTexture,cookie,oakTexture,stainTexture,metalTexture,debrisTexture,damageTexture,sealTexture,sealNormal]=await Promise.all([
  loader.loadAsync(ASSETS.lancetGlass).catch(()=>null),
  loader.loadAsync(ASSETS.windowCookie).catch(()=>null),
  loader.loadAsync(ASSETS.cathedralOak).catch(()=>null),
  loader.loadAsync(ASSETS.wallGrunge).catch(()=>null),
  loader.loadAsync(ASSETS.cathedralMetal).catch(()=>null),
  loader.loadAsync(ASSETS.debrisAtlas).catch(()=>null),
  loader.loadAsync(ASSETS.floorDamageAtlas).catch(()=>null),
  loader.loadAsync(texturePaths.floorSeal??ASSETS.floorSeal).catch(()=>null),
  loader.loadAsync(texturePaths.floorSealNR??ASSETS.floorSealNR).catch(()=>null),
 ]);
 if(sealTexture){sealTexture.colorSpace=T.SRGBColorSpace;sealTexture.anisotropy=8;}
 if(sealNormal){sealNormal.anisotropy=4;}
 if(textureCap)await Promise.all([sealTexture,sealNormal].filter(Boolean).map(texture=>capTexture(texture,textureCap)));
 if(debrisTexture){debrisTexture.colorSpace=T.SRGBColorSpace;debrisTexture.anisotropy=8;}
 if(damageTexture){damageTexture.colorSpace=T.SRGBColorSpace;damageTexture.anisotropy=8;}
 // T4, the tarnished brass and wrought iron tiling map, was generated last
 // night, sat on disk wired to nothing, and the API has been unreachable since
 // - so every railing, rod, bracket, pricket and hinge in the room was a flat
 // untextured colour and read as silhouette only (round 1 review). It is a
 // base colour map, so it is projected in world metres by put() exactly like
 // the floor and the door, and doubles as the relief: on a 0.05 m rod that is
 // a slice of the tile, which is all the variation a rod needs.
 if(metalTexture){metalTexture.colorSpace=T.SRGBColorSpace;metalTexture.wrapS=metalTexture.wrapT=T.RepeatWrapping;metalTexture.repeat.set(1/.85,1/.85);metalTexture.anisotropy=16;}
 // The base colours below are NOT eyeballed: each is the old flat colour
 // divided, per channel, by this map's own linear mean (0.0903/0.0888/0.0588),
 // so albedo x map reproduces the value the ironwork had before and the map
 // contributes variation only. A map that multiplies an unchanged base colour
 // would simply have made every railing three times darker.
 const wearMetal=(m,{bump=.045}={})=>{
  if(!metalTexture)return m;
  m.map=metalTexture;m.bumpMap=metalTexture;m.bumpScale=bump;m.userData.worldUV=true;
  return m;
 };
 if(stainTexture){stainTexture.colorSpace=T.SRGBColorSpace;stainTexture.anisotropy=8;}
 if(lancetTexture){lancetTexture.colorSpace=T.SRGBColorSpace;lancetTexture.anisotropy=8;}
 if(cookie)cookie.colorSpace=T.SRGBColorSpace;
 // Round 2 review, blocker 2: the generated gobo mask is a BINARY stencil -
 // measured p1 = 0, p99 = 255, three lancets with aliased edges and nothing in
 // between. Handed to a SpotLight as `map` and thrown obliquely across a 24 m
 // nave it painted razor-edged 0-to-full parallelograms with no falloff along
 // the throw: "a zebra crossing painted on the nave", which the code had
 // already rejected once for the mesh version. The masonry above now shapes the
 // throw, and this softens what is left of the stencil: two downsample/upsample
 // passes (a strong separable blur that needs no filter support), a gamma that
 // lifts the mask off pure black so the shadow side never goes to zero, and a
 // radial vignette so the patch has no locatable border anywhere.
 const softCookie=source=>{
  if(!source?.image)return source;
  const size=256,canvas=document.createElement('canvas');canvas.width=canvas.height=size;
  const ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
  const small=document.createElement('canvas');small.width=small.height=20;
  const smallCtx=small.getContext('2d');smallCtx.imageSmoothingEnabled=true;
  smallCtx.drawImage(source.image,0,0,20,20);
  ctx.drawImage(small,0,0,size,size);
  smallCtx.clearRect(0,0,20,20);smallCtx.drawImage(canvas,0,0,20,20);
  ctx.clearRect(0,0,size,size);ctx.drawImage(small,0,0,size,size);
  const pixels=ctx.getImageData(0,0,size,size),data=pixels.data;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
   const i=(y*size+x)*4;
   const radius=Math.min(1,Math.hypot(x/size-.5,y/size-.5)*2.28);
   const vignette=Math.pow(Math.max(0,Math.cos(radius*Math.PI/2)),1.6);
   // .34 floor: a cookie that reaches zero is a hard stencil however soft its
   // edge, because the lit and unlit sides differ by the whole range.
   const value=(.34+.66*Math.pow(data[i]/255,.75))*vignette*255;
   data[i]=data[i+1]=data[i+2]=value;data[i+3]=255;
  }
  ctx.putImageData(pixels,0,0);
  const texture=new T.CanvasTexture(canvas);
  texture.colorSpace=T.SRGBColorSpace;texture.wrapS=texture.wrapT=T.ClampToEdgeWrapping;
  texture.minFilter=T.LinearFilter;texture.magFilter=T.LinearFilter;texture.generateMipmaps=false;
  return texture;
 };
 const softGobo=cookie?softCookie(cookie):null;
 if(oakTexture){oakTexture.colorSpace=T.SRGBColorSpace;oakTexture.wrapS=oakTexture.wrapT=T.RepeatWrapping;oakTexture.repeat.set(1/1.8,1/1.8);oakTexture.anisotropy=16;}
 const windowMat=lancetTexture
  ?new T.MeshStandardMaterial({map:lancetTexture,emissiveMap:lancetTexture,emissive:0xffffff,emissiveIntensity:2.4,color:0xffffff,roughness:.78,metalness:.05,side:T.DoubleSide,alphaTest:.35,transparent:false})
  :new T.MeshStandardMaterial({color:0x647b8b,emissive:0x6d8594,emissiveIntensity:.65,roughness:1});const dark=wearMetal(new T.MeshStandardMaterial({color:0x8f9bb4,roughness:.78,metalness:.55}),{bump:.05});
 const brass=wearMetal(new T.MeshStandardMaterial({color:0xf0c99f,roughness:.6,metalness:.85}),{bump:.04});
 const batches=new Map();
 function put(g,m,p=[0,0,0],r=[0,0,0],scale=[1,1,1]){
 if(m===stone||m===carved||m===vaultMat||m===vaultRib)scaleStoneUV(g,p,scale);
 const matrix=new T.Matrix4().compose(new T.Vector3(...p),new T.Quaternion().setFromEuler(new T.Euler(...r)),new T.Vector3(...scale));g.applyMatrix4(matrix);
 if(m.vertexColors)tintByPlacement(g,p);
 if(m.userData.worldUV||g.userData.worldUV){const p=g.attributes.position,n=g.attributes.normal,uv=g.attributes.uv;for(let i=0;i<p.count;i++){if(Math.abs(n.getY(i))>.5)uv.setXY(i,p.getX(i),p.getZ(i));else if(Math.abs(n.getX(i))>.5)uv.setXY(i,p.getZ(i),p.getY(i));else uv.setXY(i,p.getX(i),p.getY(i));}}
 if(!batches.has(m))batches.set(m,[]);batches.get(m).push(g);}
 function box(x,y,z,w,h,d,m=stone,ry=0){put(new T.BoxGeometry(w,h,d),m,[x,y,z],[0,ry,0]);}
 function cyl(x,y,z,r,h,m=stone,segments=12,rTop=r){put(new T.CylinderGeometry(rTop,r,h,segments),m,[x,y,z]);}
 function tube(points,r,m=carved){put(new T.TubeGeometry(new T.CatmullRomCurve3(points),24,r,6,false),m);}
 function arch(cx,z,width,spring,rise,yaw=0,thickness=.13){const pts=[];for(let i=0;i<=32;i++){const t=i/32;const x=-width/2+width*t;const y=spring+rise*(1-Math.pow(Math.abs(2*t-1),1.55));const a=v(x,y,0).applyAxisAngle(v(0,1,0),yaw).add(v(cx,0,z));pts.push(a);}tube(pts,thickness);}
 // Foundation and open stone fighting floor.
 box(0,-.36,0,27,.7,45,carved);
 const fg=new T.PlaneGeometry(24,40);fg.rotateX(-Math.PI/2);put(fg,floorMat,[0,.004,0]);
 // Broken perimeter paving gives the floor physical edges without a noisy grid.
 for(let i=0;i<200;i++){const side=rand()<.5?-1:1;const x=side*(10.2+rand()*3),z=(rand()-.5)*40;
 const y=.025+rand()*.09,width=.5+rand(),height=.12+rand()*.15,depth=.5+rand(),angle=rand()*.3;
 put(brokenSlab(width,height,depth,i+30),stone,[x,y,z],[0,angle,0]);}
 // Clustered column piers, bases, capitals, galleries and high rib vaults.
 for(const z of [-15,-9,-3,3,9,15])for(const sign of [-1,1]){
 const x=sign*10.7;
 cameraBox(x,.3,z,2.05,.6,2.05);cameraBox(x,5.8,z,1.66,10.6,1.66);
 box(x,.3,z,2.05,.6,2.05);box(x,.7,z,1.65,.22,1.65,carved);
 put(stoneFragmentTint(new T.CylinderGeometry(.62,.62,10.4,16),z+sign*3,true),stone,[x,5.8,z]);
 for(let i=0;i<8;i++){const a=i*Math.PI/4;const xx=x+Math.cos(a)*.57,zz=z+Math.sin(a)*.57;cyl(xx,5.7,zz,.16,10.2,carved,8);}
 for(const y of [.88,7.6,10.7,11]){cyl(x,y,z,.83,.2,stone,12);cyl(x,y+.16,z,.72,.1,carved,12);}
 for(const zz of [z-1.05,z+1.05]){box(sign*12,5.3,zz,.55,10.6,.5);}
 // Each buttress is a visible structure beyond the interior arcade.
 box(sign*13,5.4,z,1.2,10.8,2.2,masonry);box(sign*13,11,z,.9,.7,1.8,carved);
 arch(0,z,21.4,10.9,6.3,0,.2);arch(0,z,20.7,10.9,6.1,0,.08);
}
 for(const sign of [-1,1]){
 box(sign*13.2,4.3,0,.55,8.6,40,masonry);cameraBox(sign*13.2,4.3,0,.55,8.6,40);
 box(sign*11.6,8.9,0,1.8,.36,40,carved);box(sign*12.3,11.3,0,.6,.35,40,carved);
 for(const z of [-12,-6,0,6,12]){
 arch(sign*10.7,z,6,6.1,4.1,Math.PI/2,.22);arch(sign*10.7,z,5.6,6.1,3.9,Math.PI/2,.09);
 // Pointed recessed chapels, double lancets and tracery.
 arch(sign*12.85,z,4.8,3.6,3.9,Math.PI/2,.13);
 for(const dz of [-1.12,1.12]){arch(sign*12.82,z+dz,2,3.4,2.5,Math.PI/2,.1);cyl(sign*12.81,2.2,z+dz-1,.08,4.3,carved,8);}
 cyl(sign*12.8,3,z,.085,6,carved,8);
 for(let k=0;k<7;k++){box(sign*11.15,9.55,z-2.5+k*.83,.16,1,.13,carved);}
 box(sign*11.15,10.1,z,.21,.16,5.7,carved);
 // Clerestory openings have narrow luminous pale panes.
 for(const dz of [-1.1,1.1]){
 arch(sign*12.6,z+dz,1.55,13.1,2.8,Math.PI/2,.12);
 {const pane=new T.PlaneGeometry(1.35,3.42);pane.rotateY(sign*Math.PI/2);put(pane,windowMat,[sign*12.72,12.78,z+dz]);}
 for(const y of [11.65,12.9,14.1])box(sign*12.55,y,z+dz,.2,.09,1.5,carved);
 }
 }
}
 // Apse. Concentric pointed arch, rose window, altar and a monumental empty throne.
 for(const z of [-20,20]){
 put(archSpandrel(z<0),masonry,[0,0,z<0?z+.02:z-.02],[0,z<0?0:Math.PI,0]);
 // 14 m tall was the top of the aisle-side apse wall, but the vault behind it
 // crowns at 17.24 - so either side of the central spandrel a band of open sky
 // showed between the wall head and the vault curve. Those were the two pale
 // triangles the round 2 review calls blocker 1: flat bottom at y = 14, inner
 // vertical edge at |x| = 3 where this central box starts, hypotenuse following
 // the vault. The wall now runs up past the crown at both ends of the nave.
 box(-8,8.9,z,10,17.8,1,masonry);box(8,8.9,z,10,17.8,1,masonry);cameraBox(-8,8.9,z,10,17.8,1);cameraBox(8,8.9,z,10,17.8,1);box(0,18,z,6,1.2,1);
 for(let i=0;i<4;i++)arch(0,z-.06*i,6+i*.6,6.4,5+i*.17,0,.16);
 for(const x of [-3.1,3.45,-3.45,3.8,-3.8,3.1])cyl(x,3.25,z,.11,6.5,carved,8);
 }
 // Three lit lancets close the apse arch. Before this the boss fought in front
 // of a black hole; a dark armoured silhouette against a cold lit shape is
 // legible, against nothing it is not. Kept dim so bloom cannot eat his edges.
 // The pointed opening in the apse spandrel used to look straight through the
 // wall at the sky dome - which is why the boss fought in front of a flat pale
 // grey rectangle speckled with STARS. A solid stone backing closes it, and the
 // three lancets in front of it are the lit east window instead.
 // The whole middle of the apse - x -3..3 from the floor to y 19 - was an open
 // hole looking straight out at the sky dome, which is why the boss fought in
 // front of a flat pale grey rectangle speckled with STARS. This closes it and
 // articulates it: a real wall well behind the window plane (so no light that
 // reaches the window washes it flat), a blind arcade below the sill at eye
 // height, and the lit east window itself as the only bright shape.
 box(0,6.4,-20.78,7.9,13.4,.55,masonry);
 for(const ax of [-2.05,0,2.05]){
  arch(ax,-20.42,1.86,3.5,1.5,0,.085);
  arch(ax,-20.38,1.54,3.5,1.28,0,.042);
  for(const dx of [-.86,.86])cyl(ax+dx,1.75,-20.4,.078,3.5,carved,8);
  put(new T.TorusGeometry(.26,.03,5,20),carved,[ax,5.24,-20.38]);
 }
 box(0,.28,-20.4,7.1,.56,.34,carved);box(0,6.06,-20.4,7.1,.2,.3,carved);
 const apseGlass=lancetTexture?new T.MeshStandardMaterial({map:lancetTexture,emissiveMap:lancetTexture,emissive:0xffc089,emissiveIntensity:3.1,color:0xffffff,roughness:.8,metalness:.05,side:T.DoubleSide,alphaTest:.35}):windowMat;
 for(const ax of [-1.98,0,1.98]){
  const pane=new T.PlaneGeometry(1.92,4.78);
  put(pane,apseGlass,[ax,8.95,-20.05]);
  for(const dx of [-.99,.99])cyl(ax+dx,8.95,-19.98,.075,4.9,carved,8);
 }
 // Cusped heads and a transom so the opening reads as tracery, not three cards.
 for(const ax of [-1.98,0,1.98]){arch(ax,-19.99,1.9,10.5,.85,0,.055);arch(ax,-19.99,1.62,10.5,.7,0,.03);}
 box(0,10.42,-19.99,6.3,.11,.22,carved);box(0,6.62,-19.99,6.3,.13,.24,carved);
 box(0,6.5,-19.99,6.6,.22,.3,carved);box(0,11.28,-19.99,6.6,.2,.28,carved);
 for(let i=0;i<4;i++)box(0,i*.14,-17.2-i*.46,8-i*.5,.28,5-i*.35,carved);
 // The high apse is built in two registers. A worn string course and shallow
 // blind lancets give the broad wall relief without cluttering the floor.
 for(const side of [-1,1]){
  box(side*8.25,7.36,-19.36,9.35,.15,.25,carved);
  box(side*8.25,7.52,-19.42,9.35,.065,.16,stone);
  for(const ax of [6.15,10.25]){
   const x=side*ax;
   arch(x,-19.40,2.64,9.25,3.03,0,.085);
   arch(x,-19.34,2.36,9.25,2.82,0,.043);
   for(const dx of [-1.3,1.3]){
    cyl(x+dx,8.40,-19.36,.074,1.84,carved,8);
    box(x+dx,7.55,-19.30,.26,.18,.31,carved);
    box(x+dx,9.23,-19.31,.21,.13,.24,carved);
   }
   cyl(x,8.4,-19.33,.037,1.74,carved,6);
   arch(x-.56,-19.33,1.1,9.24,1.43,0,.039);
   arch(x+.56,-19.33,1.1,9.24,1.43,0,.039);
   put(new T.TorusGeometry(.31,.035,5,22),carved,[x,10.87,-19.32]);
  }
 }
 cameraBox(0,.62,-18,4.45,1.24,1.65);
 box(0,.9,-18,4.2,.35,1.5);box(0,.48,-18,3.2,.7,1);box(0,1.16,-18,4.45,.14,1.65,carved);
 const roseMat=cathedralGlass();
 put(new T.CircleGeometry(2.9,64),roseMat,[0,14.4,-20.62]);
 for(const rad of [2.88,2.6,1.06,.5])put(new T.TorusGeometry(rad,.11,7,72),carved,[0,14.4,-20.45]);
 for(let k=0;k<12;k++){
  const a=k*Math.PI/6;
  const pts=[v(Math.cos(a)*.55,14.4+Math.sin(a)*.55,-20.4),v(Math.cos(a+.09)*1.65,14.4+Math.sin(a+.09)*1.65,-20.4),v(Math.cos(a)*2.8,14.4+Math.sin(a)*2.8,-20.4)];tube(pts,.055);
  // Interlocking lancet petals, with small surviving stained-glass differences.
  put(new T.TorusGeometry(.54,.042,5,28),carved,[Math.cos(a+.26)*1.85,14.4+Math.sin(a+.26)*1.85,-20.35],[0,0,a+.26-Math.PI/2],[.75,1.35,1]);
 }
 const lead=new T.MeshStandardMaterial({color:0x323b40,roughness:.87,metalness:.28});
 for(let i=0;i<5;i++){const a=i*1.73+.2;const r=1.1+i*.3;tube([v(Math.cos(a)*r,14.4+Math.sin(a)*r,-20.33),v(Math.cos(a+.1)*(r+.22),14.4+Math.sin(a+.1)*(r+.22),-20.33),v(Math.cos(a+.16)*(r+.43),14.4+Math.sin(a+.16)*(r+.43),-20.33)],.017,lead);}
 // Ribbed ceiling. Round 2 review, blocker 1: the centre strip of every bay was
 // open from x = -4.2 to +5.7, and the bays were 5.7 m long on a 6 m pitch, so
 // from any low camera the roof showed two enormous pale-blue sky triangles
 // with razor-straight hypotenuses and rectangular star sprites in them, either
 // side of the hanging corona - the single brightest large area in the hero
 // shot (interior luma 98 against adjacent masonry at 15-22). It did not read
 // as a ruin, it read as missing geometry. The vault now closes at the ridge
 // (widthStart .06 puts the two halves within 12 cm of x = 0, where the crown
 // rib covers the seam) and the bays overlap along z, so no sliver survives.
 // ONE genuine breach is kept, over the west bay at z = +12 on the +x side,
 // well behind the duel and away from the corona: a ruin needs a hole, it does
 // not need its whole spine missing.
 for(let s of [-1,1])for(const z of [-12,-6,0,6,12]){
 tube([v(s*10.7,11,z-3),v(s*5,15.3,z),v(0,17.2,z+3)],.12,vaultRib);
 const broken=s===1&&z===12;
 put(vaultSection(s,z,broken?5.4:.06,10.7,6.14),vaultMat);
 if(!broken)tube([v(s*10.7,11,z+2.9),v(s*7.6,13.55,z+2.9),v(s*4.2,15.7,z+2.9)],.11,vaultRib);
 }
 // The roof stopped at z = +-14.85; past that the nave was open to the sky all
 // the way to the apse and the west front. Two plain bays each end close it.
 for(let s of [-1,1])for(const z of [-18,18])put(vaultSection(s,z,.06,10.7,6.5),vaultMat);
 // Broken rib stubs and a fallen lierne fragment around the surviving breach,
 // so the hole reads as a collapse with edges rather than a cut-out.
 tube([v(6.3,16.2,10.4),v(7.4,15.1,10.0),v(8.1,14.2,9.2)],.11,vaultRib);
 tube([v(5.9,16.4,13.7),v(7.1,15.4,14.2),v(8.4,14.0,14.6)],.10,vaultRib);
 tube([v(4.1,16.9,12.1),v(5.2,16.3,12.0),v(5.9,15.7,11.6)],.085,vaultRib);
 // Clerestory wall. Above the arcade head at y = 8.6 the aisle was open to the
 // sky for its whole length, which is why the tattered banners had pale night
 // showing through their tears and why the two mapped SpotLights outside the
 // building threw unshaped light straight over the wall top and painted the
 // hard parallelograms the review calls blocker 2. This is a real ashlar wall
 // from the arcade head to the vault springing, pierced only by the ten lancet
 // openings that already exist - the light that lands on the nave from here on
 // is shaped by masonry and softened by the shadow map, not by a stencil.
 {
  const shape=new T.Shape();
  shape.moveTo(-20.8,8.3);shape.lineTo(20.8,8.3);shape.lineTo(20.8,17.75);shape.lineTo(-20.8,17.75);shape.closePath();
  for(const z of [-12,-6,0,6,12])for(const dz of [-1.1,1.1]){
   const zc=z+dz,halfWidth=.84,spring=13.0,rise=3.0,sill=10.75;
   const hole=new T.Path();
   hole.moveTo(zc-halfWidth,sill);hole.lineTo(zc+halfWidth,sill);hole.lineTo(zc+halfWidth,spring);
   for(let i=1;i<=24;i++){const s=1-2*i/24;hole.lineTo(zc+halfWidth*s,spring+rise*(1-Math.pow(Math.abs(s),1.55)));}
   hole.lineTo(zc-halfWidth,sill);hole.closePath();
   shape.holes.push(hole);
  }
  const clerestory=new T.ExtrudeGeometry(shape,{depth:1.15,bevelEnabled:false,curveSegments:1,steps:1});
  clerestory.rotateY(-Math.PI/2);clerestory.translate(.575,0,0);
  clerestory.userData.worldUV=true;
  for(const sign of [-1,1]){
   put(clerestory.clone(),masonry,[sign*12.85,0,0],[0,sign>0?0:Math.PI,0]);
   cameraBox(sign*12.85,13.0,0,1.15,9.45,41.6);
  }
  clerestory.dispose();
 }
 // Rubble is irregular geometry, merged into two calls.
 // 330 rocks scattered uniformly reads as gravel, not as a ruin. Two thirds of
 // them, plus two drifts banked against the aisle walls where a collapse would
 // actually pile them.
 for(let i=0;i<210;i++){
 const x=(rand()<.5?-1:1)*(9.2+rand()*4.1),z=(rand()-.5)*40;const sz=.09+rand()*.62;
 const g=i%5===0?brokenSlab(1.45,.8,.95,i+300):fracturedRock(i+300);put(g,i%3===0?carved:stone,[x,sz*.3,z],[rand(),rand()*6,rand()],[sz,sz*.45,sz*.7]);
 }
 for(const [dx,dz] of [[-12.4,-10.5],[12.4,9.5]])for(let i=0;i<60;i++){
  const t=rand(),along=(rand()-.5)*7,sz=.12+Math.pow(rand(),1.7)*.78;
  const x=dx+(1-t)*Math.sign(dx)*.9-Math.sign(dx)*Math.pow(t,1.6)*2.6;
  put(fracturedRock(i+900+dz),i%3===0?carved:stone,[x,sz*.26+(1-t)*.34,dz+along],[rand(),rand()*6,rand()],[sz,sz*.5,sz*.8]);
 }
 // The code has broken two vault bays above x = +10.6, z = 0 and z = +6 since
 // last night and nothing on the floor acknowledged it. This is what came down:
 // the keystone, three rib segments and a stack of toppled pier drums whose
 // radius visibly matches the shafts overhead - which is what sells it.
 put(brokenSlab(1.35,.85,1.25,4141),carved,[10.55,.42,3.1],[.13,.42,-.09]);
 for(const [x,y,z,a,b,c] of [[10.9,.34,1.5,.2,.9,-.24],[9.95,.28,4.4,-.16,2.4,.1],[11.4,.3,5.6,.08,-.7,.21]])
  put(new T.CylinderGeometry(.19,.22,2.6,7),carved,[x,y,z],[a,b,c]);
 for(let i=0;i<4;i++)put(new T.CylinderGeometry(.62,.62,.9,12),stone,[10.2+i*.34,.46+i*.04,6.6-i*.72],[Math.PI/2+(rand()-.5)*.24,rand()*6,(rand()-.5)*.3]);
 for(let i=0;i<26;i++){const a=rand()*6.28,r=Math.pow(rand(),.6)*2.3,sz=.06+rand()*.2;
  put(fracturedRock(i+4200),stone,[10.55+Math.cos(a)*r,.02+sz*.1,3.1+Math.sin(a)*r*1.5],[0,a,rand()*.2],[sz,sz*.22,sz*.75]);}
 // Small chips collect at broken stonework, rather than a uniform random
 // carpet. Their longest edges point away from each local collapse source.
 const debrisSources=[[-10.35,-9],[10.3,5.5],[10.1,7.1],[-10.3,14.5],[10.5,-14.2],[-7.7,-18.8],[7.5,-18.9]];
 for(const [cx,cz] of debrisSources)for(let i=0;i<48;i++){
  const angle=rand()*Math.PI*2,radius=.18+Math.pow(rand(),1.6)*1.35;
  const x=cx+Math.cos(angle)*radius,z=cz+Math.sin(angle)*radius;
  const size=.025+rand()*.13,chip=fracturedRock(i+Math.round(cx*91+cz*13));
  put(chip,i%3===0?carved:stone,[x,.026+size*.11,z],[0,angle,rand()*.14],[size,size*.17,size*(.55+rand()*.7)]);
 }
 // Wall funerary monuments, shields and recessed grave plaques.
 for(const z of [-12,-6,0,6,12])for(const s of [-1,1]){
 const x=s*12.2;box(x,1.05,z,.5,2.1,1.4,carved);box(x,2.15,z,.75,.18,1.6);
 for(const dz of [-.5,.5])cyl(x-s*.2,1.1,z+dz,.045,1.5,brass,6);
 box(x-s*.32,1.25,z,.04,.85,.48,dark);
 }
 // The funerary seal inlaid into the open fighting floor. Round 4 (17 Sep, afternoon): the three iron hoops and 24
 // zigzag tubes read as "random stripes" (the user); replaced by a generated inlay (assets/environment/floor-seal.png:
 // brass and iron tracery, alpha between the metal) laid flat as one decal 10.6 m across at the same centre, with a
 // normal map derived from it for the relief and an ember emissive the fight breathes into (sealHeat: a faint
 // smoulder in the grooves through phase one, a slow pulse once the last vow is broken). Under the Reflector, so
 // the wet floor mirrors it like everything else on the flagstones.
 let seal=null;
 if(sealTexture){
  const sealGeometry=new T.CircleGeometry(5.3,96);sealGeometry.rotateX(-Math.PI/2);
  const sealMat=new T.MeshStandardMaterial({map:sealTexture,normalMap:sealNormal||null,normalScale:new T.Vector2(.9,.9),alphaTest:.4,roughness:.40,metalness:.78,color:0x8e9298,emissive:new T.Color(0xff4a16),emissiveMap:sealTexture,emissiveIntensity:0,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2});
  seal=new T.Mesh(sealGeometry,sealMat);seal.position.set(0,.012,-3);seal.name='floor seal';seal.castShadow=false;seal.receiveShadow=true;seal.renderOrder=0;root.add(seal);
 }
 let sealHeatTarget=.03,sealHeatNow=0;
 for(const sx of [-1,1])for(const xx of [4.7,7,9.3,11.6]){arch(sx*xx,-19.4,1.65,4.2,2.8,0,.09);cyl(sx*(xx-.9),2.3,-19.4,.09,4.6,carved,8);cyl(sx*(xx+.9),2.3,-19.4,.09,4.6,carved,8);}
 // The west end had nothing at all on the two big flanking walls, so the whole
 // return view was a grey field with a door in it. Same blind register as the
 // apse, plus a gallery of cusped panels above it.
 for(const sx of [-1,1])for(const xx of [4.7,7,9.3,11.6]){
  arch(sx*xx,19.4,1.65,4.2,2.8,0,.09);
  cyl(sx*(xx-.9),2.3,19.4,.09,4.6,carved,8);cyl(sx*(xx+.9),2.3,19.4,.09,4.6,carved,8);
  arch(sx*xx,19.35,1.5,8.1,1.9,0,.062);
  cyl(sx*xx,9.4,19.34,.055,2.3,carved,6);
  put(new T.TorusGeometry(.28,.032,5,20),carved,[sx*xx,11.15,19.33]);
 }
 for(const sx of [-1,1]){box(sx*8.2,7.5,19.42,9.2,.17,.26,carved);box(sx*8.2,7.67,19.48,9.2,.07,.17,stone);}
 // The west spandrel's pointed opening is slightly taller than the door leaves,
 // so two triangles of night sky - stars and all - showed through above the
 // door's shoulders. Same closure as the apse.
 box(0,6.4,20.74,7.9,13.4,.55,masonry);
 const [monument,monumentLow]=await Promise.all([
  new GLTFLoader().loadAsync(texturePaths.monument??new URL('../../assets/a-single-weathered-gothic-cathedral-fune-cmu1gsre.glb',import.meta.url).href),
  new GLTFLoader().loadAsync(texturePaths.monumentLod??new URL('../../assets/environment-lod/funerary-monument-lod.glb',import.meta.url).href),
 ]);
 if(textureCap)await Promise.all([monument.scene,monumentLow.scene].map(model=>capObjectTextures(model,textureCap)));
 const model=monument.scene;model.rotation.y=-Math.PI/2;model.updateMatrixWorld(true);const bounds=new T.Box3().setFromObject(model),sz=bounds.getSize(v(0,0,0));model.scale.multiplyScalar(3.7/sz.y);model.updateMatrixWorld(true);bounds.setFromObject(model);const cc=bounds.getCenter(v(0,0,0));model.position.set(-cc.x,-bounds.min.y,-cc.z);model.traverse(n=>{if(n.isMesh){n.castShadow=true;n.receiveShadow=true;n.material.color.multiplyScalar(.58);n.material.roughness=1;}});
 const lowModel=monumentLow.scene;lowModel.rotation.y=-Math.PI/2;lowModel.updateMatrixWorld(true);
 const lowBounds=new T.Box3().setFromObject(lowModel),lowSize=lowBounds.getSize(v(0,0,0));lowModel.scale.multiplyScalar(3.7/lowSize.y);lowModel.updateMatrixWorld(true);lowBounds.setFromObject(lowModel);const lowCenter=lowBounds.getCenter(v(0,0,0));lowModel.position.set(-lowCenter.x,-lowBounds.min.y,-lowCenter.z);
 const shrineMaterials=new Map();model.traverse(n=>{if(n.isMesh)shrineMaterials.set(n.material.name,n.material);});
 const unusedLodTextures=new Set();lowModel.traverse(n=>{if(n.isMesh){const shared=shrineMaterials.get(n.material.name);if(shared){for(const value of Object.values(n.material))if(value?.isTexture)unusedLodTextures.add(value);n.material.dispose();n.material=shared;}n.castShadow=true;n.receiveShadow=true;}});unusedLodTextures.forEach(texture=>texture.dispose());
 for(const side of [-1,1])for(const z of [-12,-6,0,6,12]){
  const shrine=new T.Group(),lod=new T.LOD();lod.addLevel(model.clone(true),0);lod.addLevel(lowModel.clone(true),22,.14);shrine.add(lod);shrine.position.set(side*12,0,z);shrine.rotation.y=-side*Math.PI/2;root.add(shrine);
  if(side===1&&z===6){
   // One fallen memorial makes the collapsed gallery legible from the floor.
   // Original generated geometry remains untouched, only its placement changes.
   shrine.rotateOnWorldAxis(v(1,0,0),-1.39);shrine.updateMatrixWorld(true);
   const fallenBounds=new T.Box3().setFromObject(shrine);shrine.position.y-=fallenBounds.min.y-.06;
  }
  shrine.updateMatrixWorld(true);cameraColliders.push(new T.Box3().setFromObject(shrine));
 }
 const lastShrine=new T.Group();lastShrine.add(model.clone(true));lastShrine.position.set(0,.55,-19.6);lastShrine.scale.setScalar(1.5);root.add(lastShrine);lastShrine.updateMatrixWorld(true);cameraColliders.push(new T.Box3().setFromObject(lastShrine));
// Collapsed north gallery: fallen vault ribs and fragments stay outside the
 // playable lanes. Their larger silhouette breaks the perfect left/right copy.
 for(const [x,z,angle] of [[10.3,4.8,.28],[11.1,7,-.65]]){
  tube([v(x,.15,z-2.1),v(x-.52,.48,z-.5),v(x-.35,.68,z+1.1)],.24,carved);
  put(brokenSlab(.95,.42,2.3,Math.round(x*31+z)),stone,[x+.35,.24,z],[0,angle,0]);
 }
 for(let i=0;i<45;i++){const x=9.7+rand()*2.7,z=3+rand()*6,sz=.12+rand()*.39;put(fracturedRock(i+700),stone,[x,sz*.37,z],[rand(),rand()*6,rand()],[sz,sz*.7,sz*1.3]);}
 // Flush grave covers, brass names worn smooth, and thin slabs interrupt the
 // tiled paving without creating invisible obstacles to dodge movement.
 const wornBrass=wearMetal(new T.MeshStandardMaterial({color:0xfbeeda,metalness:.7,roughness:.84}),{bump:.035});
 for(const side of [-1,1])for(const z of [-12,-6,0,6,12]){
  const x=side*7.6;
  box(x,.017,z,1.12,.024,2.36,carved,side*.013);
  box(x,.034,z-.67,.46,.018,.22,wornBrass);
  box(x,.034,z+.24,.035,.016,.66,wornBrass);box(x,.034,z+.08,.31,.016,.035,wornBrass);
  for(const dx of [-.48,.48])box(x+dx,.032,z,.026,.018,2.18,wornBrass);
 }
 // A few broken choir benches tucked behind the piers. Thick dark oak and
 // turned iron pegs have weight; the center stays a readable fighting space.
 const timber=new T.MeshStandardMaterial({color:0x27241e,roughness:.93,metalness:0});
 for(const side of [-1,1])for(const z of [-11.7,-5.6,6.1,12.4]){
  const x=side*11.1,broken=side===1&&z===6.1;
  box(x,.49,z,1.45,.13,broken?.76:2.25,timber,broken?.28:0);
  if(!broken){box(x+side*.64,.97,z,.1,.85,2.25,timber);for(const zz of [z-.86,z+.86]){box(x,.23,zz,.11,.47,.12,timber);box(x+side*.52,.23,zz,.11,.47,.12,timber);}}
  else{box(x-.4,.10,z+.94,.14,.12,1.3,timber,.73);box(x+.45,.10,z+.3,.12,.13,1.7,timber,-.31);}
 }
 // Every flame in the cathedral is an EMITTER, not a light. A fixed pool of
 // nine point lights is lerped onto the nine nearest emitters each frame;
 // everything further away is carried by the additive floor pools below.
 // Changing the light COUNT would re-hash three's lights state and recompile
 // every shader mid-fight, so the pool size never varies.
 const flames=[],lights=[],emitters=[];
 // Touch (17 Sep 2026, the user's pick): a phone pools 4 candle lights instead of 9, keeps 3 of the 5 vault uplights
 // and the effect flashes stay off (main.js), so a pixel evaluates 18 lights instead of 28; the cookie spots keep
 // their projection but cast no shadow there (three r186 refreshes a mapped spot's matrix itself, WebGLLights.js).
 const LIGHT_POOL=texturePaths.lightPool??9,lightBudget=!!texturePaths.lightBudget;
 const addEmitter=(x,y,z,color=0xffb16b,intensity=16,distance=5.5,weight=1)=>{emitters.push({position:v(x,y,z),color:new T.Color(color),intensity,distance,weight,phase:emitters.length*1.91});return emitters.length-1;};
 const wax=new T.MeshStandardMaterial({color:0xa89775,roughness:.9});
 const fireMat=new T.MeshBasicMaterial({color:0xffffff,vertexColors:true});
 const haloMat=new T.PointsMaterial({map:makeGlow(),color:0xffa342,size:.65,transparent:true,opacity:.19,depthWrite:false,blending:T.AdditiveBlending});
 const candles=CANDLE_STANDS;
 // Everything below is built with the arena's own material instances, so it is
 // merged into the existing per-material meshes: zero new draw calls, zero new
 // lights, zero colliders. The wicks join the one instanced flame mesh.
 const dressing={put,box,cyl,tube,flames,addEmitter,mats:{dark,brass,wax,carved,stone,timber}};
 for(const [x,z] of candles)candleStand(dressing,x,z,CANDLE_BASE_RADIUS);
 // The four mourning angels' stands (round 3; the statues themselves are merged in below, after the mourners):
 // x, z, yaw. Declared here because their votive candles join the flame list with the other candles.
 const ANGELS=[[-9.15,-15.6,Math.PI*.5+.35],[9.15,-15.6,-Math.PI*.5-.35],[-9.15,15.6,Math.PI*.5-.35],[9.15,15.6,-Math.PI*.5+.35]];
 // Votive candles at the feet of the four mourning angels (round 3), toward the nave.
 for(const [x,z] of ANGELS)votiveCluster(dressing,x,z,-Math.sign(x),0);
 // The apse blaze: three stepped tiers of votive candles behind the boss.
 // They join the existing instanced flame draw and the emitter list, so the
 // whole bank costs no extra draw call and no extra light.
 // Round 1 review: three straight, evenly spaced rows of identical candles
 // spanning the full shrine width read as a spreadsheet, which is a shame for
 // the strongest image in the apse. The candles are now CLUSTERED - a monotone
 // warp of the index bunches them into ranks of unequal length, four gaps per
 // tier leave real holes where candles have burned out, each tier is a
 // different width and slightly off centre, and the row wanders in z. The
 // number of rand() calls per candle is deliberately unchanged, so every
 // procedural placement downstream in the room is bit-for-bit what it was.
 for(let tier=0;tier<3;tier++){
  const z=-16.8-tier*.6,y=1.25+tier*.35;
  const half=3.5-tier*.42,centre=(tier-1)*.22;
  const gaps=[3+tier,11-tier,17+tier,24-tier*2];
  for(let i=0;i<28;i++){
   const t=i/27,warp=t+.052*Math.sin(t*Math.PI*3.7+tier*1.9)+.028*Math.sin(t*Math.PI*8.3+tier*2.7);
   const x=centre-half+warp*half*2+(rand()-.5)*.06,h=.13+rand()*.21;
   if(gaps.includes(i))continue;
   const dz=((i*7+tier*3)%5-2)*.055;
   cyl(x,y+h*.5,z+dz,.036+rand()*.012,h,wax,6);
   flames.push(v(x,y+h+.055,z+dz));
  }
  box(centre,y-.09,z,7.6,.18,.5,carved);
  addEmitter(centre,y+.5,z,0xffa055,11,6.4);
 }
 // Round 2 review, minor: the sanctuary steps read as a painted zebra - treads
 // at 60-75 against risers at 0-12. The hundred votive candles right above them
 // are emissive geometry with no light in the pool, and the risers face back up
 // the nave, away from the warm point behind the shrine, so GTAO's contact term
 // finished them off. Two low emitters standing IN FRONT of the steps put a
 // grazing warm light on the risers. They are pool emitters, not new lights:
 // the nine-light pool picks them up when the camera is in the sanctuary and
 // drops them when it is not, so this costs nothing in the fight.
 for(const z of [-14.9,-16.2])addEmitter(0,.62,z,0xffa768,6.5,5.2,.55);
 // Spent candles and hardened wax collect at the shrine and candle stands.
 for(const [x,z] of candles){
  for(let i=0;i<4;i++){const a=rand()*6.28,r=.24+rand()*.22;cyl(x+Math.cos(a)*r,.013,z+Math.sin(a)*r,.028+rand()*.045,.018,wax,7);}
  if(Math.abs(z)>13){const a=rand()*6.28;put(new T.CylinderGeometry(.038,.043,.17,7),wax,[x+.45,.045,z+.17],[0,a,Math.PI/2]);}
 }
 // Hanging coronae, branched candelabra and aisle-wall sconces. The band
 // y = 3 - 11 m was empty, which is why the room read as a floor with walls.
 addFittings(dressing);
 ironwork(dressing);
 bannerRods(dressing);
 // Thuribles on chains over the aisle bays (round 2): the band y = 3-5 over the
 // aisles had nothing hanging in it, and a censer is the one fitting that says
 // "rite" rather than "furniture". Same materials, same put(), zero draw calls.
 censers(dressing);
 // One small tapered, colored flame per wick; silhouette and heat variation
 // share the existing instanced draw rather than stacking luminous spheres.
 const flameMesh=new T.InstancedMesh(makeCandleFlame(),fireMat,flames.length);flameMesh.instanceMatrix.setUsage(T.DynamicDrawUsage);root.add(flameMesh);
 for(let i=0;i<flames.length;i++){const warmth=.5+.5*Math.sin(i*2.37);flameMesh.setColorAt(i,new T.Color(1,.94+warmth*.06,.91+warmth*.09));}
 const flameMesh_=flameMesh;flameMesh_.name='candle flames';
 const haloGeometry=new T.BufferGeometry();haloGeometry.setAttribute('position',new T.Float32BufferAttribute(flames.flatMap(p=>[p.x,p.y+.05,p.z]),3));root.add(new T.Points(haloGeometry,haloMat));
 // Reflection-only flame glow (round 2, the flicker complaint). In the mirror
 // every flame core is a one- or two-texel speck that blinks with sub-texel
 // camera motion; this puts a soft, several-texel warm blob at every wick that
 // only the puddle pass draws (puddles.js shows puddleReflectionOnly nodes for
 // the mirror render and hides them again). A candle seen in standing water
 // is a smeared glow, never a pixel, so the mirror looks MORE like water, not
 // less. Linear HDR colour: the reflector's own curve boosts it into a flame.
 const mirrorFlames=new T.Points(haloGeometry,new T.PointsMaterial({map:makeGlow(),color:new T.Color(2.4,1.35,.5),size:.085,transparent:true,opacity:1,depthWrite:false,blending:T.AdditiveBlending}));
 mirrorFlames.name='reflected flame glow';mirrorFlames.visible=false;mirrorFlames.userData.puddleReflectionOnly=true;mirrorFlames.castShadow=false;root.add(mirrorFlames);
 const flameMatrix=new T.Matrix4(),flameScale=v(1,1,1),flameRotation=new T.Quaternion(),flameEuler=new T.Euler();
 // Two octaves plus a rare gutter. One frequency across every wick is visibly
 // mechanical the moment the player stands still.
 const hash1=n=>{const x=Math.sin(n*127.1)*43758.5453;return x-Math.floor(x);};
 const flicker=(time,phase)=>(1+.11*Math.sin(time*7.3+phase)+.06*Math.sin(time*17.1+phase*2.7))*(1-.35*(hash1(Math.floor(time*3)+phase)>.985?1:0));
 // The pooled point LIGHTS flicker more gently than the flame meshes. Round 2:
 // with a glossier floor (chequered marble, derived roughness maps) a +-17 %
 // intensity swing on nine independently phased lights turned every candle
 // highlight on the floor into a pulsing speck - measured as frame-to-frame
 // change in the far floor regions that had nothing else moving. A candle
 // flame visibly dances; the light it throws a few metres away barely does.
 const lightFlicker=(time,phase)=>(1+.045*Math.sin(time*7.3+phase)+.02*Math.sin(time*17.1+phase*2.7))*(1-.15*(hash1(Math.floor(time*3)+phase)>.985?1:0));
 const updateFlames=time=>{
  flames.forEach((p,i)=>{
   const phase=i*2.37,body=.92+Math.sin(phase)*.065,gust=flicker(time,phase);
   flameScale.set(body*(1+Math.sin(time*4.1+phase)*.025),(.98+Math.sin(phase*1.7)*.065+Math.sin(time*5.8+phase)*.035)*gust,body);
   flameEuler.set(Math.sin(time*3.7+phase)*.055,phase,Math.sin(time*4.9+phase)*.07);
   flameRotation.setFromEuler(flameEuler);
   flameMesh.setMatrixAt(i,flameMatrix.compose(p,flameRotation,flameScale));
  });
  flameMesh.instanceMatrix.needsUpdate=true;
 };
 // Glass does not cast a shadow. This mattered the moment the clerestory wall
 // went in: with the aisle open to the sky the moon reached the nave over the
 // top of the wall, but once the only way in is the lancet openings, an
 // alpha-tested stained-glass pane standing in each of them blocks essentially
 // all of it - measured, raising the moon from 1.7 to 2.6 changed the whole
 // frame by 0.1 of a level, i.e. the moon was contributing nothing at all. The
 // panes now let light through and the OPENING shapes it, so the nave gets real
 // window projections; the tracery bars (material `dark`) still cast, so the
 // mullions and the transom are in the projection.
 const glass=new Set([windowMat,apseGlass,roseMat]);
 for(const [m,gs] of batches){const g=mergeGeometries(gs.map(g=>g.index?g.toNonIndexed():g),false);if(!g)continue;const mesh=new T.Mesh(g,m);mesh.castShadow=!glass.has(m);mesh.receiveShadow=true;if(glass.has(m))mesh.name='cathedral glass';root.add(mesh);gs.forEach(a=>a.dispose());}
 // Light pools on the floor: one merged additive mesh, no lights at all. A
 // soft disc under every window and every candle stand is what makes the floor
 // read as lit rather than tinted, and because they sit under the Reflector at
 // y<.012 the puddles pick them up for nothing.
 const glowTexture=makeGlow();
 const poolGeometries=[];
 const addPool=(x,z,radius,color,strength)=>{
  const g=new T.PlaneGeometry(radius*2,radius*2);g.rotateX(-Math.PI/2);g.translate(x,.006,z);
  const c=new T.Color(color).multiplyScalar(strength),count=g.attributes.position.count,tint=new Float32Array(count*3);
  for(let i=0;i<count;i++){tint[i*3]=c.r;tint[i*3+1]=c.g;tint[i*3+2]=c.b;}
  g.setAttribute('color',new T.Float32BufferAttribute(tint,3));poolGeometries.push(g);
 };
 // Tight, saturated amber right under each flame, plus a wide bounce term.
 //
 // Round 1 review: the wide terms summed additively across twelve stands and
 // three centreline discs and washed the ENTIRE playable floor a saturated
 // rust-orange - the flagstone joints, the 2.4 m tile grid, the grave covers
 // and the stain decals all disappeared under it, which is roughly half of
 // every combat frame. Proof: A-review1/probe/fightNoPools.jpg, the same camera
 // with this mesh hidden, comes back as cold readable stone.
 //
 // The rule the fix follows: the TIGHT cores carry the warmth (they sit where
 // candle light really lands and they are small enough to leave stone between
 // them), the WIDE bounce terms are cut to roughly a third and desaturated
 // toward 0xffa871, so they lift the floor's value without staining its hue.
 for(const [x,z] of candles){addPool(x,z,1.32,0xff8734,.185);addPool(x,z,3.6,0xffa871,.0078);}
 for(let tier=0;tier<3;tier++)addPool(0,-16.8-tier*.6,2.8,0xff8c40,.115);
 addPool(0,-15.6,5.6,0xffa871,.013);
 // Faint spill along the dark aisle wall, where the light is grazing.
 for(const z of [-12,-6,0,6,12])for(const dz of [-1.1,1.1])addPool(-12.1,z+dz,1.5,0x8fb2c6,.034);
 addPool(0,-13.2,4.4,0x7f93b4,.022);
 // Under the three nave coronae. The middle of the fighting floor is the wet
 // zone; a weak warm disc under each hanging light is where that light would
 // actually land, and the Reflector picks it up at y < .012 for nothing. Small
 // and faint enough that the flagstone grid still reads straight through them.
 for(const z of [-6,0,6])addPool(0,z,2.9,0xffa871,.013);
 addPool(0,12,2.7,0xffa871,.015);
 for(const x of [-5.4,5.4]){addPool(x,18.55,1.4,0xff8734,.155);addPool(x,17.4,4.4,0xffa871,.013);}
 const poolMesh=new T.Mesh(mergeGeometries(poolGeometries,false),new T.MeshBasicMaterial({map:glowTexture,vertexColors:true,transparent:true,depthWrite:false,blending:T.AdditiveBlending,toneMapped:true}));
 poolMesh.name='floor light pools';poolMesh.castShadow=false;poolMesh.receiveShadow=false;poolMesh.renderOrder=0;
 root.add(poolMesh);poolGeometries.forEach(g=>g.dispose());
 // Moonlight landing on the floor used to be ten round grey discs, which merged
 // into one milky smear down the left aisle and read as dirty fog: a round patch
 // cannot come out of a pointed lancet. These are the same positions, but they
 // are quads carrying the real tracery gobo, sheared along the moon's bearing so
 // the projection runs up the nave the way the shafts above them do.
 if(cookie){
  const windowGeometries=[],bearingYaw=Math.PI/4;
  const addWindowPool=(x,z,width,length,color,strength)=>{
   const g=new T.PlaneGeometry(width,length);g.rotateX(-Math.PI/2);g.rotateY(bearingYaw);g.translate(x,.0072,z);
   const c=new T.Color(color).multiplyScalar(strength),count=g.attributes.position.count,tint=new Float32Array(count*3);
   for(let i=0;i<count;i++){tint[i*3]=c.r;tint[i*3+1]=c.g;tint[i*3+2]=c.b;}
   g.setAttribute('color',new T.Float32BufferAttribute(tint,3));windowGeometries.push(g);
  };
  // Round 1 review: at .075 with a hard-ish falloff these read as pale
  // parallelograms of paper lying on the nave. Moonlight that has travelled
  // 17 m through haze is dimmer than the candle cores it was competing with,
  // so the strength is cut to .040 and the falloff feathered much further (see
  // the exponents below): the patch now has no locatable edge at all.
  for(const z of [-12,-6,0,6,12])for(const dz of [-1.1,1.1])addWindowPool(-4.5,z+dz+8.26,3.6,6.2,0x9fc4dc,.028);
  // Sampling the tracery gobo directly gave hard-edged white strips - a zebra
  // crossing painted on the nave. Light that has travelled 17 m through haze
  // does not have edges: this is a soft parallelogram with three barely-there
  // mullion bars and a transom, feathered on every side, fading out along the
  // throw. It is the light, not a picture of the window.
  const windowPools=new T.Mesh(mergeGeometries(windowGeometries,false),new T.ShaderMaterial({
   transparent:true,depthWrite:false,blending:T.AdditiveBlending,fog:false,
   uniforms:{},
   vertexShader:'attribute vec3 color;varying vec2 vUv;varying vec3 vTint;void main(){vUv=uv;vTint=color;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
   fragmentShader:`varying vec2 vUv;varying vec3 vTint;
    void main(){
     vec2 d=vUv-.5;
     // The patch itself: soft on the long axis, softer still at the far end.
     float across=pow(max(cos(d.x*3.14159),0.),2.8);
     float along=pow(max(cos(d.y*3.14159),0.),2.1)*mix(1.15,.5,smoothstep(-.5,.5,d.y));
     float body=across*along;
     // Two mullion shadows and one transom, wide and shallow: a suggestion of
     // tracery, not a stencil.
     // Squares, not pow(): pow() is undefined for a negative base and NaN on Apple GPUs (see rendering.js, 17 Sep).
     float m1=(vUv.x-.34)/.052,m2=(vUv.x-.66)/.052,tr=(vUv.y-.63)/.038;
     float mullion=1.-.30*(exp(-m1*m1)+exp(-m2*m2));
     float transom=1.-.22*exp(-tr*tr);
     gl_FragColor=vec4(vTint*body*mullion*transom,1.);
    }`}));
  windowPools.name='window projections';windowPools.castShadow=false;windowPools.receiveShadow=false;windowPools.renderOrder=0;
  root.add(windowPools);windowGeometries.forEach(g=>g.dispose());
 }
 // Ground haze: three cross-nave curtains instead of seven camera-facing cards
 // at opacity .014, which were numerically invisible. OCCLUDING haze creates
 // depth; additive haze only creates fog-milk. None of them may sit between
 // z = -3 and z = +8, where the duel actually happens.
 const fogTex=makeGlow();
 const hazeMat=new T.ShaderMaterial({transparent:true,depthWrite:false,side:T.DoubleSide,fog:false,
  uniforms:{uTime:{value:0}},
  vertexShader:'varying vec3 vW;varying vec3 vN;void main(){vW=(modelMatrix*vec4(position,1.)).xyz;vN=normalize(mat3(modelMatrix)*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
  fragmentShader:`varying vec3 vW;varying vec3 vN;uniform float uTime;
   float hh(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
   float hn(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
    return mix(mix(mix(hh(i),hh(i+vec3(1,0,0)),f.x),mix(hh(i+vec3(0,1,0)),hh(i+vec3(1,1,0)),f.x),f.y),
               mix(mix(hh(i+vec3(0,0,1)),hh(i+vec3(1,0,1)),f.x),mix(hh(i+vec3(0,1,1)),hh(i+vec3(1,1,1)),f.x),f.y),f.z);}
   void main(){
    vec3 view=normalize(cameraPosition-vW);
    float edge=pow(max(1.-abs(dot(normalize(vN),view)),0.),.4);
    float body=hn(vW*.3-vec3(0.,0.,uTime*.02))*.65+hn(vW*.82+vec3(uTime*.015,0.,0.))*.35;
    float alpha=body*(1.-smoothstep(0.,7.,vW.y))*edge*.075;
    gl_FragColor=vec4(mix(vec3(.010,.015,.021),vec3(.030,.021,.014),smoothstep(-6.,-16.,vW.z)),alpha);
   }`});
 const fogPlanes=[];
 for(const z of [-14,-4,9]){
  const curtain=new T.Mesh(new T.PlaneGeometry(26,9),hazeMat);
  curtain.position.set(0,4.2,z);curtain.userData.noPuddleReflection=true;
  curtain.castShadow=false;curtain.receiveShadow=false;curtain.renderOrder=2;
  root.add(curtain);fogPlanes.push(curtain);
 }
 // Dust: 240 of the 600 motes ride the nine moonlight shafts, the rest stay
 // ambient. Additive plus vertex colours gives the ~8x brightness ratio between
 // a mote inside a beam and one in the dark without a custom shader.
 const positions=new Float32Array(600*3),dustColor=new Float32Array(600*3),dustPhase=new Float32Array(600);
 const shaftBearing=v(11,-17,11).normalize(),shaftZ=[-13.1,-10.9,-7.1,-4.9,-1.1,1.1,5.1,7.1,11.1];
 for(let i=0;i<600;i++){
  const beam=i<240;
  if(beam){
   const z=shaftZ[i%9],t=rand()*17.1;
   const p=v(-12.55,12.6,z).addScaledVector(shaftBearing,t);
   positions[i*3]=p.x+(rand()-.5)*1.5;positions[i*3+1]=p.y+(rand()-.5)*.9;positions[i*3+2]=p.z+(rand()-.5)*1.5;
   dustColor[i*3]=2.6;dustColor[i*3+1]=2.9;dustColor[i*3+2]=3.2;
  }else{
   positions[i*3]=(rand()-.5)*26;positions[i*3+1]=rand()*16;positions[i*3+2]=(rand()-.5)*43;
   dustColor[i*3]=.30;dustColor[i*3+1]=.33;dustColor[i*3+2]=.36;
  }
  dustPhase[i]=rand()*6.283;
 }
 const dustG=new T.BufferGeometry();
 dustG.setAttribute('position',new T.BufferAttribute(positions,3));
 dustG.setAttribute('color',new T.BufferAttribute(dustColor,3));
 dustG.setAttribute('aPhase',new T.BufferAttribute(dustPhase,1));
 const dustMat=new T.PointsMaterial({map:fogTex,vertexColors:true,size:.032,transparent:true,opacity:1,depthWrite:false,blending:T.AdditiveBlending});
 const dustUniforms={uTime:{value:0}};
 dustMat.onBeforeCompile=shader=>{
  shader.uniforms.uTime=dustUniforms.uTime;
  shader.vertexShader=shader.vertexShader
   .replace('#include <common>','#include <common>\nattribute float aPhase;uniform float uTime;')
   .replace('#include <begin_vertex>','#include <begin_vertex>\n transformed.x+=sin(uTime*.21+aPhase)*.16;\n transformed.y+=sin(uTime*.13+aPhase*1.7)*.11;\n transformed.z+=cos(uTime*.17+aPhase*.7)*.16;')
   .replace('gl_PointSize = size;','gl_PointSize = size * (0.65 + 0.55 * sin(uTime*1.7+aPhase*3.1));');
 };
 dustMat.customProgramCacheKey=()=>'vesper-dust-drift-v1';
 const dust=new T.Points(dustG,dustMat);dust.userData.noPuddleReflection=true;root.add(dust);
 // The cathedral is lit by contrast, not by level. A flat blue-grey fill from
 // three directions is what made the old build read as a grey model: the
 // hemisphere is halved and split across the warm/cold axis, the moon is the
 // only shadow caster, and the former `rim` DirectionalLight is gone - the
 // cookie spotlights below replace it with light that has a shape.
 // 17 Sep: .16 -> .24 (user: "the walls at the sides slightly more visible, just a tiny bit"; .21 measured only
 // +6/+12 % on the side walls). The ground colour is near black, so this lifts the walls and the vaults, not the
 // flagstones.
 const ambient=new T.HemisphereLight(0x53707f,0x080604,.24);scene.add(ambient);
 // The shadow camera used to cover only the middle of the nave (left/right +-12
 // in LIGHT space against a room that needs +-25 on that axis, because the moon
 // comes in on a diagonal). Everything outside a shadow frustum is treated as
 // fully lit, and while the roof was open that was invisible - the floor got
 // direct moonlight either way. With the vault closed it became a razor-straight
 // diagonal wedge of unshadowed floor across the whole near left of every frame.
 // The extents below are computed from the room's corners projected onto the
 // light's own axes (x +-13.6, y 0-18, z +-21 gives u +-24.5, v -21.2..27.1),
 // and the near plane goes NEGATIVE so the vault over the apse - which sits
 // behind the light plane - still casts.
 const moon=new T.DirectionalLight(0xc9dfec,2.0);moon.position.set(-8,17,-8);moon.target.position.set(3,0,3);moon.castShadow=true;moon.shadow.mapSize.set(Math.round(3072*shadowScale),Math.round(3072*shadowScale));Object.assign(moon.shadow.camera,{left:-25.5,right:25.5,top:28,bottom:-22,near:-15,far:62});moon.shadow.bias=-.00035;moon.shadow.normalBias=.03;moon.shadow.radius=3;scene.add(moon,moon.target);
 // This sat 1.5 m in front of the apse spandrel at 18 intensity, so inverse
 // square blew the middle of that wall into a flat white panel behind the boss.
 // Low and warm, tucked behind the votive bank: it lifts the boss's back and
 // the sanctuary steps out of the dark. At 18 intensity up at head height it
 // was simply washing the apse wall into a flat white panel.
 const back=new T.PointLight(0xffb37a,7,13,2);back.position.set(0,1.9,-18.1);scene.add(back);
 // Readability insurance. One dim cold point rides just behind and above the
 // camera so a dark-armoured silhouette never vanishes into a black corner.
 // It is repositioned in update(time,camera); no new light is ever created.
 const cameraFill=new T.PointLight(0x8ea4b4,1.5,7,2);scene.add(cameraFill);
 // The silhouette kicker: one cold rim parked off the fight centre at a
 // three-quarter back angle so a black-armoured shoulder always has an edge.
 // Created here, during the loading screen - a light created later re-hashes
 // three's lights state and recompiles every shader mid-fight.
 const kicker=new T.SpotLight(0xa8c6db,26,16,.78,1,1.6);kicker.castShadow=false;
 kicker.position.set(0,3.4,6);kicker.target.position.set(0,1.3,0);scene.add(kicker,kicker.target);
 // Round 2 review, major: at every camera angle the game allows (pitch is
 // clamped to <= .6 and NEGATIVE pitch is the only way to look up, so -0.08 is
 // as high as anyone can ever look) the top third of the frame was flat black.
 // The ribs, the bosses, the vault webs, the string course and the gargoyles
 // were all built and all invisible. The interest has to come down into the
 // band you can actually see, so the three nave coronae now throw upward as
 // well as down - which is what a ring of ninety candles at 6.6 m does - and
 // the vault ribs above them read as architecture. castShadow stays false and
 // all three are created here, during the loading screen, so three's lights
 // state is never re-hashed mid-fight.
 // Integration fix, round 3: there were two of these, at z = -6 and +6, with a
 // .62 half-angle. From 7.25 m that cone is 3.3 m across at the crown, so it lit
 // a column over each corona and nothing else - the springing at x = +-10.7, the
 // ribs and the bay between the chandeliers all stayed at zero. One per corona
 // that actually hangs in the room (set-dressing.js addFittings: z -6, 0, +6,
 // +12 at 6.6 m and the apse crown at -17.5, 7.4 m), and wide enough that the
 // cone reaches the springing rather than only the ridge. castShadow stays
 // false and every one is still created here, during the loading screen, so
 // three's lights state is never re-hashed mid-fight.
 for(const [z,y,intensity] of [[-17.5,7.9,23],[-6,7.25,26],[0,7.25,26],[6,7.25,26],[12,7.25,20]].filter(([z])=>!lightBudget||Math.abs(z)<=6)){
  const up=new T.SpotLight(0xffa765,intensity,15.5,.95,1,1.3);
  up.castShadow=false;up.name='vault uplight';
  up.position.set(0,y,z);up.target.position.set(0,17.2,z);
  scene.add(up,up.target);
 }
 const fillForward=v(0,0,0),fillOffset=v(0,0,0),kickCentre=v(0,0,0),kickDir=v(0,0,0);
 for(let i=0;i<LIGHT_POOL;i++){
  const light=new T.PointLight(0xffb16b,0,5.5,2);light.position.set(0,2,0);root.add(light);
  lights.push(light);light.userData.emitter=-1;light.userData.blend=0;
 }
 const poolOrder=emitters.map((_,i)=>i);
 // Cookie spotlights. A mapped SpotLight projects through shadow.matrix, which
 // three only refreshes for lights in the shadow list, so castShadow must stay
 // true or the cookie smears across the whole scene from a stale matrix. The
 // cathedral is static, so each map is rendered once at load and then frozen.
 const spots=[];
 const addSpot=(position,target,{angle,penumbra,distance,intensity,color,map,size})=>{
  const spot=new T.SpotLight(color,intensity,distance,angle,penumbra,1);
  spot.position.set(...position);spot.target.position.set(...target);
  if(map)spot.map=map;
  spot.castShadow=!lightBudget;const mapSize=Math.max(256,Math.round(size*shadowScale));spot.shadow.mapSize.set(mapSize,mapSize);
  spot.shadow.camera.near=2;spot.shadow.camera.far=40;spot.shadow.bias=-.0004;spot.shadow.normalBias=.04;
  spot.shadow.autoUpdate=false;spot.shadow.needsUpdate=true;
  scene.add(spot,spot.target);spots.push(spot);return spot;
 };
 // The only figurative sculpture in the game was one funerary GLB cloned ten
 // times identically down both walls, while a hooded mourner and a gargoyle
 // generated last night sat on disk wired to nothing. Both are decimated to a
 // usable budget by scripts/blender/decimate-props.py (147 k -> 8 k, 143 k ->
 // 5 k) and merged into one mesh each, wearing the shared limestone.
 const mourners=await mergedProp(new GLTFLoader(),new URL('../../assets/environment-lod/mourner-lod.glb',import.meta.url).href,2.45,[
  [-5.4,.58,-18.15,.34],[5.4,.58,-18.15,-.34],
  [-7.7,0,-19.0,.15],[7.7,0,-19.0,-.15],
  [-3.95,0,18.35,Math.PI-.2],[3.95,0,18.35,Math.PI+.2],
  [-12.35,1.05,-6,Math.PI/2,0,0,.92],[12.35,1.05,6,-Math.PI/2,0,0,.92],
 ],tintByPlacement);
 if(mourners){const mesh=new T.Mesh(mourners,carved);mesh.name='hooded mourners';mesh.castShadow=true;mesh.receiveShadow=true;root.add(mesh);}
 // Round 3 (16 Sep evening, graphics pass): four mourning angels on plinths at the corners of the fighting floor
 // - the one figurative silhouette the lock-on camera never had in frame - and two fallen columns, one in the
 // collapsed bay and one at the west end, so the ruin has a fall in it and not only rubble. Both generated on
 // 16 Sep (docs/asset-plan.md), decimated by scripts/blender/decimate-props-round3.py, merged into one mesh each
 // wearing the shared limestone. The angels stand 0.3 m inside the floor's edge, so they carry ground colliders.
 const angels=await mergedProp(new GLTFLoader(),new URL('../../assets/environment-lod/angel-lod.glb',import.meta.url).href,3.0,ANGELS.map(([x,z,yaw])=>[x,0,z,yaw]),tintByPlacement);
 if(angels){const mesh=new T.Mesh(angels,carved);mesh.name='mourning angels';mesh.castShadow=true;mesh.receiveShadow=true;root.add(mesh);}
 for(const [x,z] of ANGELS)cameraBox(x,1.5,z,1.15,3.05,1.15);
 const propColliders=ANGELS.map(([x,z])=>({x,z,radius:.8}));
 const COLUMNS=[[11.25,-.6,.15],[8.1,17.9,Math.PI/2+.2]];
 const columns=await mergedProp(new GLTFLoader(),new URL('../../assets/environment-lod/fallen-column-lod.glb',import.meta.url).href,2.1,COLUMNS.map(([x,z,yaw])=>[x,0,z,yaw]),tintByPlacement);
 if(columns){const mesh=new T.Mesh(columns,carved);mesh.name='fallen columns';mesh.castShadow=true;mesh.receiveShadow=true;root.add(mesh);}
 cameraBox(11.25,1,-.6,2.4,2.1,3.3);cameraBox(8.1,1,17.9,3.3,2.1,2.4);
 // Gargoyles crouched on the gallery string course, leaning out over the nave.
 // castShadow stays off: they are 9 m up and small, and each one would cost a
 // pass through the moon's shadow map for pixels nobody can resolve.
 const gargoyles=await mergedProp(new GLTFLoader(),new URL('../../assets/environment-lod/gargoyle-lod.glb',import.meta.url).href,1.05,
  [-9,-3,3,9].flatMap(z=>[[-11.0,9.08,z,Math.PI/2,-.22,0],[11.0,9.08,z,-Math.PI/2,-.22,0]])
  // Round 2: eight more crouched on the nave pier capitals at 7.8 m, leaning
  // out over the fight - the "gargoyles on the pillars" of the DS3 reference,
  // and the first ones low enough to be in the lock-on frame.
  .concat([-15,-9,-3,3].flatMap(z=>[[-9.95,7.82,z,Math.PI/2,-.3,0,.85],[9.95,7.82,z,-Math.PI/2,-.3,0,.85]])),tintByPlacement);
 if(gargoyles){const mesh=new T.Mesh(gargoyles,carved);mesh.name='gallery gargoyles';mesh.castShadow=false;mesh.receiveShadow=true;root.add(mesh);}
 // The two nave washes now aim through the clerestory band rather than over the
 // top of a 8.6 m wall, and they carry the softened gobo, not the raw stencil.
 // Intensity is up from 145/120 because the new masonry blocks most of each
 // cone: what gets through is the window openings, which is the point. These
 // are what paints the window projections on the nave floor - measured at 230
 // the patch came back mean 101 with p99 218, i.e. nearly clipped, so 170/140
 // keeps the drama with the flagstone still reading inside it.
 addSpot([-16,15,-2],[2,0,2],{angle:.62,penumbra:1,distance:46,intensity:170,color:0x9fc4dc,map:softGobo,size:1024});
 addSpot([-16,14,9],[-1,0,13],{angle:.62,penumbra:1,distance:46,intensity:140,color:0x9fc4dc,map:softGobo,size:1024});
 const rose=addSpot([0,14.4,-20.2],[0,0,-6],{angle:.5,penumbra:.95,distance:34,intensity:70,color:0x8a6f9e,map:lancetTexture||cookie,size:512});
 const roseBase=70;
 // The statuary above loaded after the three cookie maps were baked and frozen.
 for(const spot of spots)spot.shadow.needsUpdate=true;
 // Recessed entrance leaves and a thin cold fog curtain make the rear
 // boundary read as a sealed doorway instead of an invisible rectangular void.
 // Without a map every one of the fourteen plank boxes wore one full oak
 // photograph stretched over it, which is most of why the west end read as a
 // flat panel. worldUV puts the grain on the same metre grid as the floor.
 // Round 1 review: the whole west end read as one flat dark blue-grey field -
 // the planks, the strap hinges, the studs and the ring handles all fell below
 // the exposure floor, and the player backs into that third of the frame
 // constantly. Two things fix it: warm oak albedo that separates from the cold
 // ashlar around it (0x2a2622 was darker than the stone it sits in), and deeper
 // grain relief so the plank edges catch the light added below.
 const doorWood=new T.MeshStandardMaterial({color:0x574636,roughness:.84,metalness:.02});
 if(oakTexture){doorWood.map=oakTexture;doorWood.bumpMap=oakTexture;doorWood.bumpScale=.10;}
 const doorGroup=new T.Group();doorGroup.name='sealed cathedral entrance';const doorPlanks=[],doorBands=[];
 for(let i=0;i<14;i++){
  const x=-2.83+i*.435,height=6.35+4.76*(1-Math.pow(Math.min(1,(Math.abs(x)+.23)/3),1.55));
  doorPlanks.push(new T.BoxGeometry(.416,height,.21).translate(x,height/2,20.34));
 }
 for(const y of [1.8,4.6,7.2]){
  doorBands.push(new T.BoxGeometry(5.73,.13,.055).translate(0,y,20.19));
  // Strap hinges running in from both jambs, with a forged spade terminal.
  for(const side of [-1,1]){
   doorBands.push(new T.BoxGeometry(2.1,.22,.05).translate(side*1.82,y,20.17));
   doorBands.push(new T.BoxGeometry(.46,.42,.045).translate(side*.8,y,20.16));
   doorBands.push(new T.CylinderGeometry(.09,.09,.62,7).rotateZ(Math.PI/2).translate(side*2.82,y,20.15));
  }
 }
 // Stud heads down every band, two ring handles and a lock plate: without them
 // fourteen planks and three strips read as a painted flat.
 for(const y of [1.8,4.6,7.2])for(let i=0;i<13;i++)
  doorBands.push(new T.SphereGeometry(.052,6,5).translate(-2.6+i*.433,y,20.13));
 for(const side of [-1,1]){
  doorBands.push(new T.TorusGeometry(.2,.032,5,16).rotateX(Math.PI/2).translate(side*.62,3.1,20.02));
  doorBands.push(new T.CylinderGeometry(.06,.06,.3,7).rotateX(Math.PI/2).translate(side*.62,3.32,20.12));
 }
 doorBands.push(new T.BoxGeometry(.72,.96,.05).translate(0,3.25,20.15));
 for(const [parts,material] of [[doorPlanks,doorWood],[doorBands,dark]]){const merged=mergeGeometries(parts);projectWorldUV(merged);const mesh=new T.Mesh(merged,material);mesh.castShadow=true;mesh.receiveShadow=true;doorGroup.add(mesh);parts.forEach(g=>g.dispose());}
 const doorFogMat=new T.ShaderMaterial({transparent:true,depthWrite:false,side:T.DoubleSide,uniforms:{time:{value:0}},
  vertexShader:'varying vec2 vGate;void main(){vGate=(uv+vec2(3.,0.))/vec2(6.,11.4);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
  fragmentShader:`varying vec2 vGate;uniform float time;
    float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
    void main(){vec2 p=vGate*vec2(9.,3.);p.y-=time*.06;float n=noise(p)*.65+noise(p*2.7+vec2(time*.025,0))*.35;
    float edge=smoothstep(0.,.28,vGate.x)*smoothstep(1.,.72,vGate.x);
    // Dense at the threshold, gone by head height. At a flat .10-.32 over a
    // 5.9 x 11.3 m gate this was the brightest surface in the game and read as
    // an unfinished white panel from anywhere in the nave.
    // Round 2 review, major: at .15-.75 over an 11.4 m gate the curtain was
    // still near full strength over the whole lower two thirds of the door -
    // exactly the part the player stands in front of - and its own colour
    // (r < g < b) is what the door leaf measured. Probe: hiding this one mesh
    // took the leaf from R43 G47 B52 (the coldest surface in the frame, colder
    // than the limestone jamb beside it) to R31 G32 B35, and the plank grain,
    // the bevels and the strap studs all came back. It is a threshold mist
    // now - dead by 1.5 m - so the oak below it is the door, not this.
    float height=1.-smoothstep(0.015,0.13,vGate.y);
    float alpha=(.015+n*.075)*edge*height;gl_FragColor=vec4(vec3(.13,.17,.20),alpha);}`});
 const entranceFog=new T.Mesh(pointedGateShape(),doorFogMat);entranceFog.position.z=19.92;doorGroup.add(entranceFog);root.add(doorGroup);
 cameraBox(0,5.6,20.34,5.9,11.2,.25);
 // The light that makes the leaves readable. It is where the two west
 // candelabra at x = +-5.4, z = 18.55 already stand, raked across the planks
 // from in front rather than aimed at them, so the strap hinges, the stud rows
 // and the plank shadow lines all get a grazing highlight and the door becomes
 // a shape you can find from the fighting floor. castShadow stays off - it is
 // created inside buildArena so three's lights-state hash never changes
 // mid-fight, and it costs no shadow map.
 const doorWash=new T.SpotLight(0xffb072,34,15.5,.92,1,1.4);
 doorWash.position.set(0,8.2,15.4);doorWash.target.position.set(0,3.2,20.3);
 doorWash.castShadow=false;doorWash.name='west door wash';
 scene.add(doorWash,doorWash.target);
 // Round 2: the cold key through the east window. The hero cameras' p95 sat at
 // 56-73 against the reference's 88 because nothing bright stood behind the
 // boss. This is the window's light landing on the sanctuary steps and on the
 // boss's back and shoulders - a cold rim against the warm votive bank, so his
 // silhouette separates from the apse at every angle. castShadow stays off and
 // it is created here, so three's lights state is never re-hashed mid-fight.
 const apseKey=new T.SpotLight(0xa9c9e0,70,36,.6,.85,1.2);
 apseKey.position.set(0,12.8,-22.6);apseKey.target.position.set(0,.4,-6);
 apseKey.castShadow=false;apseKey.name='apse cold key';
 scene.add(apseKey,apseKey.target);
 // Moonlight shafts that start at the real clerestory openings and land where
 // the moon's bearing actually puts them. The edge term fades a flat card out
 // as it turns side-on, so they read as volume instead of popping as decals.
 const shafts=[];
 const beamMat=new T.ShaderMaterial({transparent:true,depthWrite:false,side:T.DoubleSide,
  uniforms:{color:{value:new T.Color(0x9fc2d6)},time:{value:0},cookie:{value:cookie}},
  vertexShader:'varying vec2 vUv;varying vec3 vN;varying vec3 vW;void main(){vUv=uv;vN=normalize(mat3(modelMatrix)*normal);vW=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
  fragmentShader:`varying vec2 vUv;varying vec3 vN;varying vec3 vW;uniform vec3 color;uniform float time;uniform sampler2D cookie;
   float bh(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
   float bn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(bh(i),bh(i+vec2(1,0)),f.x),mix(bh(i+vec2(0,1)),bh(i+vec2(1,1)),f.x),f.y);}
   void main(){
    float across=pow(max(sin(vUv.x*3.14159),0.),2.);
    float along=pow(max(sin(vUv.y*3.14159),0.),.7)*smoothstep(0.,.22,vUv.y);
    vec3 viewDir=normalize(cameraPosition-vW);
    float edge=pow(max(1.-abs(dot(normalize(vN),viewDir)),0.),1.5);
    float drift=.78+.22*bn(vec2(vUv.y*3.4-time*.05,vUv.x*2.1));
    // The tracery gobo streaked along the shaft: a moonbeam through a traceried
    // window is banded, not a smooth wedge.
    float gobo=.62+.38*texture2D(cookie,vec2(vUv.x,fract(vUv.y*.55-time*.012))).r;
    gl_FragColor=vec4(color,across*along*edge*drift*gobo*.115);
   }`});
 {
  const bearing=v(11,-17,11).normalize();
  const travel=12.6/Math.abs(bearing.y);
  const yAxis=bearing.clone().multiplyScalar(-1);
  const zAxis=new T.Vector3().crossVectors(yAxis,v(0,1,0)).normalize();
  const xAxis=new T.Vector3().crossVectors(yAxis,zAxis).normalize();
  const basis=new T.Matrix4().makeBasis(xAxis,yAxis,zAxis);
  const orientation=new T.Quaternion().setFromRotationMatrix(basis);
  for(const [z,width] of [[-13.1,2.5],[-10.9,2.5],[-7.1,2.3],[-4.9,2.3],[-1.1,2.6],[1.1,2.6],[5.1,2.4],[7.1,2.4],[11.1,2.2]]){
   const start=v(-12.55,12.6,z);
   const mid=start.clone().addScaledVector(bearing,travel*.5);
   // The far end sinks 0.75 m past the floor so the intersection is buried in
   // stone instead of drawing a hard line across the flagstones.
   const beam=new T.Mesh(new T.PlaneGeometry(width,travel+.75),beamMat);
   beam.position.copy(mid).addScaledVector(bearing,.375);beam.quaternion.copy(orientation);
   beam.userData.noPuddleReflection=true;beam.castShadow=false;beam.receiveShadow=false;
   root.add(beam);shafts.push(beam);
  }
 }
 // Round 2: three steep cold shafts from the east window behind the boss,
 // landing on the sanctuary steps well behind the fight (nave-dressing.js).
 shafts.push(...apseShafts(beamMat,root));
 // The broken vault bays opened onto a flat scene.background, which read as a
 // texture error. Behind them is now an actual night: gradient, moon on the
 // same bearing as the light, drifting cloud and a thin star field.
 const skyMat=new T.ShaderMaterial({side:T.BackSide,depthWrite:false,fog:false,
  uniforms:{time:{value:0}},
  vertexShader:'varying vec3 vDir;void main(){vDir=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
  fragmentShader:`varying vec3 vDir;uniform float time;
   float sh(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
   float sn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(sh(i),sh(i+vec2(1,0)),f.x),mix(sh(i+vec2(0,1)),sh(i+vec2(1,1)),f.x),f.y);}
   void main(){
    float h=clamp(vDir.y*.5+.5,0.,1.);
    vec3 col=mix(vec3(.020,.031,.047),vec3(.043,.067,.098),smoothstep(.45,1.,h));
    vec3 moonDir=normalize(vec3(-8.,17.,-8.));
    float d=max(dot(normalize(vDir),moonDir),0.);
    col+=vec3(.62,.70,.80)*pow(max(d,0.),900.)*1.6;
    col+=vec3(.15,.20,.28)*pow(max(d,0.),14.)*.55;
    vec2 sp=vec2(atan(vDir.z,vDir.x)*.6,vDir.y*1.4);
    float stars=smoothstep(.9965,.9995,sh(floor(sp*260.)))*smoothstep(.05,.35,h);
    col+=vec3(.75,.82,.95)*stars*(.5+.5*sn(sp*40.+time*.05));
    float cloud=sn(sp*2.6+vec2(time*.012,0.))*.6+sn(sp*6.1-vec2(time*.02,0.))*.4;
    col=mix(col,vec3(.028,.036,.048),smoothstep(.48,.86,cloud)*.75*smoothstep(.02,.4,h));
    gl_FragColor=vec4(col,1.);
   }`});
 // Gothic tattered banners, valance swags and wall cloth: one mesh, one
 // material, real vertex-shader wind and a matching displaced shadow.
 const banners=await createBanners(ASSETS.bannerAtlas,{reliefPath:ASSETS.bannerDamask,swagPath:ASSETS.valanceSwag});
 if(banners)root.add(banners.mesh);
 // Localised stains: one merged mesh, one material, the 2x2 atlas on disk.
 if(stainTexture){
  // Round 1 review: the salt-bloom quadrant of the generated atlas is near
  // white (mean 108, 14 % of it above level 200) and it was drawn at full
  // albedo directly under the brightest local light in the room, so every
  // candle stand stood in what looked like spilled paint. Grime is never
  // brighter than the stone it sits on: the colour multiplier pulls the whole
  // sheet down to roughly the local flagstone value and the opacity keeps it
  // a stain rather than a decal.
  const stainMat=new T.MeshStandardMaterial({map:stainTexture,color:0x676d73,opacity:.72,transparent:true,depthWrite:false,roughness:1,metalness:0,side:T.DoubleSide,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2});
  const stainParts=[...stainDecals(),...floorStains(candles)];
  const stainGeometry=mergeGeometries(stainParts,false);stainParts.forEach(g=>g.dispose());
  if(stainGeometry){const mesh=new T.Mesh(stainGeometry,stainMat);mesh.name='stains';mesh.castShadow=false;mesh.receiveShadow=true;mesh.renderOrder=0;root.add(mesh);}
 }
 // Round 3: damage on the fighting floor from the generated atlas (nave-dressing.js floorDamageDecals). The
 // colour multiplier sits the cool grey of the sheet into the basalt: a decal lighter than the stone it lies
 // on is a sticker. Under the Reflector (y .010) so the puddles carry it too.
 if(damageTexture){
  // 0x33312f: measured against the first capture, at 0x5c5a58 the rubble read 2.5x lighter than the basalt.
  const damageMat=new T.MeshStandardMaterial({map:damageTexture,alphaTest:.5,side:T.DoubleSide,roughness:.97,metalness:0,color:0x33312f,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});
  const damageParts=floorDamageDecals(),damageGeometry=mergeGeometries(damageParts,false);damageParts.forEach(g=>g.dispose());
  if(damageGeometry){const mesh=new T.Mesh(damageGeometry,damageMat);mesh.name='floor damage';mesh.castShadow=false;mesh.receiveShadow=true;mesh.renderOrder=0;root.add(mesh);}
 }
 const skyDome=new T.Mesh(new T.SphereGeometry(80,24,16),skyMat);
 skyDome.name='night sky';skyDome.castShadow=false;skyDome.receiveShadow=false;
 skyDome.userData.noPuddleReflection=true;skyDome.renderOrder=-1;
 root.add(skyDome);
 // Litter on the aisle floors and at the west door (round 2): one instanced
 // draw from the debris sprite sheet. Placed LAST so the rand() draws leave
 // every earlier procedural placement bit-for-bit where it was.
 const debris=debrisScatter(debrisTexture,rand);if(debris)root.add(debris);
 return{setFloorStyle,root,lights,cameraColliders,groundColliders:[...candleGroundColliders(),...propColliders],
  /** 0..1: how much the seal's inlay smoulders (main.js: .12 at the start of a fight, 1 from the phase change). */
  sealHeat(value){sealHeatTarget=Math.max(0,Math.min(1,Number.isFinite(value)?value:0));},
  update(time,camera){
   // Second pass (user: the brass stood out too much): dark polished iron, near the basalt's own tone, read by
   // gloss and relief; almost no smoulder at rest, a low ember pulse in phase two.
   if(seal){sealHeatNow+=(sealHeatTarget-sealHeatNow)*.03;seal.material.emissiveIntensity=sealHeatNow*(.20+.10*Math.sin(time*1.1)+.04*Math.sin(time*3.7));}doorFogMat.uniforms.time.value=time;updateFlames(time);beamMat.uniforms.time.value=time;skyMat.uniforms.time.value=time;banners?.update(time);
  // Cloud crossing the moon: the rose projection breathes instead of sitting flat.
  rose.intensity=roseBase*(.72+.28*(.5+.5*Math.sin(time*.31)+.18*Math.sin(time*.77)));
  camera.getWorldDirection(fillForward);
  fillOffset.copy(fillForward).multiplyScalar(-1.2);
  cameraFill.position.set(camera.position.x+fillOffset.x,camera.position.y+1.6,camera.position.z+fillOffset.z);
  // Park the kicker off the fight centre at 132 degrees from the camera axis:
  // always a three-quarter back rim, never a second front light.
  kickCentre.set(camera.position.x+fillForward.x*4.6,0,camera.position.z+fillForward.z*4.6);
  kickDir.set(fillForward.x,0,fillForward.z).normalize().applyAxisAngle(v(0,1,0),2.3038);
  kicker.position.set(kickCentre.x+kickDir.x*6.5,3.4,kickCentre.z+kickDir.z*6.5);
  kicker.target.position.set(kickCentre.x,1.3,kickCentre.z);kicker.target.updateMatrixWorld();
  // Lerp the nine pooled lights onto the nine nearest emitters. Assignments
  // only change through an intensity fade, so a swap is never a pop.
  // Weighted by what the emitter actually lights: a corona washing a whole bay
  // outranks a candle stand two metres closer to the lens.
  poolOrder.sort((a,b)=>emitters[a].position.distanceToSquared(camera.position)*emitters[a].weight-emitters[b].position.distanceToSquared(camera.position)*emitters[b].weight);
  const wanted=poolOrder.slice(0,LIGHT_POOL),held=new Set();
  for(const light of lights)if(wanted.includes(light.userData.emitter))held.add(light.userData.emitter);
  const free=wanted.filter(i=>!held.has(i));
  for(const light of lights){
   const keep=wanted.includes(light.userData.emitter);
   if(!keep&&light.userData.blend<=.001&&free.length){light.userData.emitter=free.pop();light.userData.blend=0;}
   const active=wanted.includes(light.userData.emitter);
   light.userData.blend+=((active?1:0)-light.userData.blend)*Math.min(1,.16);
   const emitter=emitters[light.userData.emitter];
   if(!emitter){light.intensity=0;continue;}
   light.position.copy(emitter.position);light.color.copy(emitter.color);light.distance=emitter.distance;
   light.intensity=emitter.intensity*light.userData.blend*lightFlicker(time,emitter.phase);
  }dustUniforms.uTime.value=time;hazeMat.uniforms.uTime.value=time;}};
}
function makeCandleFlame(){
 const profile=[[.004,0],[.009,.006],[.016,.026],[.014,.047],[.009,.074],[.0038,.1],[0,.12]];
 const geometry=new T.LatheGeometry(profile.map(([r,y])=>new T.Vector2(r,y)),9);
 const position=geometry.attributes.position,colors=[];
 const base=new T.Color(3.2,1.25,.22),core=new T.Color(6.2,4.1,1.9),tip=new T.Color(3.8,1.6,.3),color=new T.Color();
 for(let i=0;i<position.count;i++){
  const y=position.getY(i),u=y/.12;
  position.setX(i,position.getX(i)+.003*u*u);
  color.copy(y<.032?base:core).lerp(y<.032?core:tip,y<.032?y/.032:Math.pow((y-.032)/.088,.8));
  colors.push(color.r,color.g,color.b);
 }
 geometry.setAttribute('color',new T.Float32BufferAttribute(colors,3));
 geometry.computeVertexNormals();return geometry;
}
function makeGlow(){const c=document.createElement('canvas');c.width=c.height=128;const x=c.getContext('2d');const g=x.createRadialGradient(64,64,0,64,64,64);g.addColorStop(0,'rgba(255,255,255,1)');g.addColorStop(.25,'rgba(255,255,255,.5)');g.addColorStop(1,'rgba(255,255,255,0)');x.fillStyle=g;x.fillRect(0,0,128,128);return new T.CanvasTexture(c);}
