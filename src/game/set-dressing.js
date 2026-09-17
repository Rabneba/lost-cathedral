import * as T from 'three';

// Hanging ironwork, branched candelabra and wall sconces for the cathedral.
//
// Everything here is built with the arena's OWN material instances and pushed
// through the arena's put(), so it is merged into the existing per-material
// meshes and costs exactly ZERO extra draw calls - only triangles. Every wick
// is pushed into the same flames[] array the arena's single InstancedMesh
// consumes, so ~130 new flames are also free.
//
// The band y = 3 - 11 m was completely empty, which is why the room read as a
// floor with walls rather than as a cathedral: every flame in the game sat at
// floor height on a stick and the upper two thirds of every pier was an
// unmodelled silhouette. Coronae at 6.6 m are above the camera's ceiling
// (main.js tops out near y = 4.9), so none of this needs a collider.

const v=(x,y,z)=>new T.Vector3(x,y,z);

// One wax candle with its wick registered as a flame. Height varies so a rank
// of twelve never reads as a machined comb.
function candle(ctx,x,y,z,radius,height){
 ctx.cyl(x,y+height/2,z,radius,height,ctx.mats.wax,7);
 ctx.flames.push(v(x,y+height+.055,z));
}

// A wrought-iron corona lucis: two concentric hoops, staves between them,
// pricket cups with candles around the rim, crown spikes, and three real
// chains climbing to the vault. This is the single silhouette that says
// "cathedral" in the red-banner reference.
export function corona(ctx,x,y,z,radius,cups,chainTop){
 const {dark,brass}=ctx.mats;
 const upper=radius*.6;
 ctx.put(new T.TorusGeometry(radius,.055,6,48),dark,[x,y,z],[Math.PI/2,0,0]);
 ctx.put(new T.TorusGeometry(radius,.022,5,40),dark,[x,y+.19,z],[Math.PI/2,0,0]);
 ctx.put(new T.TorusGeometry(upper,.045,6,36),dark,[x,y+.78,z],[Math.PI/2,0,0]);
 for(let i=0;i<16;i++){
  const a=i*Math.PI/8,ox=Math.cos(a),oz=Math.sin(a);
  const from=v(x+ox*radius,y+.02,z+oz*radius),to=v(x+ox*upper,y+.78,z+oz*upper);
  ctx.tube([from,from.clone().lerp(to,.5).add(v(0,.06,0)),to],.017,dark);
 }
 for(let i=0;i<cups;i++){
  const a=i*Math.PI*2/cups+.13,ox=Math.cos(a),oz=Math.sin(a);
  const cx=x+ox*radius,cz=z+oz*radius;
  ctx.cyl(cx,y+.085,cz,.115,.035,brass,10,.155);      // drip pan
  ctx.cyl(cx,y+.135,cz,.036,.07,brass,8);             // pricket
  candle(ctx,cx,y+.165,cz,.038,.19+((i*7)%5)*.035);
  // A crown spike between every pair of cups.
  const b=a+Math.PI/cups;
  ctx.put(new T.ConeGeometry(.045,.3,5),dark,[x+Math.cos(b)*radius,y+.16,z+Math.sin(b)*radius]);
 }
 for(let i=0;i<3;i++){
  const a=i*Math.PI*2/3+.4;
  ctx.tube([v(x+Math.cos(a)*radius,y+.04,z+Math.sin(a)*radius),
   v(x+Math.cos(a)*radius*.55,y+1.5,z+Math.sin(a)*radius*.55),
   v(x,y+2.9,z)],.013,dark);
 }
 ctx.tube([v(x,y+2.85,z),v(x,chainTop,z)],.026,dark);
 ctx.addEmitter(x,y-.2,z,0xffa055,20,9,.45);
}

