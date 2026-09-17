import * as T from 'three';
import {EMBER_RAMP_GLSL,FIRE_NOISE_GLSL,createWeaponFire,attackHeat} from './weapon-fire.js';
import {BladeTrail} from './blade-trail.js';
import {createBossAura} from './boss-aura.js';
import {BossBurst} from './boss-burst.js';
import {BossFissure} from './boss-fissure.js';
import {weaponGroundContact} from './contact-feedback.js';
import {strikeIndex,linearProgress} from './weapon-motion.js';

const FLAT_VERTEX=`varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;

// An expanding front with a noise-broken rim: grit and dust thrown outward
// along the flagstones rather than a clean geometric circle.
const RING_FRAGMENT=`
 uniform float uProgress,uPower,uSeed,uDust;
 varying vec2 vUv;
 ${FIRE_NOISE_GLSL}
 ${EMBER_RAMP_GLSL}
 void main(){
  vec2 p=(vUv-.5)*2.;
  float r=length(p);
  if(r>1.)discard;
  float angle=atan(p.y,p.x);
  float broken=ffbm(vec2(cos(angle)*2.4+uSeed,sin(angle)*2.4))*.34+ffbm(vec2(cos(angle)*7.1,sin(angle)*7.1+uSeed))*.14;
  float front=uProgress*(.72+broken*.5);
  float inner=smoothstep(front-.20-.26*uProgress,front-.010,r);
  // The outer rim is feathered wide and torn by a 2D field, so the front never
  // closes into a clean ellipse painted on the flagstones.
  float outer=1.-smoothstep(front-.06,front+.22,r);
  float band=inner*outer;
  // A blotchy field, not an angular one: sampling by angle alone drew straight
  // radial rays out of the impact, which read as a sunburst decal.
  float grit=ffbm(p*6.4+uSeed)*.60+ffbm(p*15.-uSeed)*.32+.26;
  // Holes: a ground pool with no gaps in it is a decal, not thrown grit.
  float holes=smoothstep(.30,.62,ffbm(p*3.6+uSeed)+ffbm(p*8.4-uSeed)*.5);
  float decay=(1.-uProgress)*(1.-uProgress*.62);
  float mask=band*grit*decay*mix(1.,holes,uDust);
  if(mask<.004)discard;
  vec3 dust=vec3(.355,.315,.265);
  // uDust 1 is the normal-blended grit wall (warm stone dust); uDust 0 the
  // additive punch of fire at the bite. Neither is allowed into the violet end
  // of the ramp, which is what made the old impact read pink.
  vec3 c=mix(dust,emberRamp(clamp(.54+band*.20,.54,.76)),(.36-uDust*.32)*(1.-uProgress));
  // The grit pool stays a dim stain: the airborne particle layers carry the mass.
  gl_FragColor=vec4(c*mix(.30+uPower*.34,.22,uDust),clamp(mask*uPower*mix(.66,.42,uDust),0.,.72));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
 }`;

// Radial fractures: thin, jagged, soot-dark fissures that keep a brief ember
// heart and then cool. Drawn with normal blending so the stone actually
// darkens rather than glowing like a decal sticker.
const CRACK_FRAGMENT=`
 uniform float uAge,uSeed,uPower;
 varying vec2 vUv;
 ${FIRE_NOISE_GLSL}
 ${EMBER_RAMP_GLSL}
 float fissures(vec2 p,float count,float seed,float width){
  float a=atan(p.y,p.x)/6.28318+.5, r=length(p);
  float cell=floor(a*count), f=fract(a*count);
  float jitter=fhash(vec2(cell,seed))*.7+.15;
  // Reach varies from almost nothing to a third of the decal, and a third of
  // the spokes are missing outright, so the break is never a radial star.
  float reach=fhash(vec2(cell,seed+11.))*.30+.09;
  float keep=step(.34,fhash(vec2(cell,seed+29.)));
  float wobble=(ffbm(vec2(cell*3.1+seed,r*13.))-.5)*.30+(ffbm(vec2(cell*8.3+seed,r*29.))-.5)*.12;
  float line=1.-smoothstep(0.,width*(.18+r*.55),abs(f-jitter+wobble));
  float gaps=smoothstep(.34,.56,ffbm(vec2(cell*5.7+seed,r*7.)));
  return line*gaps*keep*(1.-smoothstep(reach-.14,reach,r))*smoothstep(.03,.08,r);
 }
 void main(){
  vec2 p=(vUv-.5)*2.;
  float r=length(p);
  if(r>1.)discard;
  float core=max(fissures(p,7.,3.7,.080),fissures(p,15.,19.3,.046)*.72);
  float wide=max(fissures(p,7.,3.7,.130),fissures(p,15.,19.3,.082)*.72);
  // A hairline of chipped stone beside each fissure, no more. The old halo was
  // lighter than the flagstone it sat on, which read as chalk scratches.
  float halo=max(0.,wide-core);
  float crater=1.-smoothstep(.0,.13,r);
  float scorch=(1.-smoothstep(.06,.55,r))*(.4+ffbm(p*5.+uSeed)*.45);
  float fade=1.-smoothstep(.20,.9,uAge);
  // The ember heart is one beat, and it lives only in the bite.
  float glow=max(0.,1.-uAge*11.)*(1.-smoothstep(.20,.42,r));
  // Weight sits on the near-black terms, so a stronger decal is a DEEPER soot
  // stain rather than a brighter scratch.
  float a=clamp((core*.98+halo*.30+crater*.96+scorch*.82)*fade*uPower,0.,.94);
  if(a<.008)discard;
  // Every colour here is darker than the unlit flagstone, so a struck stone can
  // only ever read as soot in a crack.
  vec3 c=mix(vec3(.008,.006,.007),vec3(.030,.026,.021),clamp(halo*1.1,0.,1.));
  c=mix(c,emberRamp(clamp(.56+core*.14,.56,.72))*.22,clamp(core*glow*.50,0.,.42));
  gl_FragColor=vec4(c,a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
 }`;

/** Ground impacts: a shockwave that runs out along the floor, a scorched crack
 * decal that cools over seconds, and a hard light flash. Dust, chips and the
 * camera kick are raised by the caller so every system peaks on the same frame. */
export class GroundImpacts{
 constructor(scene,{rings=2,decals=4}={}){
  this.scene=scene;this.rings=[];this.dustRings=[];this.decals=[];
  const plane=()=>{const g=new T.PlaneGeometry(1,1,1,1);g.rotateX(-Math.PI/2);return g;};
  // Two fronts. The hot one is additive fire at the bite. The grit one is
  // NORMAL blended so the dust actually covers the flagstones instead of only
  // adding a faint glow to an almost black floor.
  for(const dust of [0,1])for(let i=0;i<rings;i++){
   const uniforms={uProgress:{value:1},uPower:{value:1},uSeed:{value:i*3.9+dust*1.7},uDust:{value:dust}};
   const mesh=new T.Mesh(plane(),new T.ShaderMaterial({uniforms,transparent:true,depthWrite:false,blending:dust?T.NormalBlending:T.AdditiveBlending,side:T.DoubleSide,vertexShader:FLAT_VERTEX,fragmentShader:RING_FRAGMENT}));
   mesh.name=dust?'Grit front':'Shockwave';mesh.visible=false;mesh.frustumCulled=false;mesh.renderOrder=dust?2:4;
   mesh.userData.cosmetic=true;mesh.userData.noPuddleReflection=true;
   scene.add(mesh);(dust?this.dustRings:this.rings).push({mesh,uniforms,time:0,life:0,radius:1});
  }
  for(let i=0;i<decals;i++){
   const uniforms={uAge:{value:1},uSeed:{value:i*6.1},uPower:{value:1}};
   const mesh=new T.Mesh(plane(),new T.ShaderMaterial({uniforms,transparent:true,depthWrite:false,side:T.DoubleSide,vertexShader:FLAT_VERTEX,fragmentShader:CRACK_FRAGMENT,polygonOffset:true,polygonOffsetFactor:-4,polygonOffsetUnits:-4}));
   mesh.name='Fracture scorch';mesh.visible=false;mesh.frustumCulled=false;mesh.renderOrder=3;
   mesh.userData.cosmetic=true;mesh.userData.noPuddleReflection=true;
   scene.add(mesh);this.decals.push({mesh,uniforms,time:0,life:0});
  }
  this.flash=new T.PointLight(0xff6a24,0,8,2);this.flash.userData.cosmetic=true;scene.add(this.flash);
  this.next={ring:0,dustRing:0,decal:0};
 }
 strike(at,{power=1,radius=3.2,ringLife=.62,decalLife=4.2,decal:withDecal=true,flash=4.2,kind='hot'}={}){
  const pool=kind==='dust'?this.dustRings:this.rings,key=kind==='dust'?'dustRing':'ring';
  const ring=pool[this.next[key]=(this.next[key]+1)%pool.length];
  ring.mesh.position.set(at.x,.05,at.z);ring.mesh.scale.set(radius*2,1,radius*2);
  ring.uniforms.uPower.value=power;ring.uniforms.uSeed.value=Math.random()*20;
  ring.time=0;ring.life=ringLife;ring.mesh.visible=true;
  if(withDecal){
   const decal=this.decals[this.next.decal=(this.next.decal+1)%this.decals.length];
   decal.mesh.position.set(at.x,.035,at.z);
   const size=radius*(.60+Math.random()*.14);decal.mesh.scale.set(size*2,1,size*2);
   decal.mesh.rotation.y=Math.random()*Math.PI*2;
   decal.uniforms.uPower.value=Math.min(1,power);decal.uniforms.uSeed.value=Math.random()*20;
   decal.time=0;decal.life=decalLife;decal.mesh.visible=true;
  }
  this.flash.position.set(at.x,.55,at.z);
  this.flash.intensity=Math.max(this.flash.intensity,flash*power);
  return this;
 }
 update(dt){
  const step=Math.max(0,dt);
  this.flash.intensity*=Math.exp(-step*11);
  if(this.flash.intensity<.02)this.flash.intensity=0;
  for(const ring of [...this.rings,...this.dustRings]){
   if(!ring.mesh.visible)continue;
   ring.time+=step;
   const progress=ring.time/ring.life;
   if(progress>=1){ring.mesh.visible=false;continue;}
   ring.uniforms.uProgress.value=Math.pow(progress,.55);
  }
  for(const decal of this.decals){
   if(!decal.mesh.visible)continue;
   decal.time+=step;
   const age=decal.time/decal.life;
   if(age>=1){decal.mesh.visible=false;continue;}
   decal.uniforms.uAge.value=age;
  }
 }
 reset(){for(const item of [...this.rings,...this.dustRings,...this.decals])item.mesh.visible=false;this.flash.intensity=0;}
 dispose(){for(const item of [...this.rings,...this.dustRings,...this.decals]){item.mesh.removeFromParent();item.mesh.geometry.dispose();item.mesh.material.dispose();}this.flash.removeFromParent();}
}


// The authored slam clip stops the scythe ~1.2 m above the flagstones, so the
// last stretch of the cut is carried by fire. This is not a radial nova: it is a
// blade-shaped cleave, a sheet of dark fire spanning the cutting edge and driven
// straight down into the stone, at full strength on the very frame the blade
// bottoms out and joined to the edge while the cut finishes.
// Three sheets crossed about the vertical axis give it body from every angle,
// and the foot is buried below the flagstones so no card edge is ever visible.
const CLEAVE_VERTEX=`varying vec2 vUv; varying vec3 vNrm;
 void main(){vUv=uv;vNrm=normalMatrix*normal;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const CLEAVE_FRAGMENT=`
 uniform float uTime,uLife,uSeed,uFoot,uGain,uCore;
 varying vec2 vUv; varying vec3 vNrm;
 ${FIRE_NOISE_GLSL}
 ${EMBER_RAMP_GLSL}
 void main(){
  // A sheet seen edge-on collapses onto a line, and additive blending turns
  // that line into a hard bright seam. Fade each sheet out as it turns away.
  float face=abs(normalize(vNrm).z);
  float facing=smoothstep(.30,.76,face);
  if(facing<=0.)discard;
  // vUv.y 0 is buried under the stone, uFoot is the floor line, 1 is the blade.
  float up=clamp((vUv.y-uFoot)/max(1e-3,1.-uFoot),0.,1.);
  float across=abs((vUv.x-.5)*2.);
  // Widest where it bites the stone, tight where it rides the cutting edge.
  float width=mix(1.00,.56,pow(max(up,0.),.7));
  float shape=1.-smoothstep(width*.30,width,across);
  if(shape<=0.)discard;
  vec2 q=vec2((vUv.x-.5)*5.4+uSeed,up*4.6)-vec2(0.,uTime*2.6);
  float n=ffbm(q+vec2(ffbm(q*.8)*1.25,0.));
  // Noise, not the silhouette, decides what survives — and every term, the
  // spine and the bite included, is gated by a threshold that reaches zero, so
  // no smooth analytic shape can ever draw a straight edge of its own.
  float torn=smoothstep(.40,.74,n);
  float body=torn*shape;
  float spine=(1.-smoothstep(0.,.26*width,across))*shape*(.24+smoothstep(.45,1.,up)*.46)*uCore*smoothstep(.34,.70,n);
  float bite=smoothstep(.42,.02,up)*shape*torn*1.5;
  float mask=(body+spine+bite*.75)*uLife*facing;
  // Every edge of the quad is faded out well inside its own geometry: the foot
  // is buried under the flagstones, the head fades ABOVE the blade (the sheet is
  // built taller than the cut), and the flanks die before the silhouette.
  // The foot fade completes WELL ABOVE the stone, so where the floor clips the
  // sheet it is already down to a sixth of its strength: no straight line can
  // be drawn along the cut. The bite itself is carried by the ground burst.
  mask*=smoothstep(uFoot*.5,uFoot*2.6,vUv.y)*(1.-smoothstep(.70,1.,up))*(1.-smoothstep(.58,1.,across));
  if(mask<.006)discard;
  float heat=clamp(.50+mask*.28,.50,.80);
  vec3 c=emberRamp(heat)*(.30+uLife*.40)*uGain;
  gl_FragColor=vec4(c,clamp(mask*.60*uGain,0.,.74));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
 }`;

/** The fire that finishes the cut: a cleave sheet from the blade edge into the
 * stone. `strike(from,to,{yaw})` aligns it with the cut; `track` keeps its top on
 * the blade for the rest of the damage window. */
export class FireCleave{
 constructor(scene,{count=2,sheets=3,sink=.5}={}){
  this.items=[];this.next=0;this.sink=sink;
  for(let i=0;i<count;i++){
   const group=new T.Group();group.name='Scythe cleave';group.visible=false;
   group.userData.cosmetic=true;group.userData.noPuddleReflection=true;
   const parts=[];
   for(let sheet=0;sheet<sheets;sheet++){
    const uniforms={uTime:{value:0},uLife:{value:0},uSeed:{value:i*4.3+sheet*9.1},uFoot:{value:.3},
     uGain:{value:sheet?.70:1},uCore:{value:sheet?.35:1}};
    const geometry=new T.PlaneGeometry(1,1,1,1);geometry.translate(0,.5,0);
    const mesh=new T.Mesh(geometry,new T.ShaderMaterial({uniforms,transparent:true,depthWrite:false,side:T.DoubleSide,blending:T.AdditiveBlending,vertexShader:CLEAVE_VERTEX,fragmentShader:CLEAVE_FRAGMENT}));
    mesh.rotation.y=sheet*Math.PI/sheets;
    mesh.frustumCulled=false;mesh.renderOrder=7;
    mesh.userData.cosmetic=true;mesh.userData.noPuddleReflection=true;
    group.add(mesh);parts.push({mesh,uniforms});
   }
   scene.add(group);
   this.items.push({group,parts,time:0,life:0,width:1,height:1});
  }
 }
 /** @param {{x,y,z}} from blade edge  @param {{x,y,z}} to the stone it bites */
 strike(from,to,{life=.62,width=1.6,yaw=0}={}){
  const item=this.items[this.next=(this.next+1)%this.items.length];
  item.width=width;item.time=0;item.life=life;item.group.visible=true;
  item.group.rotation.y=yaw;
  this.#place(item,from,to);
  for(const part of item.parts)part.uniforms.uSeed.value=Math.random()*20+part.uniforms.uSeed.value*.01;
  return this;
 }
 /** Keep the cleave welded to the blade while the cut finishes. */
 track(from,to){
  const item=this.items[this.next];
  if(!item||!item.group.visible||item.time>.26)return this;
  this.#place(item,from,to,.4);
  return this;
 }
 #place(item,from,to,lerp=1){
  const floor=to.y??.04;
  // Built 30% taller than the cut so the soft head of the sheet sits ABOVE the
  // blade: the fire is at full strength where the edge actually is.
  const height=Math.max(.35,(from.y??1)-floor)*1.30+this.sink;
  item.height=item.height*(1-lerp)+height*lerp;
  const x=item.group.position.x*(1-lerp)+to.x*lerp,z=item.group.position.z*(1-lerp)+to.z*lerp;
  item.group.position.set(x,floor-this.sink,z);
  for(const part of item.parts){
   part.uniforms.uFoot.value=this.sink/Math.max(.01,item.height);
   part.mesh.scale.set(item.width,item.height,1);
  }
 }
 update(dt,time){
  for(const item of this.items){
   if(!item.group.visible)continue;
   item.time+=Math.max(0,dt);
   const age=item.time/item.life;
   if(age>=1){item.group.visible=false;continue;}
   // Full strength on the first frame and then decaying: ramping up over a
   // quarter second meant the impact frame itself showed almost nothing.
   const life=Math.pow(1-age,.9);
   for(const part of item.parts){part.uniforms.uTime.value=time;part.uniforms.uLife.value=life;
    part.mesh.scale.set(item.width*(.92+age*.42),item.height,1);}
  }
 }
 reset(){for(const item of this.items){item.group.visible=false;item.time=0;}}
 dispose(){for(const item of this.items){for(const part of item.parts){part.mesh.geometry.dispose();part.mesh.material.dispose();}item.group.removeFromParent();}}
}

/** Yaw that lays a cleave sheet along the horizontal direction of a blade
 * segment, so the sheet spans the cut instead of facing the camera. */
export function cutYaw(segment,fallback=0){
 if(!segment)return fallback;
 const dx=segment[1][0]-segment[0][0],dz=segment[1][2]-segment[0][2];
 return Math.hypot(dx,dz)<.05?fallback:Math.atan2(-dz,dx);
}

const IMPACT_SOUND={slam:'groundSlam',fire:'darkFire',roar:'bossRoar'};

/** Resting levels, 0..1 — the knobs behind "always glowing" (round 2). The
 * blades smoulder at these heats between attacks, the hood aura and the hood
 * interior burn at these floors; every attack climbs from here to 1. */
export const REST={bossHeat:.30,bossHeat2:.42,playerHeat:.22,aura:.42,aura2:.60,hood:.45,hood2:.65};

/** Everything the fight needs to feel heavy, assembled in one place so
 * src/game/main.js only gains a handful of call sites. */
/** `post` (optional) is rendering.js's post-process hook: shock(worldPos,strength) for the refraction ring, flash(rgb,strength). */
export function createCombatEffects({scene,camera,effects,actors,fight,audio,post=null}={}){
 const boss=actors.boss,player=actors.player;
 const bossFire=createWeaponFire(boss.weapon,boss.weaponSegment,{scene,boss:true,embers:110});
 // Round 3: the exile's steel burns a little hotter (.40 -> .55) and leaves a real trail (user: "our sword's visual effect").
 const playerFire=createWeaponFire(player.weapon,player.weaponSegment,{scene,boss:false,embers:36,gain:.55});
 // 40 samples so the flurry can lengthen the trail's life without a new buffer.
 const bossTrail=new BladeTrail(scene,{samples:40,life:.24,opacity:.42,smoke:1,name:'Scythe trail'});
 const playerTrail=new BladeTrail(scene,{samples:24,life:.20,opacity:.30,smoke:.8,name:'Steel trail'});
 const aura=createBossAura(boss.body.getObjectByName('mixamorigHead'),scene,{scale:boss.worldScale||1});
 const impacts=new GroundImpacts(scene);
 const cleave=new FireCleave(scene);
 const burst=new BossBurst(scene,{radius:3.2});
 const fissure=new BossFissure(scene);
 const tip=new T.Vector3(),previousTip=new T.Vector3(),direction=new T.Vector3(),lowest=new T.Vector3();
 const inner=new T.Vector3(),outer=new T.Vector3(),along=new T.Vector3(),origin=new T.Vector3(),front=new T.Vector3();
 let bossHeat=REST.bossHeat,playerHeat=REST.playerHeat,pendingShake=0,pendingHitStop=0,pendingFov=0,bladeFlash=0,sweepEmit=0,fissureEmit=0;
 // bossFlash: a per-sweep scythe flare (flurry) and the burst's spike. auraSpike
 // drives the hood to 1 for the burst; auraFlare kicks the aura light.
 let bossFlash=0,auraSpike=0,auraFlare=0;
 // event() runs from handleEvents() immediately BEFORE sample(), whose first act
 // is to clear the pending kick — so an event's shake needs its own accumulator
 // or it is wiped before anything ever reads it.
 let eventShake=0,eventHitStop=0,eventFov=0;

 const play=(key,gain,at)=>{try{audio?.play(IMPACT_SOUND[key]||key,gain,at);}catch{/* audio is best effort */}};

 function heatFor(state,timings,idle){
  const action=state.action;
  const heat=attackHeat(action,timings[action?.name],{idle});
  return state.health<=0?0:heat;
 }

 function pushTrail(trail,actor,heat){
  if(!actor.segment)return 0;
  tip.set(...actor.segment[1]);
  const moved=actor.previousSegment?tip.distanceTo(previousTip.set(...actor.previousSegment[1])):0;
  if(moved>.008)trail.push(actor.segment,heat);
  return moved;
 }

 return{
  bossFire,playerFire,bossTrail,playerTrail,aura,impacts,cleave,burst,fissure,
  get state(){return{bossHeat,playerHeat,bossFlash,auraSpike};},
  /** Called from the fixed-step update, where the blade segments are fresh.
   * Returns the camera kick the frame should apply. */
  sample(dt){
   pendingShake=0;pendingHitStop=0;pendingFov=0;
   const step=Math.max(1e-4,dt);
   const bossAction=fight.boss.action;
   // Resting floors first: the scythe smoulders between attacks (hotter in
   // phase two), the exile's steel too. Attacks climb from there to 1.
   bossHeat=heatFor(fight.boss,fight.timings.boss,fight.boss.phase===2?REST.bossHeat2:REST.bossHeat);
   if(fight.boss.phase===2&&bossAction?.name!=='awaken')bossHeat=Math.min(1,bossHeat*1.10);
   if(fight.boss.health>0)bossHeat=Math.max(bossHeat,bossFlash);
   playerHeat=Math.max(heatFor(fight.player,fight.timings.player,REST.playerHeat),bladeFlash);
   bladeFlash=Math.max(0,bladeFlash-step*4.5);bossFlash=Math.max(0,bossFlash-step*3.2);
   auraSpike=Math.max(0,auraSpike-step*1.1);auraFlare=Math.max(0,auraFlare-step*2.6);
   if(bossAction?.name!=='burst'&&burst.warnLevel>0)burst.warnAt(boss.root.position,0);
   if(bossAction?.name!=='fissure'&&fissure.warn.visible)fissure.warnAt(null,0,0,0);
   const bossMoved=pushTrail(bossTrail,boss,bossHeat);
   pushTrail(playerTrail,player,playerHeat);

   if(bossAction){
    const timing=fight.timings.boss[bossAction.name];
    const strike=strikeIndex(bossAction.name,bossAction.elapsed,true,fight.timings.boss);
    // Flurry (COMBAT's fast double sweep): a longer, brighter trail and a scythe
    // flare per sweep. The trail's shader is untouched; only life and gain move.
    const flurry=bossAction.name==='flurry',phaseTwo=fight.boss.phase===2;
    bossTrail.life=flurry?.34:phaseTwo?.30:.24;bossTrail.uniforms.uOpacity.value=flurry?.68:phaseTwo?.55:.42;bossTrail.uniforms.uSmoke.value=flurry?1.25:1;
    // Round 3: the tell. In the last third of a second before any cut opens the blade flares and the hood
    // spikes - a readable "now" on top of the slow build attackHeat already draws through the windup.
    {const tellStart=timing?.hitWindows?.[0]?.[0]??timing?.windup;
     if(Number.isFinite(tellStart)){const pre=tellStart-bossAction.elapsed;if(pre>0&&pre<.30){bossFlash=Math.max(bossFlash,.9*(1-pre/.30));auraSpike=Math.max(auraSpike,.5*(1-pre/.30));}}}
    // The fire roars the instant the cut becomes live.
    if(strike>=0&&bossAction.fxStrike!==strike){
     bossAction.fxStrike=strike;
     play('fire',1,{x:boss.root.position.x,z:boss.root.position.z});
     if(flurry){bossFlash=1;auraSpike=Math.max(auraSpike,.85);}
    }
    // Burst (COMBAT's ring eruption): through the windup a ring of coals on the
    // flagstones marks the reach and brightens toward the hit; when the window
    // opens the fire erupts, with the slam's shockwave and grit, embers, the
    // hood and the scythe spiking, the aura light flaring and one strong kick.
    if(bossAction.name==='burst'&&!bossAction.fxBurst){
     const start=timing?.hitWindows?.[0]?.[0]??timing?.windup??1;
     const at=boss.root.position;
     burst.radius=Number.isFinite(timing?.reach)&&timing.reach>1?timing.reach:3.2;
     if(strike>=0||bossAction.elapsed>=start){
      bossAction.fxBurst=true;
      const power=fight.boss.phase===2?1.2:1,reach=burst.radius;
      const contact=lowest.set(at.x,.04,at.z);
      burst.erupt(contact,{power,life:1.05});
      // The burst is the slam clip planted: the same fire cleave carries the cut
      // from the blade edge into the stone under the tip, so the scythe and the
      // ring are one thing. The shared track branch below keeps it on the blade.
      if(boss.segment){tip.set(...boss.segment[1]);bossAction.fxGround=true;
       cleave.strike(tip,{x:tip.x,y:.04,z:tip.z},{life:.66,width:2.0*power,yaw:cutYaw(boss.segment)});}
      impacts.strike(contact,{power:power*1.1,radius:reach*.55,ringLife:.34,decal:false,flash:4.6});
      impacts.strike(contact,{power,radius:reach*1.05,ringLife:.95,decalLife:3.0,kind:'dust'});
      effects.ground(contact,1.4*power,{dust:.3});
      effects.dustWall(contact,{count:90,radius:.6,speed:5.4*power,size:.36,opacity:.13,tint:0x6e5f4c,growth:2.2,life:.60,rise:.7});
      effects.dustWall(contact,{count:48,radius:1.3,speed:2.6*power,size:.50,opacity:.10,tint:0x4a3d34,growth:2.5,life:.90,rise:1.3});
      effects.burst({x:at.x,y:.6,z:at.z},0xd4682a,44,3.2);
      play('fire',1,contact);play('slam',.75,contact);
      post?.shock(contact,1.0*power);
      pendingShake=Math.max(pendingShake,.58*power);
      pendingHitStop=Math.max(pendingHitStop,.09);pendingFov=3;
      bossFlash=1;auraSpike=1;auraFlare=1;
     }else burst.warnAt(at,Math.pow(Math.min(1,bossAction.elapsed/Math.max(.1,start)),1.5));
    }
    // Fissure (round 3): a seam of coals lengthens along the boss's facing through the windup; when the
    // window opens the floor tears along it and the front races out at the rule's own pace
    // (linearProgress), throwing embers and grit, and the far end erupts when it arrives. Reach and
    // width are the rule's (world metres); the fire starts 0.7 m ahead, under the planted blade.
    if(bossAction.name==='fissure'){
     const start=timing?.hitWindows?.[0]?.[0]??timing?.windup??1,at=boss.root.position,yaw=boss.root.rotation.y;
     const reach=Math.max(2,(timing?.reach??9)-.7),width=timing?.width??1.3,power=fight.boss.phase===2?1.2:1;
     origin.set(at.x+Math.sin(yaw)*.7,.04,at.z+Math.cos(yaw)*.7);
     if(!bossAction.fxFissure){
      if(strike>=0||bossAction.elapsed>=start){
       bossAction.fxFissure=true;
       fissure.strike(origin,yaw,{reach,width,power,life:1.9});
       if(boss.segment){tip.set(...boss.segment[1]);bossAction.fxGround=true;cleave.strike(tip,{x:tip.x,y:.04,z:tip.z},{life:.6,width:1.8*power,yaw:cutYaw(boss.segment)});}
       impacts.strike(origin,{power:power*.9,radius:1.3,ringLife:.3,decal:false,flash:3.4});
       effects.ground(origin,1.2*power,{dust:.3});
       effects.dustWall(origin,{count:40,radius:.4,speed:3.2*power,size:.34,opacity:.13,tint:0x6e5f4c,growth:2.2,life:.55,rise:.7});
       play('fire',1,origin);play('slam',.7,origin);
       post?.shock(origin,.75);
       pendingShake=Math.max(pendingShake,.5*power);pendingHitStop=Math.max(pendingHitStop,.06);pendingFov=2;
       bossFlash=1;auraSpike=Math.max(auraSpike,.8);
      }else fissure.warnAt(origin,yaw,reach,Math.pow(Math.min(1,bossAction.elapsed/Math.max(.1,start)),1.4));
     }else{
      const progress=linearProgress(timing,bossAction);fissure.track(progress);
      if(!bossAction.fxFissureEnd){
       fissure.frontPosition(front);
       fissureEmit+=step;
       if(fissureEmit>=.03){fissureEmit=0;effects.burst(front,0xd4682a,4,1.6);effects.dustWall(front,{count:3,radius:.25,speed:2.2,size:.28,opacity:.14,tint:0x5a4a3c,rise:1.2,growth:2.2,life:.5});}
       if(progress>=1){bossAction.fxFissureEnd=true;
        impacts.strike(front,{power:power*.9,radius:1.4*power,ringLife:.4,decalLife:3,flash:3.6});
        effects.ground(front,1.3*power,{dust:.4});
        effects.dustWall(front,{count:36,radius:.4,speed:3.4*power,size:.36,opacity:.13,tint:0x6e5f4c,growth:2.2,life:.6,rise:.9});
        play('slam',.5,front);pendingShake=Math.max(pendingShake,.28*power);}
      }
     }
    }
    // The slam lands when the blade bottoms out inside its damage window. The
    // authored clip stops the edge ~0.17 m above the floor, so a real crossing
    // is used when there is one and the fire cleave carries the cut down when
    // there is not — either way the impact is on the flagstones.
    if(strike>=0&&bossAction.name==='slam'&&!bossAction.fxGround&&boss.segment){
     const crossing=weaponGroundContact(boss.previousSegment,boss.segment);
     tip.set(...boss.segment[1]);
     const rising=bossAction.fxLowest!=null&&tip.y>bossAction.fxLowest+.012;
     const ending=Number.isFinite(timing?.hitWindows?.at(-1)?.[1])&&bossAction.elapsed>=timing.hitWindows.at(-1)[1]-.05;
     bossAction.fxLowest=Math.min(bossAction.fxLowest??tip.y,tip.y);
     if(crossing||rising||ending){
      bossAction.fxGround=true;
      const contact=crossing||lowest.set(tip.x,.04,tip.z);
      const power=fight.boss.phase===2?1.25:1;
      if(!crossing)cleave.strike(tip,contact,{life:.62,width:2.3*power,yaw:cutYaw(boss.segment)});
      // Two fronts: a fast tight punch of fire at the bite, then the wide wall
      // of grit that runs out across the flagstones and carries the fracture.
      impacts.strike(contact,{power:power*1.1,radius:1.5*power,ringLife:.30,decal:false,flash:3.8});
      impacts.strike(contact,{power,radius:2.2*power,ringLife:.80,decalLife:3.4,kind:'dust'});
      // Chips and grit first, then a low wall of dust dense enough to hide the
      // flagstones, then a slower plume that lifts behind it.
      effects.ground(contact,1.5*power,{dust:.35});effects.ground(contact,1.35*power,{dust:0});
      effects.dustWall(contact,{count:96,radius:.30,speed:4.4*power,size:.34,opacity:.135,tint:0x7d6e59,growth:2.2,life:.52,rise:.60});
      effects.dustWall(contact,{count:60,radius:.70,speed:2.6*power,size:.48,opacity:.105,tint:0x6a5f4d,growth:2.4,life:.76,rise:1.00});
      effects.dustWall(contact,{count:28,radius:.20,speed:1.2,size:.52,opacity:.085,tint:0x4e463b,growth:2.6,life:1.40,rise:2.6});
      effects.burst(contact,0xd4682a,34,3.0);
      play('slam',1,contact);
      post?.shock(contact,.85*power);
      pendingShake=Math.max(pendingShake,.46*power);
      pendingHitStop=Math.max(pendingHitStop,.095);pendingFov=2.4;
     }
    }
    // While the cut finishes, the cleave stays welded to the blade edge, so the
    // weapon and the gash in the stone are one continuous thing.
    if((bossAction.name==='slam'||bossAction.name==='burst'||bossAction.name==='fissure')&&bossAction.fxGround&&boss.segment){
     tip.set(...boss.segment[1]);
     if(tip.y<2.4)cleave.track(tip,lowest.set(tip.x,.04,tip.z));
    }
    // The sweep displaces a wall of air and grit along the whole arc.
    if(strike>=0&&bossAction.name!=='slam'&&bossAction.name!=='fissure'){
     sweepEmit+=step;
     if(sweepEmit>=.022&&boss.segment){
      sweepEmit=0;
      inner.set(...boss.segment[0]);outer.set(...boss.segment[1]);
      direction.copy(outer).sub(previousTip.set(...(boss.previousSegment||boss.segment)[1]));
      const speed=direction.length()/step;direction.normalize();
      for(let i=0;i<3;i++){
       along.lerpVectors(inner,outer,.3+Math.random()*.8);
       effects.dustWall(along,{count:1,radius:.12,speed:Math.min(4.5,speed*.14),size:.20,opacity:.13,tint:0x5d5a53,
        direction,rise:.3,growth:2.4,life:.34});
      }
     }
    }else sweepEmit=.022;
   }else sweepEmit=.022;

   if(bossMoved>0&&bossHeat>.5&&fight.boss.phase===2&&Math.random()<step*6)
    effects.dustWall({x:boss.segment[1][0],y:boss.segment[1][1],z:boss.segment[1][2]},{count:1,radius:.1,speed:.6,size:.34,opacity:.12,tint:0x2a1c33});

   const shake=Math.max(pendingShake,eventShake),hitStop=Math.max(pendingHitStop,eventHitStop),fov=Math.abs(pendingFov)>=Math.abs(eventFov)?pendingFov:eventFov;
   eventShake=0;eventHitStop=0;eventFov=0;
   return{shake,hitStop,fov};
  },
  /** Fight events, mapped onto the same vocabulary of fire and grit. */
  event(type,{playerAt,bossAt,action}={}){
   if(type==='boss-hit'){
    bladeFlash=1;
    // Round 3: the heavy has to land like a heavy (user: "it doesn't feel impactful enough") - a bigger,
    // hotter burst, a ring of fire at the boss's feet, a thump, a refraction shock, a warm flash, a bigger
    // camera heave and a longer hit-stop; the lights stay a tap of sparks.
    const heavy=action==='heavy';
    if(bossAt){effects.burst(bossAt,heavy?0xffc27a:0xd9b98a,heavy?36:16,heavy?9:5);effects.dustWall(bossAt,{count:heavy?14:5,radius:.2,speed:heavy?2.6:1.4,size:.26,opacity:.2,tint:0x2b2026,rise:.8});
     if(heavy){impacts.strike({x:bossAt.x,z:bossAt.z},{power:.8,radius:1.1,ringLife:.32,decal:false,flash:3.2});
      effects.dustWall({x:bossAt.x,y:.08,z:bossAt.z},{count:22,radius:.35,speed:2.8,size:.3,opacity:.12,tint:0x6e5f4c,growth:2.2,life:.5,rise:.6});
      play('slam',.42,bossAt);post?.shock(bossAt,.6);post?.flash([1,.72,.45],.14);
      eventShake=Math.max(eventShake,.4);eventHitStop=Math.max(eventHitStop,.11);eventFov=-4;}
    }
   }
   if(type==='player-hit'||type==='guard-break'){
    if(playerAt){
     // Dark red and soot: the boss's fire biting into the exile. A guard break
     // also drives a wall of grit off the shield, away from the boss.
     const broken=type==='guard-break';
     direction.set(playerAt.x-(bossAt?.x??playerAt.x),0,playerAt.z-(bossAt?.z??playerAt.z));
     if(direction.lengthSq()<1e-4)direction.set(0,0,1);else direction.normalize();
     effects.burst(playerAt,broken?0xc9622a:0x8f2a16,broken?52:24,broken?5.4:2.2);
     // A broken guard throws shield edge off the arm: chips, not a floor ring.
     if(broken){effects.ground({x:playerAt.x,y:.04,z:playerAt.z},1.5,{dust:.2});
      effects.dustWall(playerAt,{count:14,radius:.10,speed:5.2,size:.20,opacity:.26,tint:0x6b6055,rise:1.4,growth:1.6,life:.26,direction});}
     effects.dustWall(playerAt,{count:broken?26:16,radius:.26,speed:broken?3.4:2.4,size:broken?.38:.30,
      opacity:broken?.24:.19,tint:broken?0x4a4038:0x3a2a28,rise:1.05,growth:2.1,life:.46,
      direction:broken?direction:null});
     if(broken){eventShake=Math.max(eventShake,.34);eventHitStop=Math.max(eventHitStop,.055);play('slam',.45,playerAt);}
    }
   }
   if(type==='block'&&playerAt)effects.dustWall(playerAt,{count:4,radius:.18,speed:1.6,size:.22,opacity:.18,tint:0x3a3f45,rise:.7});
   if(type==='phase-change'){
    const at=bossAt||new T.Vector3();
    impacts.strike({x:at.x,z:at.z},{power:1.2,radius:2.4,ringLife:.85,decalLife:3.4,kind:'dust'});
    impacts.strike({x:at.x,z:at.z},{power:1.1,radius:2.0,ringLife:.40,decal:false,flash:5.0});
    effects.dustWall({x:at.x,y:.1,z:at.z},{count:72,radius:1.0,speed:2.9,size:.54,opacity:.14,tint:0x635847,life:.78,rise:1.6,growth:2.4});
    effects.ground(new T.Vector3(at.x,.04,at.z),2.2);
    play('roar',1,at);
    eventShake=Math.max(eventShake,.52);
    eventHitStop=Math.max(eventHitStop,.08);
   }
   if(type==='boss-tell'){
    if(aura)aura.state.threat=Math.max(aura.state.threat,.45);
    if(action==='burst')auraSpike=Math.max(auraSpike,.55);
   }
  },
  /** Called once per rendered frame, where the camera is final. */
  update(dt,time){
   const step=Math.max(0,Math.min(dt,.1));
   bossFire?.update(step,time,{heat:bossHeat,camera});
   playerFire?.update(step,time,{heat:playerHeat,camera});
   bossTrail.update(step,time);
   playerTrail.update(step,time);
   const awaken=fight.boss.action?.name==='awaken';
   const dying=fight.boss.health<=0,phase2=fight.boss.phase===2;
   const life=dying?Math.max(0,1-(boss.deathTime||0)/1.8):1;
   aura?.update(step,time,{
    // Always burning: a standing floor at rest (more in phase two), the attack
    // heat through the tell and the hit window, an eruption for the awakening
    // and for the burst.
    threat:dying?0:Math.min(1,Math.max(bossHeat*.95,phase2?REST.aura2:REST.aura,awaken?1:0,auraSpike)),
    camera,life,flare:auraFlare});
   // The hood interior keeps a standing glow too; its attack anticipation is
   // still driven by the actor (head-effect.js).
   boss.headEffect?.setRest?.((phase2?REST.hood2:REST.hood)*life);
   impacts.update(step);
   cleave.update(step,time);
   burst.update(step,time);
   fissure.update(step,time,camera);
  },
  reset(){
   bossHeat=REST.bossHeat;playerHeat=REST.playerHeat;bladeFlash=0;bossFlash=0;auraSpike=0;auraFlare=0;pendingShake=0;pendingHitStop=0;pendingFov=0;sweepEmit=.022;fissureEmit=0;eventShake=0;eventHitStop=0;eventFov=0;
   bossTrail.life=.24;bossTrail.uniforms.uOpacity.value=.42;bossTrail.uniforms.uSmoke.value=1;
   bossFire?.reset();playerFire?.reset();bossTrail.reset();playerTrail.reset();aura?.reset();impacts.reset();cleave.reset();burst.reset();fissure.reset();
  },
  dispose(){bossFire?.dispose();playerFire?.dispose();bossTrail.dispose();playerTrail.dispose();aura?.dispose();impacts.dispose();cleave.dispose();burst.dispose();fissure.dispose();}
 };
}
