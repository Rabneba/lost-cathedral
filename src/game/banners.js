import * as T from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

// Gothic tattered banners, valance swags and wall cloths. Every cloth in the
// cathedral is merged into ONE geometry per texture with ONE material. Every
// vertex carries aBanner = (phase, amplitude, 1/height, axis); the wind is a
// vertex displacement along world X (axis 0, cloth hanging on a side wall) or
// world Z (axis 1, cloth hanging across the nave), with the surface normal
// rebuilt from the analytic derivative - without that the light never rakes
// across the ripples and the cloth still reads as a flat decal.
//
// alphaTest, never transparent: torn hems then cast correctly shredded shadows,
// stay in the depth prepass and stay inside GTAO's contact grounding.

const COLUMNS=3;                 // banner atlas: black/gold skull | bone crown | crimson damask
const BANNER_Z=[-12,-6,0,6,12];

function tag(geometry,phase,amplitude,height,column,axis=0,columns=COLUMNS,zoom=1,{shiftU=0,shiftV=0,mirror=false}={}){
 const count=geometry.attributes.position.count;
 const data=new Float32Array(count*4);
 for(let i=0;i<count;i++){data[i*4]=phase;data[i*4+1]=amplitude;data[i*4+2]=1/height;data[i*4+3]=axis;}
 geometry.setAttribute('aBanner',new T.Float32BufferAttribute(data,4));
 const uv=geometry.attributes.uv;
 // The wind used to read its height along the cloth straight out of uv.y. That
 // silently coupled the simulation to the atlas packing: the moment a cloth
 // samples a sub-rectangle (zoom, below) the top of the banner would think it
 // was a third of the way down and flap off the wall. Height is captured here,
 // once, before any UV is touched, and the shader reads this instead.
 const heights=new Float32Array(count);
 for(let i=0;i<count;i++)heights[i]=1-uv.getY(i);
 geometry.setAttribute('aClothH',new T.Float32BufferAttribute(heights,1));
 // zoom > 1 samples a sub-rectangle of the atlas cell. The damask cell is a
 // seamless tile, so at 1:1 over a 2.4 m cloth its diamond motif repeats four
 // or five times across and reads as printed wallpaper from the aisle. Zooming
 // in enlarges the motif without leaving the cell (ClampToEdge, so no bleed).
 // Round 2 review, minor: with only the zoom the aisle rank was a literal ABAB
 // repeat - bay 1 and bay 3 were pixel-identical, bays 2 and 4 likewise, and all
 // ten damask cloths were the same motif at the same scale, so the wall read as
 // a wallpaper repeat. mirror and the two shifts pick a DIFFERENT sub-rectangle
 // of the same atlas cell per bay, so no two bays share a silhouette without
 // costing a texture, a material or a draw call. The shifts are clamped to keep
 // the sampled rectangle inside the cell: ClampToEdge would otherwise bleed the
 // neighbouring column in.
 const margin=Math.max(0,.5-.5/zoom);
 const clampShift=s=>Math.max(-margin,Math.min(margin,s));
 const u0=clampShift(shiftU),v0=clampShift(shiftV);
 if(zoom!==1||mirror||u0||v0)for(let i=0;i<uv.count;i++){
  const u=mirror?1-uv.getX(i):uv.getX(i);
  uv.setXY(i,.5+(u-.5)/zoom+u0,.5+(uv.getY(i)-.5)/zoom+v0);
 }
 if(columns>1)for(let i=0;i<uv.count;i++)uv.setX(i,(column+uv.getX(i))/columns);
 return geometry;
}