// A floor candelabrum: splayed tripod foot, a knopped turned shaft and a
// branched corona of prickets. Big enough to read as furniture from the nave.
export function candelabrum(ctx,x,z,height,branches){
 const {dark,brass}=ctx.mats;
 for(let i=0;i<3;i++){
  const a=i*Math.PI*2/3+.7;
  ctx.tube([v(x,.34,z),v(x+Math.cos(a)*.26,.12,z+Math.sin(a)*.26),v(x+Math.cos(a)*.46,.035,z+Math.sin(a)*.46)],.045,dark);
  ctx.put(new T.SphereGeometry(.055,7,5),dark,[x+Math.cos(a)*.47,.045,z+Math.sin(a)*.47]);
 }
 // Knopped shaft: a lathe profile is what separates a candelabrum from a pipe.
 const profile=[[.10,0],[.075,.18],[.13,.30],[.062,.45],[.062,.72],[.115,.84],[.056,.97],[.056,1.],[.09,1.06]];
 const shaft=new T.LatheGeometry(profile.map(([r,t])=>new T.Vector2(r,t*height)),10);
 ctx.put(shaft,dark,[x,.03,z]);
 const top=height+.03;
 ctx.put(new T.TorusGeometry(.055,.03,5,14),brass,[x,top,z],[Math.PI/2,0,0]);
 for(let i=0;i<branches;i++){
  const t=branches===1?0:i/(branches-1)*2-1;                  // -1 .. 1
  const reach=Math.abs(t)*.62,lift=top-Math.abs(t)*.34;
  const a=Math.PI*.5+t*Math.PI*.5;                             // fan across the nave
  const bx=x+Math.cos(a)*reach,bz=z+Math.sin(a)*reach*.28;
  if(reach>.01)ctx.tube([v(x,top-.05,z),v((x+bx)/2,lift+.3,(z+bz)/2),v(bx,lift,bz)],.026,dark);
  ctx.cyl(bx,lift+.03,bz,.085,.03,brass,9,.115);
  candle(ctx,bx,lift+.055,bz,.042,.26+((i*5)%4)*.05);
 }
 ctx.addEmitter(x,top+.3,z,0xffa860,14,6.5,.8);
}

// A three-branch wrought sconce on the aisle wall. Ten of these are what put
// modelling light on the funerary monuments instead of leaving them flat.
export function sconce(ctx,x,y,z,side){
 const {dark,brass}=ctx.mats;
 ctx.put(new T.BoxGeometry(.09,.52,.14),dark,[x,y,z]);
 ctx.put(new T.TorusGeometry(.1,.018,5,16),dark,[x-side*.03,y+.3,z],[0,Math.PI/2,0]);
 for(let i=0;i<3;i++){
  const dz=(i-1)*.31,reach=.30-Math.abs(i-1)*.07;
  ctx.tube([v(x,y+.12,z),v(x-side*reach*.55,y+.34,z+dz*.6),v(x-side*reach,y+.26,z+dz)],.019,dark);
  ctx.cyl(x-side*reach,y+.29,z+dz,.062,.026,brass,8,.085);
  candle(ctx,x-side*reach,y+.31,z+dz,.034,.17+((i*3)%3)*.04);
 }
 ctx.addEmitter(x-side*.3,y+.5,z,0xff9c50,9,4.2,1);
}

// The twelve existing candle stands, upgraded IN PLACE. Their x, z and base
// radius are pinned by arena-layout.js (motion.groundColliders and
// test/motion.test.js) and must not move.
export function candleStand(ctx,x,z,baseRadius){
 const {dark,brass}=ctx.mats;
 ctx.cyl(x,.055,z,baseRadius,.11,dark,12);
 ctx.cyl(x,.13,z,baseRadius*.74,.06,dark,12,baseRadius*.62);
 for(let i=0;i<3;i++){
  const a=i*Math.PI*2/3+.5;
  ctx.tube([v(x,.42,z),v(x+Math.cos(a)*baseRadius*.62,.20,z+Math.sin(a)*baseRadius*.62),
   v(x+Math.cos(a)*baseRadius*.92,.07,z+Math.sin(a)*baseRadius*.92)],.034,dark);
 }
 const profile=[[.085,0],[.055,.16],[.10,.27],[.047,.40],[.047,.78],[.095,.90],[.045,1.02],[.045,1.14],[.075,1.2]];
 ctx.put(new T.LatheGeometry(profile.map(([r,t])=>new T.Vector2(r,t*1.42)),10),dark,[x,.1,z]);
 const top=1.62;
 ctx.cyl(x,top,z,.10,.045,brass,12,.14);
 // Five prickets on a shallow corona: drip pan, spike, candle.
 for(let i=0;i<5;i++){
  const t=i/4*2-1,reach=Math.abs(t)*.30,a=Math.PI*.5+t*Math.PI*.55;
  const bx=x+Math.cos(a)*reach,bz=z+Math.sin(a)*reach*.42,by=top-Math.abs(t)*.14;
  if(reach>.01)ctx.tube([v(x,top,z),v((x+bx)/2,by+.16,(z+bz)/2),v(bx,by,bz)],.021,dark);
  ctx.cyl(bx,by+.035,bz,.072,.028,brass,9,.098);
  candle(ctx,bx,by+.06,bz,.043,.23+((i*7)%4)*.055);
 }
 ctx.addEmitter(x,top+.35,z,0xffb16b,16,5.5,1);
}

