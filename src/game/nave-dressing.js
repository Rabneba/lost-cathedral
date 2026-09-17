import * as T from 'three';

// Round 2 (16 Sep, stream ENV): the details both references are made of and
// the room did not have - litter on the aisle floors, censers on chains in
// the aisle bays, and a cold shaft of window light behind the altar. Every
// rule from set-dressing.js applies: built with the arena's own materials
// through put() where possible, zero colliders, nothing inside the fighting
// floor (|x| <= 9.5, -15.5 <= z <= 16), nothing the camera can snag on.

const v=(x,y,z)=>new T.Vector3(x,y,z);

// Litter: torn pages, dry leaves, bones and stone shards from a 2x2 sprite
// sheet (assets/environment/debris-atlas.png, de-fringed copy of the
// generated sheet). ONE InstancedMesh, one material, one draw call; a
// per-instance cell attribute picks the sprite. alphaTest keeps every piece in
// the depth prepass and inside GTAO so it grounds instead of floating.
export function debrisScatter(atlas,rand){
 if(!atlas)return null;
 const spots=[];
 // The aisles beyond the railings, between the pier bases and the monuments.
 for(let i=0;i<120;i++){const side=rand()<.5?-1:1;spots.push([side*(10.15+rand()*2.25),(rand()-.5)*31]);}
 // Drifted against the west door, outside the fight box (z > 16.3).
 for(let i=0;i<40;i++){const t=rand();spots.push([(rand()-.5)*16,16.5+Math.pow(t,.7)*3.2]);}
 // A few blown in under the collapsed bay and the fallen memorial.
 for(let i=0;i<22;i++){const a=rand()*6.28,r=.4+rand()*2.2;spots.push([10.6+Math.cos(a)*r,4.2+Math.sin(a)*r*1.4]);}
 const count=spots.length;
 const geometry=new T.PlaneGeometry(.34,.255);geometry.rotateX(-Math.PI/2);
 const material=new T.MeshStandardMaterial({map:atlas,alphaTest:.5,side:T.DoubleSide,roughness:.96,metalness:0,color:0x9a948b,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});
 material.onBeforeCompile=shader=>{
  shader.vertexShader=shader.vertexShader
   .replace('#include <common>','#include <common>\nattribute float aCell;')
   .replace('#include <uv_vertex>','#include <uv_vertex>\n#ifdef USE_MAP\n vMapUv=vec2(mod(aCell,2.)*.5,(1.-floor(aCell/2.))*.5)+uv*.5;\n#endif');
 };
 material.customProgramCacheKey=()=>'vesper-debris-atlas-v1';
 const mesh=new T.InstancedMesh(geometry,material,count);
 const cell=new Float32Array(count),m=new T.Matrix4(),q=new T.Quaternion(),e=new T.Euler();
 spots.forEach(([x,z],i)=>{
  const c=Math.floor(rand()*4);cell[i]=c;
  const s=.72+rand()*.7,stretch=c===2?1.3:1;
  e.set(0,rand()*Math.PI*2,0);q.setFromEuler(e);
  mesh.setMatrixAt(i,m.compose(v(x,.03+rand()*.012,z),q,v(s*stretch,1,s)));
 });
 geometry.setAttribute('aCell',new T.InstancedBufferAttribute(cell,1));
 mesh.instanceMatrix.needsUpdate=true;
 mesh.name='aisle debris';mesh.castShadow=false;mesh.receiveShadow=true;mesh.frustumCulled=false;
 return mesh;
}

// A thurible on its chain in an aisle bay: three chains from a ring to the
// lid, a lathe-turned bowl and lid in brass, an iron suspension chain up to
// the vault. Hung at 3.9 m over the aisle, outside the fighting floor and
// outside every camera path the player can reach.
export function censer(ctx,x,z,y,chainTop){
 const {dark,brass}=ctx.mats;
 const bowl=[[0,0],[.075,.01],[.11,.06],[.12,.13],[.1,.2],[.055,.24],[.09,.27],[.115,.31],[.11,.36],[.08,.4],[.05,.43],[.02,.47],[.0,.48]];
 ctx.put(new T.LatheGeometry(bowl.map(([r,t])=>new T.Vector2(r,t)),12),brass,[x,y,z]);
 ctx.put(new T.TorusGeometry(.115,.012,5,18),dark,[x,y+.245,z],[Math.PI/2,0,0]);
 ctx.put(new T.TorusGeometry(.055,.014,5,12),dark,[x,y+1.05,z],[Math.PI/2,0,0]);
 for(let i=0;i<3;i++){
  const a=i*Math.PI*2/3+.3;
  ctx.tube([v(x+Math.cos(a)*.105,y+.31,z+Math.sin(a)*.105),v(x+Math.cos(a)*.06,y+.7,z+Math.sin(a)*.06),v(x,y+1.04,z)],.008,dark);
 }
 ctx.tube([v(x,y+1.06,z),v(x+.02,(y+chainTop)/2,z-.02),v(x,chainTop,z)],.014,dark);
 for(let k=0;k<5;k++)ctx.put(new T.TorusGeometry(.03,.007,4,10),dark,[x,y+1.3+k*.55,z],[k%2?0:Math.PI/2,k%2?Math.PI/2:0,0]);
}