// A wall cloth with a real hanging profile and a torn hem. A PlaneGeometry
// pressed against ashlar is a rectangle of wallpaper however good the texture
// is: what makes cloth read as cloth is (a) a silhouette that is not a straight
// line and (b) folds deep enough for a raking candle to shade one side of each.
// Both are geometry here, because the damask has no alpha channel to cut with.
export function tatteredWallCloth(side,z,baseX,width,height,y,seed){
 const across=26,down=22,uvs=[],indices=[];
 const noise=n=>{const s=Math.sin(n*12.9898+seed*78.233)*43758.5453;return s-Math.floor(s);};
 // The hem: a ragged baseline plus two vertical rips that climb much higher.
 const rips=[.24+.5*noise(seed*3.1),.68+.22*noise(seed*5.7)];
 const hemAt=u=>{
  let cut=.045+.13*noise(u*7.3)+.07*noise(u*23.1);
  for(const rip of rips){const d=Math.abs(u-rip);if(d<.08)cut=Math.max(cut,(.28+.24*noise(seed*9.4))*(1-d/.08));}
  return Math.min(.58,cut);
 };
 // The folds: two harmonics of depth off the wall, deepest at the hem where a
 // hanging cloth is least constrained. Always positive, so the cloth never
 // intersects the ashlar behind it.
 const foldAt=(u,v)=>(.075+Math.sin(u*Math.PI*5+seed)*.055+Math.sin(u*Math.PI*11.3+seed*2.1)*.020)*(.30+.70*v);
 const count=(across+1)*(down+1),pos=new Float32Array(count*3);
 for(let j=0,k=0;j<=down;j++)for(let i=0;i<=across;i++,k++){
  const u=i/across,v=j/down,vv=v*(1-hemAt(u));
  pos[k*3]=side*(baseX-foldAt(u,vv));
  pos[k*3+1]=y-height*vv;
  pos[k*3+2]=z-width/2+width*u;
  uvs.push(u,1-vv);
  if(i<across&&j<down){const a=j*(across+1)+i;indices.push(a,a+across+1,a+1,a+1,a+across+1,a+across+2);}
 }
 const g=new T.BufferGeometry();
 g.setAttribute('position',new T.Float32BufferAttribute(pos,3));
 g.setAttribute('uv',new T.Float32BufferAttribute(uvs,2));
 g.setIndex(indices);g.computeVertexNormals();
 return g.toNonIndexed();
}

// A hanging cloth in the YZ plane: width runs along the nave, the normal points
// into the nave, and the wind pushes it off the wall.
function hangingCloth(side,z,y,width,height,segments,phase,amplitude,column,zoom=1,variation={}){
 const g=new T.PlaneGeometry(width,height,segments[0],segments[1]);
 g.rotateY(side<0?Math.PI/2:-Math.PI/2);
 tag(g,phase,amplitude,height,column,0,COLUMNS,zoom,variation);
 g.translate(side*11.15,y,z);
 return g;
}

// The valance: a continuous scalloped pelmet along the gallery string course,
// its lower edge dagged into points so the silhouette is cloth, not a ribbon.
function valanceStrip(side,phase){
 const scallops=24,across=scallops*3,down=4,z0=-15,z1=15,top=8.86,drop=1.25;
 const positions=[],uvs=[],indices=[];
 for(let j=0;j<=down;j++)for(let i=0;i<=across;i++){
  const u=i/across,vv=j/down;
  const z=z0+(z1-z0)*u;
  const scallop=Math.abs(Math.sin(u*Math.PI*scallops));
  const bottom=top-drop*(.45+.55*scallop);
  const y=top+(bottom-top)*vv;
  positions.push(side*11.15,y,z);
  uvs.push(u*scallops*.5,1-vv*.28);
  if(i<across&&j<down){const a=j*(across+1)+i;indices.push(a,a+across+1,a+1,a+1,a+across+1,a+across+2);}
 }
 const g=new T.BufferGeometry();
 g.setAttribute('position',new T.Float32BufferAttribute(positions,3));
 g.setAttribute('uv',new T.Float32BufferAttribute(uvs,2));
 g.setIndex(indices);g.computeVertexNormals();
 const flat=g.toNonIndexed();
 tag(flat,phase,.055,drop,2);
 return flat;
}

