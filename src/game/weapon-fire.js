import * as T from 'three';

/** Shared colour language for every fire effect in the fight.
 * A blackbody-like ramp (cold violet smoulder -> dark red -> ember -> pale) kept
 * inside this project's dark silver/ember palette: the pale end is bone-white
 * rather than yellow, and the cold end is the hood's violet rather than blue. */
export const EMBER_RAMP_GLSL=`
#ifndef VESPER_EMBER_RAMP
#define VESPER_EMBER_RAMP
vec3 emberRamp(float t){
 t=clamp(t,0.,1.);
 vec3 smoulder=vec3(.055,.012,.085);
 // The cold end of the ember band is a WARM crimson. The old blood had more
 // blue (.075) than green (.045), which is a magenta lean: dim + bloom made it
 // salmon, and that was the last of the pink the review kept finding.
 vec3 blood=vec3(.32,.055,.028);
 vec3 ember=vec3(.95,.29,.085);
 vec3 pale=vec3(1.15,.86,.72);
 vec3 c=mix(smoulder,blood,smoothstep(0.,.34,t));
 c=mix(c,ember,smoothstep(.34,.74,t));
 c=mix(c,pale,smoothstep(.80,1.,t));
 return c;
}
#endif`;

/** Cheap value noise + fbm, matching the style already used by the hood mist. */
export const FIRE_NOISE_GLSL=`
#ifndef VESPER_FIRE_NOISE
#define VESPER_FIRE_NOISE
float fhash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float fnoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
 return mix(mix(fhash(i),fhash(i+vec2(1.,0.)),f.x),mix(fhash(i+vec2(0.,1.)),fhash(i+vec2(1.,1.)),f.x),f.y);}
float ffbm(vec2 p){return .54*fnoise(p)+.27*fnoise(p*2.07+7.3)+.13*fnoise(p*4.11-3.1)+.06*fnoise(p*8.3+1.7);}
#endif`;

const clamp01=x=>Math.max(0,Math.min(1,x));
const smooth=x=>{x=clamp01(x);return x*x*(3-2*x);};

/** How hot the blade burns for an action: a smoulder at rest (`idle` is the
 * floor the blade never drops below while the actor lives), a build through the
 * windup, a flare across the hit window and a fast decay through recovery. A
 * multi-window action (flurry) flares from its first window to its last. */
export function attackHeat(action,timing,{idle=.16}={}){
 const name=action?.name;
 if(!name||['idle','walk','hit','death'].includes(name))return name==='death'?0:idle;
 const elapsed=Math.max(0,action.elapsed||0);
 if(name==='awaken')return clamp01(idle+smooth(elapsed/1.1)*(1-smooth((elapsed-1.5)/1.1))*1.4);
 const start=timing?.hitWindows?.[0]?.[0]??timing?.windup;
 if(!Number.isFinite(start))return idle;
 const end=timing?.hitWindows?.at(-1)?.[1]??start+(timing?.active??.35);
 const build=smooth((elapsed-Math.max(0,start-1.15))/Math.max(.2,Math.min(1.15,start)))*.72;
 const flare=elapsed>=start&&elapsed<end+.12?1:0;
 const decay=1-smooth((elapsed-end)/.55);
 return clamp01(Math.max(idle,(build+flare*.55)*Math.max(decay,flare?1:0)));
}

/** Stations along the blade at which the steel's centre is measured (bladeSpine). */
export const SPINE_STATIONS=12;
// The ribbon is authored straight along local X and bent here onto the blade's spine (uSpine, in the fire
// group's frame), then rolled about the blade axis toward the camera (uRoll) and stretched with the heat
// (uHeight). Doing the roll and the stretch in the shader keeps the bow of the blade where it is: a mesh
// rotation would have swung the bow around the chord and a mesh scale would have stretched it.
const SHEET_VERTEX=`uniform vec3 uSpine[${SPINE_STATIONS}];uniform float uLength,uRoll,uHeight;varying vec2 vUv;
 vec3 spineAt(float t){float f=clamp(clamp(t,0.,1.)*${SPINE_STATIONS}.-.5,0.,${SPINE_STATIONS-1}.);int i=int(floor(f));int j=min(i+1,${SPINE_STATIONS-1});return mix(uSpine[i],uSpine[j],f-float(i));}
 void main(){vUv=uv;vec3 s=spineAt(position.x/uLength+.5);
  vec3 across=vec3(0.,cos(uRoll),sin(uRoll))*(position.y*uHeight);
  gl_Position=projectionMatrix*modelViewMatrix*vec4(vec3(position.x,s.y,s.z)+across,1.);}`;