// Votive candles at the feet of a statue (round 3: the mourning angels stand at the corners of the fighting
// floor, where no light reached them). Five wax candles in a shallow arc on the floor in front of the plinth
// plus one pool emitter: the same instanced flame draw and the same nine-light pool, so it costs nothing.
export function votiveCluster(ctx,x,z,towardX,towardZ){
 const {wax}=ctx.mats,len=Math.hypot(towardX,towardZ)||1,ux=towardX/len,uz=towardZ/len,px=-uz,pz=ux;
 for(let i=0;i<5;i++){
  const t=i/4*2-1,cx=x+ux*(1.0-Math.abs(t)*.22)+px*t*.42,cz=z+uz*(1.0-Math.abs(t)*.22)+pz*t*.42;
  candle(ctx,cx,.012,cz,.032+(i%2)*.008,.12+((i*5)%4)*.04);
 }
 ctx.addEmitter(x+ux*1.0,.55,z+uz*1.0,0xffa055,8,4.2,.9);
}

export function addFittings(ctx){
 // Coronae down the nave and one larger over the sanctuary.
 for(const z of [-6,0,6])corona(ctx,0,6.6,z,1.35,12,13.4);
 corona(ctx,0,7.4,-17.5,1.6,14,14.6);
 corona(ctx,0,6.6,12,1.15,10,13.4);
 // Floor candelabra flanking the chancel and the west end, all outside the
 // playable floor (|x| <= 9.5, -15.5 <= z <= 16).
 for(const x of [-5.5,5.5])candelabrum(ctx,x,-16.6,2.6,7);
 // Pulled in from x = 7.5 so they actually light the sealed oak door, which
 // was otherwise the largest unlit surface in the game.
 for(const x of [-5.4,5.4])candelabrum(ctx,x,18.55,2.5,5);
 // Aisle-wall sconces between the chapel arches, lighting the monuments.
 for(const side of [-1,1])for(const z of [-9,-3,3,9])sconce(ctx,side*12.45,3.5,z,side);
}

// ---------------------------------------------------------------------------
// Wrought iron. The reference's foreground is framed left and right by railings;
// ours had nothing between the fighting floor and the piers but gravel. This is
// also a readability win: the balusters declare where the arena ends.
//
// EXPLICIT RULE for everything below: zero camera colliders and zero ground
// colliders. cameraOrbitPosition already ray-tests 43 Box3s against up to 13
// orbit candidates every frame, and a collider on a 2 cm bar makes the camera
// snap on a handrail - far worse than passing through one. Everything sits at
// |x| >= 9.9 or z <= -15.9, outside the |x| <= 9.5 playable floor.

const PIERS=[-15,-9,-3,3,9,15];

function railRun(ctx,x,z0,z1,top,drop){
 const {dark}=ctx.mats;
 const length=z1-z0,centre=(z0+z1)/2;
 ctx.put(new T.BoxGeometry(.075,.085,length),dark,[x,top,centre]);
 ctx.put(new T.BoxGeometry(.042,.042,length),dark,[x,top-.26,centre]);
 ctx.put(new T.BoxGeometry(.055,.055,length),dark,[x,.12,centre]);
 for(const z of [z0,z1]){
  ctx.put(new T.BoxGeometry(.1,top+.16,.1),dark,[x,(top+.16)/2,z]);
  ctx.put(new T.ConeGeometry(.062,.2,4),dark,[x,top+.25,z]);
 }
 const count=Math.max(2,Math.round(length/.24));
 for(let k=1;k<count;k++){
  const z=z0+length*k/count,height=top-.16-drop*(k%3===0?.1:0);
  ctx.put(new T.CylinderGeometry(.021,.021,height,5),dark,[x,.1+height/2,z]);
  ctx.put(new T.ConeGeometry(.032,.11,5),dark,[x,.1+height+.05,z]);
  if(k%2===0)ctx.put(new T.TorusGeometry(.055,.012,4,10),dark,[x,.62,z],[0,Math.PI/2,0]);
 }
}