// The crimson swag row hung across the chancel, from the iron rod arena.js puts
// at y = 9.78, z = -16.1 between the z = -15 piers. This is the single image
// from the red-banner reference the room was missing: a deep oxblood velvet
// valance with a gold bullion fringe closing the far end above the boss. It is
// a real surface, not a card - each scallop bulges toward the nave.
function apseSwagRow(phase){
 const across=54,down=12,x0=-8.2,x1=8.2,top=9.9,height=3.7,z0=-16.1;
 const positions=[],uvs=[],indices=[];
 for(let j=0;j<=down;j++)for(let i=0;i<=across;i++){
  const u=i/across,vv=j/down;
  const bulge=Math.pow(Math.abs(Math.sin(u*Math.PI*3)),1.4)*.34*Math.pow(1-vv,.6);
  positions.push(x0+(x1-x0)*u,top-height*vv,z0+bulge);
  uvs.push(u,1-vv);
  if(i<across&&j<down){const a=j*(across+1)+i;indices.push(a,a+across+1,a+1,a+1,a+across+1,a+across+2);}
 }
 const g=new T.BufferGeometry();
 g.setAttribute('position',new T.Float32BufferAttribute(positions,3));
 g.setAttribute('uv',new T.Float32BufferAttribute(uvs,2));
 g.setIndex(indices);g.computeVertexNormals();
 const flat=g.toNonIndexed();
 tag(flat,phase,.085,height,0,1,1);
 return flat;
}

const WIND_COMMON=`
 attribute vec4 aBanner;
 attribute float aClothH;
 uniform float uTime;
 // axis 0: the cloth hangs on a side wall, width runs along Z, wind pushes X.
 // axis 1: the cloth hangs across the nave, width runs along X, wind pushes Z.
 vec3 bannerWind(vec3 transformed,vec3 position,float h,out float slopeAcross,out float slopeDown){
  float axis=aBanner.w;
  float amplitude=aBanner.y*h*h;
  float along=mix(position.z,position.x,axis);
  // Round 1 review measured the cloth over 1.2 s and found it moving at or
  // below the JPEG noise floor - 0.9-2.7 mean levels against 2.7-3.5 for a
  // STATIC stone pier used as a control. The amplitudes were not the whole
  // problem: at uTime*.55 the primary wave has an eleven-second period, so in
  // the second and a bit anyone looks at a banner it barely moves. A faster
  // primary plus a gust harmonic at 2.2x gives the hem visible travel inside a
  // single breath, which is what "fabric-like" means to someone playing.
  float w1=uTime*.82+aBanner.x+h*3.4+along*1.9;
  float w2=uTime*1.79+aBanner.x*1.7+h*2.2+along*3.6;
  // A third, much faster harmonic weighted to the hem. Round 2 review measured
  // the damask panels at 1.06-1.40 mean levels of change per second against a
  // 1.0 static control - real, but nothing you notice in the second you glance
  // at one. A 2 Hz flutter that is zero at the rod and full at the hem is what
  // a hanging cloth in a draught actually does, and it is what makes the motion
  // visible without letting the whole panel swing like a flag.
  float w3=uTime*3.07+aBanner.x*2.3+h*6.1+along*5.4;
  float wave=sin(w1)+.42*sin(w2)+.24*h*sin(w3);
  float push=wave*amplitude;
  float sway=sin(uTime*.67+aBanner.x+h*2.1)*amplitude*.35;
  transformed.x+=mix(push,sway,axis);
  transformed.z+=mix(sway,push,axis);
  // Conserve arc length. Without this the cloth rubber-stretches downward.
  transformed.y-=h*amplitude*.25;
  slopeAcross=(cos(w1)*1.9+.42*cos(w2)*3.6+.24*h*cos(w3)*5.4)*amplitude;
  slopeDown=-(cos(w1)*3.4+.42*cos(w2)*2.2+.24*(sin(w3)+h*cos(w3)*6.1))*amplitude*aBanner.z;
  return transformed;
 }`;

