import * as T from 'three';

const hash=(seed,n)=>{const v=Math.sin(seed*12.9898+n*78.233)*43758.5453;return v-Math.floor(v);};

// Clipped corners and a thin chipped rim keep fallen masonry distinct from
// pristine boxes. Only 44 triangles; no subdivisions or runtime deformation.
export function brokenSlab(width,height,depth,seed=1) {
 const w=width/2,d=depth/2;
 const cuts=Array.from({length:8},(_,i)=>(.07+hash(seed,i)*.19)*(i%2?depth:width));
 const outline=[[-w+cuts[0],-d],[w-cuts[2],-d],[w,-d+cuts[3]],[w,d-cuts[5]],[w-cuts[4],d],[-w+cuts[6],d],[-w,d-cuts[7]],[-w,-d+cuts[1]]];
 const bevel=Math.min(height*.24,width*.035,depth*.035),shearX=(hash(seed,12)-.5)*width*.10,shearZ=(hash(seed,13)-.5)*depth*.1;
 const slopeX=(hash(seed,14)-.5)*height*.14/width,slopeZ=(hash(seed,15)-.5)*height*.14/depth;
 const vertices=[],indices=[];
 for(let ring=0;ring<3;ring++)for(const [x,z] of outline){
  const inset=ring===2;
  vertices.push(x*(inset?1-bevel/w:1)+(ring?0:shearX),
   (ring===0?-height/2:height/2-(ring===1?bevel:0))+x*slopeX+z*slopeZ,
   z*(inset?1-bevel/d:1)+(ring?0:shearZ));
 }
 for(let i=1;i<7;i++){indices.push(0,i,i+1);indices.push(16,16+i+1,16+i);}
 for(let r=0;r<2;r++)for(let i=0;i<8;i++){const a=r*8+i,b=r*8+(i+1)%8,c=a+8,e=b+8;indices.push(a,c,b,b,c,e);}
 const base=new T.BufferGeometry();base.setAttribute('position',new T.Float32BufferAttribute(vertices,3));base.setIndex(indices);
 const geometry=base.toNonIndexed();base.dispose();geometry.computeVertexNormals();
 geometry.setAttribute('uv',new T.Float32BufferAttribute(new Float32Array(geometry.attributes.position.count*2),2));
 geometry.userData.worldUV=true;
 return stoneFragmentTint(geometry,seed);
}

export function fracturedRock(seed=1) {
 const g=new T.DodecahedronGeometry(1,0),p=g.attributes.position;
 for(let i=0;i<p.count;i++){
  const x=p.getX(i),y=p.getY(i),z=p.getZ(i);
  // Equal source vertices receive equal offsets, keeping the solid closed.
  const f=.8+.30*hash(seed,x*3.71+y*8.13+z*5.39);
  p.setXYZ(i,x*f,y*(.87+.18*f)+(x-z)*.07,z*f);
 }
 g.computeVertexNormals();g.userData.worldUV=true;
 return stoneFragmentTint(g,seed);
}

export function stoneFragmentTint(geometry,seed=1,architectural=false) {
 const n=geometry.attributes.normal,c=new Float32Array(n.count*3);
 const tone=architectural?.95+hash(seed,29)*.16:.86+hash(seed,29)*.28;
 for(let i=0;i<n.count;i++){
  // Old upper surfaces retain grime; newly exposed breaks reveal paler core.
  const cut=architectural?1:(n.getY(i)>.7?.92:n.getY(i)<-.7?.68:1.10);
  c[i*3]=tone*cut;c[i*3+1]=tone*cut*(architectural?1:.985);c[i*3+2]=tone*cut*(architectural?1:.955);
 }
 geometry.setAttribute('color',new T.BufferAttribute(c,3));return geometry;
}