export function ironwork(ctx){
 const {dark}=ctx.mats;
 for(const side of [-1,1]){
  for(let i=0;i<PIERS.length-1;i++){
   // The collapsed bay on the +x side took its railing with it.
   if(side===1&&PIERS[i]===3)continue;
   // Two runs shoved outward and sagging, so the line is not a ruler.
   const shoved=(side===1&&PIERS[i]===-9)||(side===-1&&PIERS[i]===9);
   railRun(ctx,side*(shoved?10.22:9.9),PIERS[i]+.95,PIERS[i+1]-.95,shoved?.92:1.05,shoved?.14:0);
  }
  // Gallery balustrade along the string course, read from the floor as a line
  // of small dark verticals against the clerestory light.
  const x=side*11.62;
  ctx.put(new T.BoxGeometry(.13,.09,32),dark,[x,9.92,0]);
  ctx.put(new T.BoxGeometry(.09,.06,32),dark,[x,9.12,0]);
  for(let k=0;k<84;k++){
   const z=-16+k*32/83;
   ctx.put(new T.CylinderGeometry(.026,.026,.72,5),dark,[x,9.5,z]);
   if(k%7===0)ctx.put(new T.BoxGeometry(.13,.86,.13),dark,[x,9.5,z]);
  }
 }
 // The chancel gate, swung fully open back against the sanctuary steps: the
 // boss came through it, and an open gate says that without a word.
 for(const side of [-1,1]){
  const x=side*4.3;
  ctx.put(new T.BoxGeometry(.13,2.3,.13),dark,[x,1.15,-15.9]);
  ctx.put(new T.ConeGeometry(.08,.26,5),dark,[x,2.4,-15.9]);
  for(const y of [.18,1.86])ctx.put(new T.BoxGeometry(.05,.05,1.55),dark,[x,y,-16.7]);
  for(let k=0;k<14;k++){
   const z=-15.98-k*1.42/13;
   ctx.put(new T.CylinderGeometry(.018,.018,1.72,5),dark,[x,1.02,z]);
  }
  for(let k=0;k<4;k++){
   const z=-16.1-k*1.2/3;
   ctx.put(new T.TorusGeometry(.17,.019,4,14),dark,[x,2.02,z],[0,Math.PI/2,0]);
  }
 }
}

// Every banner hung from nothing, which is the one detail that still gave the
// cloth away as a decal. A rod, two brackets and three rings each.
export function bannerRod(ctx,side,z,y,width){
 const {dark,brass}=ctx.mats;
 const x=side*11.05;
 ctx.put(new T.CylinderGeometry(.032,.032,width+.34,7),dark,[x,y,z],[Math.PI/2,0,0]);
 for(const dz of [-(width+.34)/2,(width+.34)/2]){
  ctx.put(new T.SphereGeometry(.055,7,5),dark,[x,y,z+dz]);
  ctx.tube([v(side*11.3,y+.22,z+dz*.82),v(side*11.18,y+.1,z+dz*.9),v(x,y,z+dz)],.017,dark);
 }
 for(let k=-1;k<=1;k++)ctx.put(new T.TorusGeometry(.055,.011,4,12),brass,[x,y,z+k*width*.34],[0,Math.PI/2,0]);
}