function injectWind(shader,uniforms){
 shader.uniforms.uTime=uniforms.uTime;
 shader.vertexShader=shader.vertexShader
  .replace('#include <common>','#include <common>'+WIND_COMMON)
  .replace('#include <begin_vertex>',`#include <begin_vertex>
   float bannerH=aClothH;
   float bannerSlopeAcross,bannerSlopeDown;
   transformed=bannerWind(transformed,position,bannerH,bannerSlopeAcross,bannerSlopeDown);`)
  .replace('#include <beginnormal_vertex>',`#include <beginnormal_vertex>
   float preH=aClothH;
   float preAcross,preDown;
   bannerWind(position,position,preH,preAcross,preDown);
   float bannerAxis=aBanner.w;
   float bannerFace=mix(objectNormal.x,objectNormal.z,bannerAxis);
   float bannerSide=bannerFace>=0.?1.:-1.;
   objectNormal=normalize(vec3(
    objectNormal.x-bannerAxis*preAcross*bannerSide,
    objectNormal.y-preDown*bannerSide,
    objectNormal.z-(1.-bannerAxis)*preAcross*bannerSide));`);
 return shader;
}

// Heavy cloth, not printed card: sheen is the one term that makes velvet read
// at a grazing angle, and the damask relief gives the wind something to shade.
function clothMaterial(texture,relief,{sheenColor,roughness=.94,color=0xffffff,glow=0}){
 const material=new T.MeshPhysicalMaterial({
  map:texture,alphaTest:.5,side:T.DoubleSide,
  color,roughness,metalness:0,
  sheen:1,sheenColor:new T.Color(sheenColor),sheenRoughness:.55,
  // Deep oxblood velvet at 0.01 linear albedo, nine metres up in a cathedral
  // lit by candles, is simply black. A trace of self-illumination from the
  // cloth's own colours is what keeps the crimson readable in the dark without
  // making the banners a light source or letting bloom find them.
  emissive:glow>0?0xffffff:0x000000,emissiveMap:glow>0?texture:null,emissiveIntensity:glow,
 });
 if(relief){material.bumpMap=relief;material.bumpScale=.016;}
 return material;
}

function clothMesh(parts,material,uniforms,key){
 const geometry=mergeGeometries(parts.map(g=>g.index?g.toNonIndexed():g),false);
 parts.forEach(g=>g.dispose());
 if(!geometry)return null;
 material.onBeforeCompile=shader=>injectWind(shader,uniforms);
 material.customProgramCacheKey=()=>key;
 const mesh=new T.Mesh(geometry,material);
 mesh.castShadow=true;mesh.receiveShadow=true;
 // The shadow pass uses MeshDepthMaterial, which knows nothing about the vertex
 // displacement: without the same injection a rippling banner casts a rigid
 // rectangle. The alpha map keeps the torn hem shredded in the shadow too.
 const depth=new T.MeshDepthMaterial({depthPacking:T.RGBADepthPacking,map:material.map,alphaTest:.5});
 depth.onBeforeCompile=shader=>injectWind(shader,uniforms);
 depth.customProgramCacheKey=()=>key+'-depth';
 mesh.customDepthMaterial=depth;
 return mesh;
}