const SHEET_FRAGMENT=`
 uniform float uTime,uHeat,uSeed,uTrail,uGain,uCore,uAlpha;
 varying vec2 vUv;
 ${FIRE_NOISE_GLSL}
 ${EMBER_RAMP_GLSL}
 void main(){
  float along=vUv.x, edge=abs((vUv.y-.5)*2.);
  // Flame tongues stream off the cutting edge, dragged back along the cut.
  vec2 q=vec2(along*7.2+uSeed,(vUv.y-.5)*3.4)+vec2(-uTime*1.5-uTrail*2.4,uTime*.7);
  float warp=ffbm(q*.7+vec2(uTime*.35,-uTime*.2));
  float n=ffbm(q+vec2(warp*1.4,-uTime*1.0));
  // Reach grows with heat and never gets near the quad's own edge, so the
  // silhouette is always drawn by the noise and never by the geometry.
  float reach=.06+uHeat*.47;
  float profile=1.-smoothstep(0.,reach,edge);
  // EVERY term is cut by the noise. At a low heat the tongues thin out into a
  // ragged smoulder instead of collapsing onto a smooth analytic card.
  float tongues=smoothstep(.44,.80,n+profile*.26-.14)*profile;
  // The hot line on the cutting edge is present at rest (a dark ember rim)
  // and only widens with heat; the noise gate keeps it ragged at any level.
  float core=(1.-smoothstep(0.,.040+uHeat*.05,edge))*uCore*(.20+uHeat*.50)*smoothstep(.30,.72,n*.7+.36);
  float taper=smoothstep(0.,.11,along)*(1.-smoothstep(.80,1.,along));
  float mask=(tongues*1.10+core)*taper;
  if(mask<.006)discard;
  // Low heat sits in the deep blood/charcoal end; only a real flare reaches the
  // bright ember band, and nothing ever reaches the pale end.
  float heat=clamp(.40+mask*.20+uHeat*.22,.40,.78);
  vec3 c=emberRamp(heat)*(.34+uHeat*.70)*uGain;
  gl_FragColor=vec4(c,clamp(mask*(.24+uHeat*.48)*uAlpha,0.,.70));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
 }`;

const EMBER_VERTEX=`attribute float aHeat; attribute float aSize; varying float vHeat;
 void main(){vHeat=aHeat;vec4 p=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*p;gl_PointSize=clamp(aSize*260./max(1.,-p.z),1.,26.);}`;
const EMBER_FRAGMENT=`uniform float uGain; varying float vHeat; ${EMBER_RAMP_GLSL}
 void main(){float r=length(gl_PointCoord-.5)*2.;float a=pow(max(0.,1.-r),2.);
  if(a<.01)discard;
  // Embers are always in the ember band: a cooling ember is dim orange, never violet.
  gl_FragColor=vec4(emberRamp(clamp(.42+vHeat*.30,.42,.72))*(.26+vHeat*.62)*uGain,a*clamp(vHeat*.85,0.,1.)*clamp(.35+uGain*.65,0.,1.));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
 }`;

/** The centre of the steel along the hit segment, measured from the weapon's own mesh (17 Sep 2026).
 * Bins every blade vertex by its station along [a,b] in the wrapper's frame and takes the centroid of each
 * bin, so a curved blade (the exile's sword bows 0.23 m off its chord at the tip; the scythe 0.07 m) gets its
 * fire, embers, glow and light ON the steel instead of on the straight segment. Steel farther than a third of
 * the length from the chord (a scythe's haft crossing the bins) is ignored; empty stations borrow their
 * neighbours; a weapon with no mesh at all gets the segment back. `thin` is the flat-side direction of the
 * blade (the perpendicular with the least extent), `bow` the largest offset from the chord. */