export function bannerRods(ctx){
 for(const z of [-12,-6,0,6,12])for(const side of [-1,1])bannerRod(ctx,side,z,8.72,2.4);
 for(const z of [-10.5,-4.5,1.5,7.5,13.5])for(const side of [-1,1])bannerRod(ctx,side,z,7.42,.95);
 // Rods for the two west-wall banners, mounted flat on the wall.
 for(const x of [-5.85,5.85]){
  const {dark:iron,brass:bronze}=ctx.mats;
  ctx.put(new T.CylinderGeometry(.032,.032,2.84,7),iron,[x,10.52,19.22],[0,0,Math.PI/2]);
  for(const dx of [-1.42,1.42]){
   ctx.put(new T.SphereGeometry(.055,7,5),iron,[x+dx,10.52,19.22]);
   ctx.tube([v(x+dx*.82,10.74,19.42),v(x+dx*.9,10.62,19.34),v(x+dx,10.52,19.22)],.017,iron);
  }
  for(let k=-1;k<=1;k++)ctx.put(new T.TorusGeometry(.055,.011,4,12),bronze,[x+k*.85,10.52,19.22],[0,0,0]);
 }
 // The rod the chancel swag row hangs from, spanning the z = -15 piers.
 const {dark}=ctx.mats;
 ctx.put(new T.CylinderGeometry(.055,.055,17.6,8),dark,[0,9.78,-16.1],[0,0,Math.PI/2]);
 for(const side of [-1,1]){
  ctx.put(new T.SphereGeometry(.09,8,6),dark,[side*8.8,9.78,-16.1]);
  ctx.tube([v(side*10.2,10.3,-16.1),v(side*9.6,10.0,-16.1),v(side*8.8,9.78,-16.1)],.026,dark);
 }
}

// ---------------------------------------------------------------------------
// Localised stains. Tiling textures cannot produce history: in both references
// it is the NON-repeating marks - a water run under a broken bay, salt bloom
// where the damp reaches the floor, a soot plume over a candle rank - that sell
// the age. One merged mesh, one material, one atlas (assets/environment/
// wall-grunge.png, a 2x2 grid of soot / water stain / efflorescence / algae).
//
// Floor decals sit at y = 0.009, under the Reflector at y = 0.012, so the
// puddles pick them up for nothing. Nothing here casts a shadow.
const STAIN={water:[0,.5],salt:[.5,.5],algae:[0,0],soot:[.5,0]};

export function stainDecals(){
 const parts=[];
 const quad=(quadrant,x,y,z,w,h,rotY,rotX=0,flip=false)=>{
  const g=new T.PlaneGeometry(w,h);
  const uv=g.attributes.uv;
  for(let i=0;i<uv.count;i++){
   const u=flip?1-uv.getX(i):uv.getX(i),vv=uv.getY(i);
   // 0.02 inset: the atlas cells are cut with a soft edge and a full 0-0.5
   // sweep drags a sliver of the neighbouring cell in under bilinear filtering.
   uv.setXY(i,quadrant[0]+.02+u*.46,quadrant[1]+.02+vv*.46);
  }
  if(rotX)g.rotateX(rotX);
  if(rotY)g.rotateY(rotY);
  g.translate(x,y,z);
  parts.push(g);
 };
 for(const side of [-1,1]){
  const x=side*12.88,face=side<0?Math.PI/2:-Math.PI/2;
  // Rain came in through the broken clerestory and ran down the aisle walls.
  [-14.2,-8.4,-2.1,4.6,10.3,14.8].forEach((z,i)=>quad(STAIN.water,x,5.4+(i%2)*.9,z,2.6+(i%3)*.5,5.6,face,0,i%2===0));
  // Salt bloom where the damp in the plinth reaches the air.
  [-12.5,-6.2,.4,7.1,13.2].forEach((z,i)=>quad(STAIN.salt,x,.95,z,2.4+(i%2)*.6,1.9,face,0,i%2===1));
  [-10.1,-1.4,8.8].forEach((z,i)=>quad(STAIN.algae,x,.75,z,2.2,1.5,face,0,i%2===0));
  // Soot plumes climbing the wall above each sconce.
  for(const z of [-9,-3,3,9])quad(STAIN.soot,x,5.2,z,1.9,3.6,face,0,z>0);
 }
 return parts;
}

// Wax and soot on the floor at the foot of each candle stand.
export function floorStains(stands){
 const parts=[];
 stands.forEach(([x,z],i)=>{
  const g=new T.PlaneGeometry(1.55+(i%3)*.25,1.55+(i%2)*.3);
  // Soot and water, never the near-white salt quadrant: at the foot of a lit
  // candle stand that tile read as a patch of snow (round 1 review).
  const uv=g.attributes.uv,quadrant=i%2===0?STAIN.soot:STAIN.water;
  for(let k=0;k<uv.count;k++)uv.setXY(k,quadrant[0]+.02+uv.getX(k)*.46,quadrant[1]+.02+uv.getY(k)*.46);
  g.rotateX(-Math.PI/2);g.rotateY(i*1.37);g.translate(x,.009,z);
  parts.push(g);
 });
 return parts;
}