export function censers(ctx){
 [[-1,-12],[1,-6],[-1,0],[1,6],[-1,12],[1,-15.9]].forEach(([side,z],i)=>censer(ctx,side*11.2,z+(i%2?.35:-.35),3.9+(i%3)*.22,10.6));
}

// Cold light through the east window, behind the boss. The UE reference's
// whole mood is the window light streaming toward the viewer as visible haze;
// here it is three steep shafts from the apse lancets that land on the
// sanctuary steps, WELL behind the fight, plus (in arena.js) one cold
// SpotLight that actually puts that light on the steps and the boss's back.
// Same shader and material as the moonlight shafts, so it is one more draw
// call per shaft and no new program.
export function apseShafts(beamMat,root){
 const shafts=[];
 for(const [ax,width] of [[-1.98,1.7],[0,1.8],[1.98,1.7]]){
  const bearing=v(ax*.07,-.74,.67).normalize();
  const travel=9.2/Math.abs(bearing.y);
  const yAxis=bearing.clone().multiplyScalar(-1);
  const xAxis=v(1,0,0);
  const zAxis=new T.Vector3().crossVectors(xAxis,yAxis).normalize();
  xAxis.crossVectors(yAxis,zAxis).normalize();
  const orientation=new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(xAxis,yAxis,zAxis));
  const start=v(ax,9.2,-19.9);
  const beam=new T.Mesh(new T.PlaneGeometry(width,travel+.6),beamMat);
  beam.position.copy(start).addScaledVector(bearing,travel*.5+.3);beam.quaternion.copy(orientation);
  beam.userData.noPuddleReflection=true;beam.castShadow=false;beam.receiveShadow=false;beam.name='apse shaft';
  root.add(beam);shafts.push(beam);
 }
 return shafts;
}

// Round 3 (16 Sep evening, graphics pass): damage on the fighting floor itself.
// The user's note was that the floor is "too smooth" - the nave is where every
// frame is spent and nothing on it said the roof came down. Fourteen decals cut
// from the generated 2x2 damage atlas (assets/environment/floor-damage-atlas.png,
// de-fringed): shattered slabs, long cracks, shallow craters and rubble scatter,
// laid on the tile grid where the fight actually happens. One merged geometry,
// one alpha-tested material, no colliders (they are flat), under the Reflector
// so the puddles pick them up for nothing.
const DAMAGE={slab:[0,.5],crack:[.5,.5],crater:[0,0],rubble:[.5,0]};
export function floorDamageDecals(){
 const parts=[];
 const quad=(quadrant,x,z,w,h,rot,flip=false)=>{
  const g=new T.PlaneGeometry(w,h),uv=g.attributes.uv;
  for(let i=0;i<uv.count;i++){
   const u=flip?1-uv.getX(i):uv.getX(i),vv=uv.getY(i);
   // 0.02 inset: the atlas cells have soft edges and a full 0-0.5 sweep drags a
   // sliver of the neighbouring cell in under bilinear filtering.
   uv.setXY(i,quadrant[0]+.02+u*.46,quadrant[1]+.02+vv*.46);
  }
  g.rotateX(-Math.PI/2);g.rotateY(rot);g.translate(x,.010,z);parts.push(g);
 };
 // Shattered slabs where something heavy came down.
 quad(DAMAGE.slab,3.3,-6.6,2.7,2.7,.35);quad(DAMAGE.slab,-5.2,2.1,2.3,2.3,2.4,true);quad(DAMAGE.slab,1.5,9.8,2.5,2.5,1.1);
 // Long cracks running with and across the tile courses.
 quad(DAMAGE.crack,-2.7,-1.6,3.8,1.9,1.15);quad(DAMAGE.crack,6.3,4.9,3.3,1.65,-.45,true);quad(DAMAGE.crack,-7.1,-9.6,3.1,1.55,.2);quad(DAMAGE.crack,2.6,13.6,3.5,1.75,.75,true);
 // Shallow craters.
 quad(DAMAGE.crater,-1.9,-11.3,2.5,2.5,.6);quad(DAMAGE.crater,7.2,-2.7,2.1,2.1,2.9,true);quad(DAMAGE.crater,-6.7,8.5,2.3,2.3,1.7);
 // Rubble scatter, thickest under the collapsed bay and around the seal.
 quad(DAMAGE.rubble,4.5,-13.3,2.3,2.3,.9);quad(DAMAGE.rubble,-3.5,6.0,2.0,2.0,2.2,true);quad(DAMAGE.rubble,8.4,11.0,2.2,2.2,.1);quad(DAMAGE.rubble,-8.3,-4.5,2.1,2.1,1.4,true);quad(DAMAGE.rubble,.7,-3.3,1.7,1.7,.4);
 return parts;
}