export function bladeSpine(weapon,a,b,{stations=SPINE_STATIONS}={}){
 const axis=b.clone().sub(a),length=Math.max(1e-3,axis.length());axis.normalize();
 const seed=Math.abs(axis.y)<.9?new T.Vector3(0,1,0):new T.Vector3(1,0,0);
 const p=seed.clone().addScaledVector(axis,-seed.dot(axis)).normalize(),q=new T.Vector3().crossVectors(axis,p);
 const bins=Array.from({length:stations},()=>({n:0,p:0,q:0,pMin:Infinity,pMax:-Infinity,qMin:Infinity,qMax:-Infinity}));
 if(weapon){
  weapon.updateMatrixWorld(true);
  const inverse=weapon.matrixWorld.clone().invert(),v=new T.Vector3(),m=new T.Matrix4();
  weapon.traverse(node=>{
   if(!node.isMesh||node.userData.cosmetic||node.userData.weaponFire)return;
   const position=node.geometry?.attributes?.position;if(!position)return;
   m.copy(inverse).multiply(node.matrixWorld);
   for(let i=0;i<position.count;i++){
    v.fromBufferAttribute(position,i).applyMatrix4(m).sub(a);
    const t=v.dot(axis)/length;if(t<-.02||t>1.02)continue;
    const pp=v.dot(p),qq=v.dot(q);
    if(Math.hypot(pp,qq)>length*.35)continue;
    const bin=bins[Math.min(stations-1,Math.max(0,Math.floor(t*stations)))];
    bin.n++;bin.p+=pp;bin.q+=qq;bin.pMin=Math.min(bin.pMin,pp);bin.pMax=Math.max(bin.pMax,pp);bin.qMin=Math.min(bin.qMin,qq);bin.qMax=Math.max(bin.qMax,qq);
   }
  });
 }
 const offsets=bins.map(bin=>bin.n?[bin.p/bin.n,bin.q/bin.n]:null);
 for(let i=0;i<stations;i++)if(!offsets[i]){
  let l=i-1;while(l>=0&&!offsets[l])l--;let r=i+1;while(r<stations&&!offsets[r])r++;
  const L=l>=0?offsets[l]:null,R=r<stations?offsets[r]:null;
  offsets[i]=L&&R?[(L[0]*(r-i)+R[0]*(i-l))/(r-l),(L[1]*(r-i)+R[1]*(i-l))/(r-l)]:L||R||[0,0];
 }
 // A three-tap smoothing so a bin boundary never puts a kink in the fire.
 const smoothed=offsets.map((o,i)=>{const l=offsets[Math.max(0,i-1)],r=offsets[Math.min(stations-1,i+1)];return[(l[0]+2*o[0]+r[0])/4,(l[1]+2*o[1]+r[1])/4];});
 const points=smoothed.map((o,i)=>a.clone().addScaledVector(axis,(i+.5)/stations*length).addScaledVector(p,o[0]).addScaledVector(q,o[1]));
 let pExtent=0,qExtent=0,filled=0;for(const bin of bins)if(bin.n){pExtent+=bin.pMax-bin.pMin;qExtent+=bin.qMax-bin.qMin;filled++;}
 const thin=filled&&qExtent<pExtent?q.clone():p.clone();
 const bow=Math.max(...smoothed.map(o=>Math.hypot(o[0],o[1])));
 return{points,thin,bow,length,axis,filled,stations};
}

/** Dark fire wrapped around a weapon's blade.
 * `segment` is the blade's [start,end] in the weapon wrapper's local frame — the
 * very segment the hit detection sweeps; the fire itself follows the blade's
 * measured spine (bladeSpine) between those ends. Three billboarded ribbons give it
 * volume, area-weighted embers peel off along the steel, the blade metal itself goes
 * incandescent and a single point light carries the glow into the room.
 * `flare` scales how tall the flames stand at full heat (the boss's strikes, 17 Sep),
 * `glow` the incandescence of the metal, `decay` the light's falloff (1 for the
 * exile: a light inside a curved blade with inverse-square falloff was one white
 * hot spot on the steel; linear falloff spreads it along the blade). */