export async function createBanners(atlasPath,{reliefPath,swagPath}={}){
 const loader=new T.TextureLoader();
 const [texture,relief,swag]=await Promise.all([
  loader.loadAsync(atlasPath).catch(()=>null),
  reliefPath?loader.loadAsync(reliefPath).catch(()=>null):Promise.resolve(null),
  swagPath?loader.loadAsync(swagPath).catch(()=>null):Promise.resolve(null),
 ]);
 if(!texture)return null;
 for(const t of [texture,swag]){if(!t)continue;t.colorSpace=T.SRGBColorSpace;t.wrapS=t.wrapT=T.ClampToEdgeWrapping;t.anisotropy=8;}
 // The relief is a tiling damask: it gets its own wrap and its own metre scale,
 // so one map serves all three atlas columns and both cloth meshes.
 if(relief){relief.wrapS=relief.wrapT=T.RepeatWrapping;relief.repeat.set(9,7);relief.anisotropy=4;}

 const group=new T.Group();group.name='Cathedral cloth';
 const uniforms={uTime:{value:0}};
 const parts=[];
 let phase=0;
 // Free-hanging nave banners, outside the pier line and well outside the
 // fighting floor, so they never need a collider of any kind. Wider and longer
 // than before: at 1.3 x 5.4 m they read as ribbons, and the defining feature
 // of the reference is the scale of the drop.
 // Round 2 review, minor: `column=(index+side)%2` is a literal ABAB repeat, and
 // every banner hung at exactly the same height at exactly the same zoom, so
 // bays 1 and 3 were the same image pixel for pixel. Ten different (column,
 // zoom, shift, mirror, drop, rod height) combinations, chosen so that no two
 // adjacent AND no two alternating bays share a silhouette.
 // slot = index*2 + (side>0). The columns 0 and 1 of the atlas are ALPHA-CUT
 // banner shapes, so they must never be zoomed or shifted - cropping into the
 // cell would cut the torn silhouette off and leave a hard rectangle. The
 // variation here is therefore column order (not alternating), a mirror flag,
 // and real geometry: width, drop and rod height.
 const NAVE_COLUMN=[0,1,1,0,1,0,0,1,0,1];
 const NAVE_MIRROR=[false,true,false,false,true,true,false,true,true,false];
 BANNER_Z.forEach((z,index)=>{
  for(const side of [-1,1]){
   const slot=index*2+(side>0?1:0);
   parts.push(hangingCloth(side,z,5.35+((slot*3)%4)*.11,2.4-((slot*2)%3)*.14,6.5-((slot*7)%5)*.26,[9,28],
    phase+=1.37,.28,NAVE_COLUMN[slot],1,{mirror:NAVE_MIRROR[slot]}));
  }
 });
 // A second, narrower rank between the bays keeps the wall from reading as a
 // regular grid of five identical flags.
 [-10.5,-4.5,1.5,7.5,13.5].forEach((z,index)=>{
  // zoom 1.9: at 1:1 the damask motif tiled four times across a 0.95 m ribbon
  // and read as printed pattern rather than woven cloth. Column 2 is a seamless
  // tile with no alpha cut, so it takes zoom, shift and mirror safely.
  for(const side of [-1,1]){
   const slot=index*2+(side>0?1:0);
   parts.push(hangingCloth(side,z+((slot*3)%4-1.5)*.12,5.2+((slot*5)%3-1)*.1,.95,4.3-((slot*3)%4)*.18,[5,20],
    phase+=1.37,.26,2,1.75+((slot*7)%4)*.13,{shiftU:((slot*11)%5-2)*.04,shiftV:((slot*13)%5-2)*.055,mirror:(slot%3)===1}));
  }
 });
 // Round 2 (ENV): crimson drops on the nave faces of the piers, where the DS3
 // reference hangs its red cloth. Narrow and high (rod at 7.3 m, hem above
 // 3.5 m), 0.5 m in front of the shaft at |x| = 9.6: outside the fighting
 // floor and above anything the camera can reach. Column 2 (the seamless
 // damask), zoomed and shifted per pier so no two are the same window.
 [-15,-9,-3,3,9].forEach((z,index)=>{
  for(const side of [-1,1]){
   const slot=index*2+(side>0?1:0),drop=3.8-((slot*5)%4)*.22;
   const g=new T.PlaneGeometry(.92-((slot*3)%3)*.06,drop,4,15);
   g.rotateY(side<0?Math.PI/2:-Math.PI/2);
   tag(g,phase+=1.37,.22,drop,2,0,COLUMNS,2.1+((slot*7)%4)*.15,{shiftU:((slot*11)%5-2)*.04,shiftV:((slot*13)%5-2)*.05,mirror:(slot%2)===0});
   g.translate(side*9.6,7.3+((slot*5)%4)*.11-drop/2,z+((slot*3)%3-1)*.08);
   parts.push(g);
  }
 });
 for(const side of [-1,1])parts.push(valanceStrip(side,phase+=1.37));
 // Two full-height banners flanking the sealed west door, hanging FLAT on the
 // west wall - the first cloth in the game whose wind runs along Z, which is
 // what the aBanner axis component was widened for.
 for(const x of [-5.85,5.85]){
  const g=new T.PlaneGeometry(2.5,7.2,9,30);
  g.rotateY(Math.PI);
  // Columns 0 and 2 (black-and-gold skull, crimson damask). Column 1 is the
  // bone banner and at this height it was the brightest object in the frame.
  tag(g,phase+=1.37,.24,7.2,x<0?0:2,1);
  g.translate(x,6.85,19.3);
  parts.push(g);
 }
 // Wall cloths hung in the aisle bays. These were ten flat PlaneGeometry
 // rectangles at amplitude .06 carrying the tiling damask at 1:1 - hard-edged
 // panels with a dead-straight hem and a repeating diamond print, i.e. red and
 // gold Victorian wallpaper glued between the piers, and the largest wall
 // objects in every side view (round 1 review, A-review1/edge/edgeL.jpg).
 // Now each one is a real hanging cloth: torn hem with two climbing rips, a
 // two-harmonic fold profile off the ashlar, the damask sampled at 2.2x so the
 // motif is cloth-scale, and three times the wind so it visibly breathes.
 // Round 2 review: the ten cloths were all the same motif at the same scale with
 // the same drop, so the wall read as a wallpaper repeat, and the wind measured
 // 1.06-1.40 mean levels per second against a 1.0 static control - i.e. someone
 // glancing at a panel still saw almost nothing move. Per-bay atlas window,
 // zoom, mirror, width, drop and rod height fix the repeat; amplitude .185 ->
 // .34 with a hem flutter harmonic (see bannerWind) fixes the motion.
 let seed=0;
 [-13.2,-7.2,-1.2,4.8,10.8].forEach((z,index)=>{
  for(const side of [-1,1]){
   const slot=index*2+(side>0?1:0);
   const drop=6.1-((slot*7)%4)*.28;
   const g=tatteredWallCloth(side,z+((slot*5)%3-1)*.14,12.55,2.45-((slot*3)%4)*.11,drop,7.42+((slot%5)-2)*.13,++seed*1.91);
   tag(g,phase+=1.37,.34,drop,2,0,COLUMNS,2.0+((slot*11)%4)*.17,
    {shiftU:((slot*7)%5-2)*.045,shiftV:((slot*3)%5-2)*.05,mirror:(slot%2)===1});
   parts.push(g);
  }
 });
 // .72 because the banners were the brightest saturated objects in every aisle
 // shot - brighter than the candle flames they were supposed to hang beside.
 const mesh=clothMesh(parts,clothMaterial(texture,relief,{sheenColor:0x6e2622,color:0xd8d4d0,glow:.10}),uniforms,'vesper-banner-wind-v3');
 if(mesh){mesh.name='Cathedral banners';group.add(mesh);}
 // glow .40 -> .13 (round 1 review): at .40 the oxblood velvet directly above
 // the boss was the brightest saturated shape in the lock-on frame - brighter
 // than the votive bank behind him - and read as a theatre pelmet. The crimson
 // still reads; it now sits below the boss's silhouette in the value hierarchy
 // and lets the corona hanging above it do the lighting.
 if(swag){
  const swagMesh=clothMesh([apseSwagRow(phase+=1.37)],clothMaterial(swag,relief,{sheenColor:0x7a2420,roughness:.9,color:0xe8dedb,glow:.13}),uniforms,'vesper-banner-wind-swag-v2');
  if(swagMesh){swagMesh.name='Chancel swag row';group.add(swagMesh);}
 }
 if(!group.children.length)return null;
 return {mesh:group,update(time){uniforms.uTime.value=time;}};
}
