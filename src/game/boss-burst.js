import * as T from 'three';
import {EMBER_RAMP_GLSL,FIRE_NOISE_GLSL} from './weapon-fire.js';

// The boss's burst: he plants the scythe and dark fire erupts in a ring around
// him. Three pieces, all procedural and all in the project's ember ramp:
//  - the WARNING: a ring of coals crawling on the flagstones at the reach of the
//    eruption, dim while he plants and brightening toward the hit — "get out of
//    the ring" is readable during the windup;
//  - the FIRE RING: an open cylinder of flame tongues that races out from his
//    feet to the reach and then dies from the top down;
//  - the SMOKE RING: a normal-blended near-black shell just outside the fire, so
//    the eruption keeps a silhouette against a dark cathedral (the hood's lesson).
// The shockwave, grit, embers, camera kick, aura and scythe flare are raised by
// createCombatEffects on the same frame.

const FLAT_VERTEX=`varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const WARN_FRAGMENT=`
 uniform float uTime,uWarn,uSeed;
 varying vec2 vUv;
 ${FIRE_NOISE_GLSL}
 ${EMBER_RAMP_GLSL}
 void main(){
  vec2 p=(vUv-.5)*2.;
  float r=length(p);
  if(r>1.)discard;
  float angle=atan(p.y,p.x);
  // The band's radius wobbles with noise so it is never a clean circle painted
  // on the floor, and the coals inside it are cells that glow and die.
  float edge=(ffbm(vec2(cos(angle)*3.1+uSeed,sin(angle)*3.1-uTime*.4))-.5)*.14;
  float band=smoothstep(.76+edge,.88+edge,r)*(1.-smoothstep(.92+edge,1.,r));
  float coals=ffbm(vec2(angle*4.5+uSeed,r*22.-uTime*(1.2+uWarn*2.5)))*.7+ffbm(vec2(cos(angle)*9.,sin(angle)*9.+uTime*.8))*.3;
  float lit=smoothstep(.50-uWarn*.16,.74,coals);
  // Late in the windup the interior scorches faintly: the whole disc is the danger.
  float interior=(1.-smoothstep(.50,.84,r))*smoothstep(.34,.62,ffbm(p*4.+uSeed+uTime*.15))*.14*uWarn;
  float mask=(band*lit+interior)*uWarn;
  if(mask<.005)discard;
  vec3 c=emberRamp(clamp(.44+lit*.22+uWarn*.10,.44,.76))*(.16+uWarn*.54);
  gl_FragColor=vec4(c,clamp(mask*.85,0.,.66));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
 }`;

const WALL_VERTEX=`varying vec2 vUv; varying vec3 vNrm;
 void main(){vUv=uv;vNrm=normalMatrix*normal;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
// CylinderGeometry: uv.x runs around the ring, uv.y is 0 at the bottom, 1 at the top.
// The noise domain is built from cos/sin of the angle so the seam is invisible; two
// noises on the two axes keep the pattern from mirroring across the ring.
const WALL_FRAGMENT=`
 uniform float uTime,uLife,uSeed,uGain;
 varying vec2 vUv; varying vec3 vNrm;
 ${FIRE_NOISE_GLSL}
 ${EMBER_RAMP_GLSL}
 void main(){
  float up=vUv.y, a=vUv.x*6.28318;
  vec2 ring=vec2(cos(a),sin(a))*3.4;
  float warp=ffbm(ring*.6+vec2(uSeed,-uTime*.6));
  float n=ffbm(vec2(ring.x+uSeed,up*3.6-uTime*2.8+warp*1.2))*.55+ffbm(vec2(ring.y-uSeed*1.7,up*3.6-uTime*2.4+warp))*.45;
  // Tongues: the survival threshold rises with height so the wall tears into
  // separate licks and no straight top edge is ever drawn.
  float survive=smoothstep(.36+up*.44,.86,n);
  float rise=smoothstep(0.,.12,up);
  float holes=smoothstep(.28,.60,ffbm(vec2(ring.x*1.3+uSeed*.5,up*1.4-uTime*1.1)));
  float mask=survive*holes*rise*(1.-smoothstep(.52,1.,up))*uLife;
  // A sheet seen edge-on collapses to a bright line; fade with facing (cleave rule).
  float facing=smoothstep(.10,.55,abs(normalize(vNrm).z));
  mask*=mix(.30,1.,facing);
  if(mask<.006)discard;
  float heat=clamp(.48+mask*.24+(1.-up)*.10,.48,.80);
  vec3 c=emberRamp(heat)*(.34+uLife*.46)*uGain;
  gl_FragColor=vec4(c,clamp(mask*.70,0.,.72));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
 }`;
const SMOKE_FRAGMENT=`
 uniform float uTime,uLife,uSeed;
 varying vec2 vUv; varying vec3 vNrm;
 ${FIRE_NOISE_GLSL}
 void main(){
  float up=vUv.y, a=vUv.x*6.28318;
  vec2 ring=vec2(cos(a),sin(a))*2.2;
  float n=ffbm(vec2(ring.x+uSeed,up*2.2-uTime*1.3))*.5+ffbm(vec2(ring.y-uSeed,up*2.2-uTime*1.1+2.))*.5;
  float body=smoothstep(.40,.72,n);
  float mask=body*smoothstep(0.,.10,up)*(1.-smoothstep(.42,1.,up))*uLife;
  float facing=smoothstep(.10,.55,abs(normalize(vNrm).z));
  mask*=mix(.40,1.,facing);
  if(mask<.005)discard;
  // Near-black with only a trace of violet: at the plant the near side of this
  // shell lies over the lit flagstones, and a violet tint there read as a veil.
  vec3 c=mix(vec3(.003,.002,.005),vec3(.016,.009,.020),n);
  gl_FragColor=vec4(c,clamp(mask*.34,0.,.30));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
 }`;

const smooth=x=>{x=Math.max(0,Math.min(1,x));return x*x*(3-2*x);};

export class BossBurst{
 constructor(scene,{radius=3.2}={}){
  this.scene=scene;this.radius=radius;this.time=0;this.life=0;this.active=false;this.warnLevel=0;this.power=1;this.at=new T.Vector3();
  const plane=new T.PlaneGeometry(1,1,1,1);plane.rotateX(-Math.PI/2);
  this.warnUniforms={uTime:{value:0},uWarn:{value:0},uSeed:{value:1.3}};
  this.warn=new T.Mesh(plane,new T.ShaderMaterial({uniforms:this.warnUniforms,transparent:true,depthWrite:false,blending:T.AdditiveBlending,side:T.DoubleSide,vertexShader:FLAT_VERTEX,fragmentShader:WARN_FRAGMENT,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2}));
  this.warn.name='Burst warning ring';this.warn.visible=false;this.warn.frustumCulled=false;this.warn.renderOrder=3;
  this.warn.userData.cosmetic=true;this.warn.userData.noPuddleReflection=true;
  scene.add(this.warn);
  const wall=new T.CylinderGeometry(1,1,1,56,1,true);wall.translate(0,.5,0);
  this.wallUniforms={uTime:{value:0},uLife:{value:0},uSeed:{value:2.7},uGain:{value:1}};
  this.wall=new T.Mesh(wall,new T.ShaderMaterial({uniforms:this.wallUniforms,transparent:true,depthWrite:false,side:T.DoubleSide,blending:T.AdditiveBlending,vertexShader:WALL_VERTEX,fragmentShader:WALL_FRAGMENT}));
  this.wall.name='Burst fire ring';this.wall.visible=false;this.wall.frustumCulled=false;this.wall.renderOrder=7;
  // Reflects in the puddles on purpose: a ring of fire over wet stone has to.
  this.wall.userData.cosmetic=true;
  scene.add(this.wall);
  const smoke=new T.CylinderGeometry(1,1,1,40,1,true);smoke.translate(0,.5,0);
  this.smokeUniforms={uTime:{value:0},uLife:{value:0},uSeed:{value:4.1}};
  this.smoke=new T.Mesh(smoke,new T.ShaderMaterial({uniforms:this.smokeUniforms,transparent:true,depthWrite:false,side:T.DoubleSide,blending:T.NormalBlending,vertexShader:WALL_VERTEX,fragmentShader:SMOKE_FRAGMENT}));
  this.smoke.name='Burst smoke ring';this.smoke.visible=false;this.smoke.frustumCulled=false;this.smoke.renderOrder=6;
  this.smoke.userData.cosmetic=true;this.smoke.userData.noPuddleReflection=true;
  scene.add(this.smoke);
 }
 /** Windup: the ring of coals on the floor at `level` 0..1 (0 hides it). */
 warnAt(at,level){
  this.warnLevel=Math.max(0,Math.min(1,Number.isFinite(level)?level:0));
  this.warn.visible=this.warnLevel>.01;
  if(!this.warn.visible)return this;
  const r=this.radius*1.03;
  this.warn.position.set(at.x,.045,at.z);this.warn.scale.set(r*2,1,r*2);
  return this;
 }
 /** The eruption at `at`; `power` scales the gain (phase two), `life` the seconds it burns. */
 erupt(at,{power=1,life=1.05}={}){
  this.at.set(at.x,0,at.z);this.time=0;this.life=life;this.power=power;this.active=true;
  this.wall.visible=this.smoke.visible=true;
  this.wallUniforms.uSeed.value=Math.random()*20;this.smokeUniforms.uSeed.value=Math.random()*20;
  this.wallUniforms.uGain.value=power;
  this.warnLevel=0;this.warn.visible=false;
  return this;
 }
 update(dt,time){
  const step=Math.max(0,dt);
  this.warnUniforms.uTime.value=time;this.warnUniforms.uWarn.value=this.warnLevel;
  if(!this.active)return;
  this.time+=step;
  const age=this.time/this.life;
  if(age>=1){this.active=false;this.wall.visible=this.smoke.visible=false;return;}
  // The ring races out from the feet to the reach in a quarter second, stands,
  // then the tongues die from the top down while the smoke lingers a little.
  const reach=this.radius*(.30+.70*smooth(this.time/.24));
  const height=(1.5+this.power*.5)*(.55+.45*smooth(this.time/.18))*(1-smooth((age-.35)/.65)*.72);
  this.wall.position.set(this.at.x,.02,this.at.z);this.wall.scale.set(reach,height,reach);
  this.smoke.position.set(this.at.x,.02,this.at.z);this.smoke.scale.set(reach*1.05,height*1.12,reach*1.05);
  this.wallUniforms.uTime.value=time;this.wallUniforms.uLife.value=Math.pow(1-age,.8);
  this.smokeUniforms.uTime.value=time;this.smokeUniforms.uLife.value=Math.pow(1-age,.6);
 }
 reset(){this.active=false;this.warnLevel=0;this.time=0;this.warn.visible=this.wall.visible=this.smoke.visible=false;}
 dispose(){for(const mesh of [this.warn,this.wall,this.smoke]){mesh.removeFromParent();mesh.geometry.dispose();mesh.material.dispose();}}
}