export function createWeaponFire(weapon,segment,{scene,boss=true,embers=boss?96:36,gain=1,flare=boss?1.45:1,glow=boss?1:.7,decay=boss?2:1}={}){
 if(!weapon||!segment)return null;
 const a=new T.Vector3(...segment[0]),b=new T.Vector3(...segment[1]);
 const length=Math.max(.15,a.distanceTo(b)),axis=b.clone().sub(a).normalize();
 const spine=bladeSpine(weapon,a,b);
 const stations=spine.points.length;
 /** The spine point at station t (0 hilt end .. 1 tip), in the wrapper's frame. */
 const spineAt=(t,target)=>{const f=Math.min(stations-1,Math.max(0,t*stations-.5)),i=Math.floor(f),j=Math.min(stations-1,i+1);return target.lerpVectors(spine.points[i],spine.points[j],f-i);};
 const group=new T.Group();group.name=boss?'Scythe dark fire':'Blade fire';
 group.position.copy(a).addScaledVector(axis,length*.5);
 group.quaternion.setFromUnitVectors(new T.Vector3(1,0,0),axis);
 group.userData.cosmetic=true;
 weapon.add(group);
 // The spine in the group's own frame: x down the blade, y/z the bow, for the ribbons' vertex shader.
 const groupInverse=group.quaternion.clone().invert();
 const spineLocal=spine.points.map(point=>point.clone().sub(group.position).applyQuaternion(groupInverse));

 const sheets=[];
 for(let i=0;i<3;i++){
  const uniforms={uTime:{value:0},uHeat:{value:0},uSeed:{value:i*7.31},uTrail:{value:0},uGain:{value:gain},uAlpha:{value:Math.sqrt(Math.max(.05,gain))},uCore:{value:i===1?1:.22},
   uSpine:{value:spineLocal},uLength:{value:length},uRoll:{value:(i-1)*.62},uHeight:{value:.55}};
  const material=new T.ShaderMaterial({uniforms,transparent:true,depthWrite:false,depthTest:true,side:T.DoubleSide,blending:T.AdditiveBlending,vertexShader:SHEET_VERTEX,fragmentShader:SHEET_FRAGMENT});
  // The boss's sheet is built taller (.62 -> .72 of the length) so the strike flare has room to stand.
  const mesh=new T.Mesh(new T.PlaneGeometry(length*1.12,length*(boss?.72:.5),1,1),material);
  mesh.frustumCulled=false;mesh.renderOrder=6;
  mesh.userData.cosmetic=true;mesh.userData.noPuddleReflection=true;
  group.add(mesh);sheets.push({mesh,uniforms,roll:(i-1)*.62});
 }

 // Embers live in world space so they keep flying after the blade has moved on.
 const geometry=new T.BufferGeometry();
 geometry.setAttribute('position',new T.Float32BufferAttribute(new Float32Array(embers*3),3));
 geometry.setAttribute('aHeat',new T.Float32BufferAttribute(new Float32Array(embers),1));
 geometry.setAttribute('aSize',new T.Float32BufferAttribute(new Float32Array(embers),1));
 geometry.setDrawRange(0,0);
 const points=new T.Points(geometry,new T.ShaderMaterial({uniforms:{uGain:{value:gain}},transparent:true,depthWrite:false,blending:T.AdditiveBlending,vertexShader:EMBER_VERTEX,fragmentShader:EMBER_FRAGMENT}));
 points.frustumCulled=false;points.renderOrder=7;points.userData.cosmetic=true;points.userData.noPuddleReflection=true;
 (scene||weapon).add(points);

 const light=new T.PointLight(0xff5a1e,0,boss?6.5:3.4,decay);light.userData.cosmetic=true;light.userData.weaponLight=true;/* kept on phones (main.js) */(scene||weapon).add(light);

 // Incandescent metal: distance to the blade's spine is evaluated per vertex in
 // each mesh's own frame, so only the cutting steel glows — never the haft — and a
 // curved blade glows evenly from hilt to tip instead of only where it meets the chord.
 const glowing=[];
 const wrapperInverse=(()=>{weapon.updateMatrixWorld(true);return weapon.matrixWorld.clone().invert();})();
 weapon.traverse(node=>{
  if(!node.isMesh||!node.material||node.userData.weaponFire||node.userData.cosmetic)return;
  const toWrapper=wrapperInverse.clone().multiply(node.matrixWorld),toLocal=toWrapper.clone().invert();
  const scale=new T.Vector3().setFromMatrixScale(toWrapper).x||1;
  const material=node.material=Array.isArray(node.material)?node.material.map(m=>m.clone()):node.material.clone();
  const single=Array.isArray(material)?material[0]:material;
  const uniforms={uFireSpine:{value:spine.points.map(point=>point.clone().applyMatrix4(toLocal))},uFireHeat:{value:0},uFireReach:{value:(boss?.30:.16)/Math.max(scale,1e-5)},uFireGlow:{value:glow}};
  single.onBeforeCompile=shader=>{
   Object.assign(shader.uniforms,uniforms);
   shader.vertexShader=`uniform vec3 uFireSpine[${stations}];uniform float uFireReach;varying float vFireEdge;\n`+shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
    float fD=1e9;for(int fI=0;fI<${stations-1};fI++){vec3 fA=uFireSpine[fI],fB=uFireSpine[fI+1]-fA;float fT=clamp(dot(position-fA,fB)/max(dot(fB,fB),1e-6),0.,1.);fD=min(fD,distance(position,fA+fB*fT));}
    vFireEdge=1.-clamp(fD/max(uFireReach,1e-5),0.,1.);`);
   shader.fragmentShader=`uniform float uFireHeat,uFireGlow;varying float vFireEdge;\n${EMBER_RAMP_GLSL}\n`+shader.fragmentShader.replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
    float fHeat=uFireHeat*pow(max(vFireEdge,0.),1.7);
    // The edge is incandescent at rest: a dark ember rim that a flare pushes up
    // the ramp. The smoothstep term is the resting floor, the linear one the flare.
    totalEmissiveRadiance+=emberRamp(clamp(.36+fHeat*.32,0.,.68))*(fHeat*.66+smoothstep(0.,.35,fHeat)*.16)*uFireGlow;`);
  };
  single.needsUpdate=true;node.userData.weaponFire=true;
  glowing.push(uniforms);
 });

 const pool=[];
 const tmpA=new T.Vector3(),tmpB=new T.Vector3(),tmpP=new T.Vector3(),cameraPosition=new T.Vector3(),local=new T.Vector3(),thin=new T.Vector3(),toCamera=new T.Vector3();
 const previousTip=new T.Vector3();let seeded=false,emitAccumulator=0;
 const state={heat:0,trail:0};

 function bladeEnds(){
  weapon.updateMatrixWorld(true);
  tmpA.copy(a).applyMatrix4(weapon.matrixWorld);
  tmpB.copy(b).applyMatrix4(weapon.matrixWorld);
 }

 return{
  group,points,light,sheets,state,spine,
  /** @param {{heat:number,camera:T.Camera,dt:number,time:number}} */
  update(dt,time,{heat=0,camera}={}){
   const step=Math.max(0,Math.min(dt,.1));
   state.heat=step>0?T.MathUtils.damp(state.heat,heat,heat>state.heat?18:6,step):heat;
   bladeEnds();
   const speed=seeded&&step>0?tmpB.distanceTo(previousTip)/step:0;
   previousTip.copy(tmpB);seeded=true;
   state.trail=T.MathUtils.clamp(speed/14,0,1);
   const h=state.heat;
   for(const sheet of sheets){
    sheet.uniforms.uTime.value=time;
    sheet.uniforms.uHeat.value=h;
    sheet.uniforms.uTrail.value=state.trail;
    // Flames stand taller with the heat; the boss's strike flare (flare 1.45) makes his cut a wall of fire.
    sheet.uniforms.uHeight.value=.55+h*.95*flare;
   }
   // Billboard each ribbon around the blade axis so the fire always has depth.
   if(camera){
    camera.getWorldPosition(cameraPosition);
    local.copy(cameraPosition);group.parent?.updateMatrixWorld(true);
    group.worldToLocal(local);
    const roll=Math.atan2(-local.y,local.z);
    for(const sheet of sheets)sheet.uniforms.uRoll.value=roll+sheet.roll*(1-h*.35);
   }
   // Area-weighted emission along the spine: the wide curved head sheds more than the neck.
   emitAccumulator+=step*(4+h*h*150*(boss?1.3:1));
   while(emitAccumulator>=1&&pool.length<embers){
    emitAccumulator-=1;
    const t=Math.pow(Math.random(),.55);
    spineAt(t,tmpP).applyMatrix4(weapon.matrixWorld);
    pool.push({p:tmpP.clone().add(new T.Vector3((Math.random()-.5)*.09,(Math.random()-.5)*.09,(Math.random()-.5)*.09)),
     v:new T.Vector3((Math.random()-.5)*.8,.25+Math.random()*.9,(Math.random()-.5)*.8).addScaledVector(tmpB.clone().sub(tmpA).normalize(),(Math.random()-.3)*speed*.06),
     life:.35+Math.random()*.75,total:1,size:.05+Math.random()*.09});
    pool.at(-1).total=pool.at(-1).life;
   }
   if(emitAccumulator>4)emitAccumulator=4;
   const position=geometry.attributes.position,aHeat=geometry.attributes.aHeat,aSize=geometry.attributes.aSize;
   let n=0,write=0;
   for(let i=0;i<pool.length;i++){
    const particle=pool[i];
    particle.life-=step;
    if(particle.life<=0)continue;
    particle.v.y+=step*.55;particle.v.multiplyScalar(Math.exp(-step*1.6));
    particle.p.addScaledVector(particle.v,step);
    const age=1-particle.life/particle.total;
    position.setXYZ(n,particle.p.x,particle.p.y,particle.p.z);
    aHeat.setX(n,Math.max(0,(1-age)*(1-age)*(.55+h*.6)));
    aSize.setX(n,particle.size*(1-age*.55));
    n++;pool[write++]=particle;
   }
   pool.length=write;
   position.needsUpdate=aHeat.needsUpdate=aSize.needsUpdate=true;
   geometry.setDrawRange(0,n);
   for(const uniforms of glowing)uniforms.uFireHeat.value=h;
   // The light sits on the spine, pushed off the flat of the blade toward the camera: inside the steel it
   // lit the nearest few centimetres of metal to the HDR cap (the white spot on the exile's blade).
   spineAt(.55,light.position).applyMatrix4(weapon.matrixWorld);
   if(camera){thin.copy(spine.thin).transformDirection(weapon.matrixWorld);toCamera.copy(cameraPosition).sub(light.position);const side=Math.sign(thin.dot(toCamera))||1;light.position.addScaledVector(thin,(boss?.14:.12)*side);}
   // A resting glow that lands on the hands and the flagstones, the flare on top of it. The boss's flare
   // ceiling is up a little for the strike (1.8 -> 2.2); the exile's light is dimmer and falls off linearly.
   light.intensity=boss?.55+h*.35+h*h*2.2:.22+h*.14+h*h*.40;
   light.color.setRGB(1,.24+h*.20,.07+h*.10);
   return state;
  },
  reset(){pool.length=0;state.heat=0;state.trail=0;seeded=false;emitAccumulator=0;geometry.setDrawRange(0,0);light.intensity=0;for(const uniforms of glowing)uniforms.uFireHeat.value=0;},
  dispose(){
   group.removeFromParent();points.removeFromParent();light.removeFromParent();
   for(const sheet of sheets){sheet.mesh.geometry.dispose();sheet.mesh.material.dispose();}
   geometry.dispose();points.material.dispose();
  }
 };
}
