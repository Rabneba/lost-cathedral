import * as T from 'three';
import {EMBER_RAMP_GLSL,FIRE_NOISE_GLSL} from './weapon-fire.js';

// The boss's fissure (round 3, 16 Sep 2026 evening): he plants the scythe and the
// floor tears open along his facing, a line of dark fire racing out to the reach.
// Inspired by the line casts of github.com/achrefelouafi/LinearAbiltyCastingThreeJS
// (a fracture front racing down a line, a white-hot flash riding the front, a wide
// underglow under a narrow core), rebuilt in this project's ember ramp and noise.
// Four pieces, all procedural:
//  - the WARNING: a seam of coals that lengthens along the line through the windup
//    and brightens toward the hit - "get off the line" is readable before it opens;
//  - the FIRE: the crack itself on the flagstones, a noise-wandering core with side
//    veins and a flash at the racing front, additive;
//  - the SOOT: a normal-blended near-black gash around the core so the crack reads
//    as a hole in the stone and not as a light painted on it;
//  - the TONGUES: a standing sheet of flame licks along the line, torn by noise and
//    faded when seen edge-on (the cleave rule).
// The front is driven from the fight's own clip time (linearProgress), so the fire
// is exactly where the hit is. One point light, created at load, rides the front.

const FLAT_VERTEX=`varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const WALL_VERTEX=`varying vec2 vUv; varying vec3 vNrm;
 void main(){vUv=uv;vNrm=normalMatrix*normal;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
// The seam every layer shares: the warning glows where the crack will open.
const SEAM_GLSL=`
 float seamOffset(float x,float seed){return (ffbm(vec2(x*6.+seed,1.7))-.5)*.36+(ffbm(vec2(x*19.+seed*3.,4.1))-.5)*.10;}`;
const WARN_FRAGMENT=`
 uniform float uTime,uWarn,uSeed;
 varying vec2 vUv;
 ${FIRE_NOISE_GLSL}
 ${EMBER_RAMP_GLSL}
 ${SEAM_GLSL}
 void main(){
  float x=vUv.x,y=(vUv.y-.5)*2.;
  float d=abs(y-seamOffset(x,uSeed));
  // The seam lengthens with the windup and never draws a straight end.
  float reachNow=uWarn*1.04+(ffbm(vec2(y*3.+uSeed,uTime*.7))-.5)*.05;
  float grow=1.-smoothstep(reachNow-.05,reachNow+.02,x);
  float seam=1.-smoothstep(0.,.035+uWarn*.035,d);
  float coals=ffbm(vec2(x*28.+uSeed,uTime*1.5))*.7+ffbm(vec2(x*9.-uTime*.6,y*3.))*.3;
  float lit=smoothstep(.48-uWarn*.14,.78,coals);
  float halo=exp(-d*d*40.)*.30*lit;
  float mask=(seam*(.25+lit*.75)+halo)*grow*uWarn;
  mask*=smoothstep(0.,.06,x)*(1.-smoothstep(.94,1.,x));
  if(mask<.005)discard;
  vec3 c=emberRamp(clamp(.46+lit*.22+uWarn*.12,.46,.80))*(.18+uWarn*.6);
  gl_FragColor=vec4(c,clamp(mask*.9,0.,.7));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
 }`;
const FIRE_FRAGMENT=`
 uniform float uTime,uFront,uLife,uSeed,uGain;
 varying vec2 vUv;
 ${FIRE_NOISE_GLSL}
 ${EMBER_RAMP_GLSL}
 ${SEAM_GLSL}
 void main(){
  float x=vUv.x,y=(vUv.y-.5)*2.;
  float d=abs(y-seamOffset(x,uSeed));
  // Open only behind the racing front.
  float open=smoothstep(x-.05,x+.02,uFront);
  float w=.05+.03*ffbm(vec2(x*13.,uSeed));
  float core=1.-smoothstep(0.,w,d);
  float glow=exp(-d*d*9.)*.6;
  // Side veins: a blotchy field near the seam, never a radial star.
  float veins=smoothstep(.60,.72,ffbm(vec2(x*40.+uSeed*2.,y*6.)))*(1.-smoothstep(.05,.5,d));
  // A white-hot flash rides the propagating front - on the seam, not across the whole plane.
  float flash=(1.-smoothstep(0.,.10,abs(uFront-x)))*step(uFront,.999)*1.5*(1.-smoothstep(0.,.30,d));
  float pulse=.72+.28*sin(x*34.-uTime*9.+uSeed);
  float heat=(core*pulse+veins*.55)*uLife+flash;
  float mask=(core*1.1+glow*.7+veins*.5)*open*uLife+flash*open*(.5+glow);
  mask*=smoothstep(0.,.04,x)*(1.-smoothstep(.96,1.,x));
  if(mask<.005)discard;
  vec3 c=emberRamp(clamp(.50+heat*.30,.50,.98))*(.5+uLife*.6)*uGain;
  gl_FragColor=vec4(c,clamp(mask*.8,0.,.85));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
 }`;
const SOOT_FRAGMENT=`
 uniform float uTime,uFront,uLife,uSeed;
 varying vec2 vUv;
 ${FIRE_NOISE_GLSL}
 ${SEAM_GLSL}
 void main(){
  float x=vUv.x,y=(vUv.y-.5)*2.;
  float d=abs(y-seamOffset(x,uSeed));
  float open=smoothstep(x-.05,x+.02,uFront);
  float body=(1.-smoothstep(.03,.42,d))*(.55+ffbm(vec2(x*9.+uSeed,y*4.))*.6);
  // The gash outlasts the fire: the soot fades on the square root of the life.
  float mask=body*open*sqrt(uLife)*smoothstep(0.,.04,x)*(1.-smoothstep(.95,1.,x));
  if(mask<.005)discard;
  gl_FragColor=vec4(vec3(.006,.005,.006),clamp(mask*.6,0.,.62));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
 }`;
const TONGUE_FRAGMENT=`
 uniform float uTime,uFront,uLife,uSeed,uGain;
 varying vec2 vUv; varying vec3 vNrm;
 ${FIRE_NOISE_GLSL}
 ${EMBER_RAMP_GLSL}
 void main(){
  float x=vUv.x,up=vUv.y;
  float open=smoothstep(x-.04,x+.02,uFront);
  vec2 q=vec2(x*9.+uSeed,up*4.2-uTime*3.0);
  float warp=ffbm(q*.7+vec2(uTime*.3,0.));
  float n=ffbm(q+vec2(warp*1.3,0.));
  // Tongues: the survival threshold rises with height, so the sheet tears into licks.
  float survive=smoothstep(.38+up*.5,.88,n);
  float rise=smoothstep(0.,.10,up);
  float mask=survive*rise*(1.-smoothstep(.45,1.,up))*open*uLife;
  // Edge-on a sheet is a hard line: fade with facing.
  mask*=smoothstep(0.,.04,x)*(1.-smoothstep(.95,1.,x));
  if(mask<.006)discard;
  float heat=clamp(.48+mask*.26+(1.-up)*.12,.48,.82);
  vec3 c=emberRamp(heat)*(.30+uLife*.5)*uGain;
  gl_FragColor=vec4(c,clamp(mask*.66,0.,.7));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
 }`;

// Local X runs down the line (uv.x 0 at the boss, 1 at the reach), local Z across it.
function floorPlane(){const g=new T.PlaneGeometry(1,1,1,1);g.rotateX(-Math.PI/2);g.translate(.5,0,0);return g;}
function wallPlane(){const g=new T.PlaneGeometry(1,1,1,1);g.translate(.5,.5,0);return g;}
const smooth=x=>{x=Math.max(0,Math.min(1,x));return x*x*(3-2*x);};
const cameraWorld=new T.Vector3(),local=new T.Vector3();

export class BossFissure{
 constructor(scene,{count=2}={}){
  this.scene=scene;this.items=[];this.next=0;
  this.warnUniforms={uTime:{value:0},uWarn:{value:0},uSeed:{value:2.1}};
  this.warn=new T.Mesh(floorPlane(),new T.ShaderMaterial({uniforms:this.warnUniforms,transparent:true,depthWrite:false,blending:T.AdditiveBlending,side:T.DoubleSide,vertexShader:FLAT_VERTEX,fragmentShader:WARN_FRAGMENT,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2}));
  this.warn.name='Fissure warning seam';this.warn.visible=false;this.warn.frustumCulled=false;this.warn.renderOrder=3;
  this.warn.userData.cosmetic=true;this.warn.userData.noPuddleReflection=true;
  scene.add(this.warn);
  for(let i=0;i<count;i++){
   const group=new T.Group();group.name='Grave fissure';group.visible=false;group.userData.cosmetic=true;
   const uniforms={uTime:{value:0},uFront:{value:0},uLife:{value:0},uSeed:{value:i*7.7+1.3},uGain:{value:1}};
   const soot=new T.Mesh(floorPlane(),new T.ShaderMaterial({uniforms,transparent:true,depthWrite:false,side:T.DoubleSide,blending:T.NormalBlending,vertexShader:FLAT_VERTEX,fragmentShader:SOOT_FRAGMENT,polygonOffset:true,polygonOffsetFactor:-3,polygonOffsetUnits:-3}));
   soot.name='Fissure soot';soot.renderOrder=3;soot.frustumCulled=false;soot.userData.cosmetic=true;soot.userData.noPuddleReflection=true;
   const fire=new T.Mesh(floorPlane(),new T.ShaderMaterial({uniforms,transparent:true,depthWrite:false,side:T.DoubleSide,blending:T.AdditiveBlending,vertexShader:FLAT_VERTEX,fragmentShader:FIRE_FRAGMENT,polygonOffset:true,polygonOffsetFactor:-4,polygonOffsetUnits:-4}));
   // Reflects in the puddles on purpose: a line of fire over wet stone has to.
   fire.name='Fissure fire';fire.renderOrder=5;fire.frustumCulled=false;fire.userData.cosmetic=true;
   const tongues=new T.Mesh(wallPlane(),new T.ShaderMaterial({uniforms,transparent:true,depthWrite:false,side:T.DoubleSide,blending:T.AdditiveBlending,vertexShader:WALL_VERTEX,fragmentShader:TONGUE_FRAGMENT}));
   tongues.name='Fissure tongues';tongues.renderOrder=7;tongues.frustumCulled=false;tongues.userData.cosmetic=true;tongues.userData.noPuddleReflection=true;tongues.visible=false;
   // The tongues stand in their own frame (the group is scaled across the line, which would shear a sheet
   // rolled about the line axis): placed with the group, rolled toward the camera in update() like the
   // weapon fire's ribbons, so the flames read from every angle instead of vanishing end-on.
   group.add(soot,fire);scene.add(group);scene.add(tongues);
   this.items.push({group,uniforms,soot,fire,tongues,time:0,life:1.9,travel:.44,reach:8,width:1.3,power:1,front:0,tracked:false,origin:new T.Vector3(),direction:new T.Vector3(0,0,1)});
  }
  this.light=new T.PointLight(0xff5a1e,0,7,2);this.light.userData.cosmetic=true;scene.add(this.light);
  this.lightItem=null;
 }
 #place(object,origin,yaw,reach,width){
  object.position.set(origin.x,Number.isFinite(origin.y)?origin.y:.045,origin.z);
  // Local +X down the line: rigs face +Z, so the facing (sin yaw, cos yaw) is +X turned by yaw - pi/2.
  object.rotation.set(0,yaw-Math.PI/2,0);object.scale.set(Math.max(.5,reach),1,Math.max(.4,width));
 }
 /** Windup: the seam of coals at `level` 0..1 (0 hides it), from `origin` along `yaw` for `reach` metres. */
 warnAt(origin,yaw,reach,level){
  const value=Math.max(0,Math.min(1,Number.isFinite(level)?level:0));
  this.warnUniforms.uWarn.value=value;this.warn.visible=value>.01&&!!origin;
  if(this.warn.visible)this.#place(this.warn,{x:origin.x,y:.042,z:origin.z},yaw,reach,1.6);
  return this;
 }
 /** The floor tears open from `origin` along `yaw`. `travel` is the seconds the front needs when nobody tracks it. */
 strike(origin,yaw,{reach=8,width=1.3,power=1,travel=.44,life=1.9}={}){
  const item=this.items[this.next=(this.next+1)%this.items.length];
  Object.assign(item,{time:0,life,travel,reach,width,power,front:0,tracked:false});
  item.origin.set(origin.x,.045,origin.z);item.direction.set(Math.sin(yaw),0,Math.cos(yaw));
  this.#place(item.group,item.origin,yaw,reach,width*1.9);
  item.tongues.position.copy(item.origin);item.tongues.rotation.set(0,yaw-Math.PI/2,0);item.tongues.scale.set(Math.max(.5,reach),.75+.35*power,1);item.tongues.visible=true;
  item.uniforms.uSeed.value=Math.random()*20;item.uniforms.uGain.value=power;item.uniforms.uFront.value=0;item.uniforms.uLife.value=1;
  item.group.visible=true;this.lightItem=item;
  this.warn.visible=false;this.warnUniforms.uWarn.value=0;
  return item;
 }
 /** Drive the front from the rule's own progress (0..1) so the fire is exactly where the hit is. */
 track(progress){const item=this.lightItem;if(item&&item.group.visible){item.tracked=true;item.front=Math.max(item.front,Math.min(1,progress));}return this;}
 /** World position of the racing front (the last struck fissure). */
 frontPosition(target=new T.Vector3()){const item=this.lightItem;if(!item)return target.set(0,.05,0);return target.copy(item.origin).addScaledVector(item.direction,item.front*item.reach);}
 get active(){return this.items.some(item=>item.group.visible);}
 update(dt,time,camera=null){
  const step=Math.max(0,dt);
  this.warnUniforms.uTime.value=time;
  let lit=null;
  for(const item of this.items){
   if(!item.group.visible)continue;
   item.time+=step;
   const age=item.time/item.life;
   if(age>=1){item.group.visible=false;item.tongues.visible=false;if(this.lightItem===item)this.lightItem=null;continue;}
   if(camera){camera.getWorldPosition(cameraWorld);item.tongues.updateMatrixWorld(true);local.copy(cameraWorld);item.tongues.worldToLocal(local);item.tongues.rotation.x=Math.atan2(-local.y,local.z);}
   if(!item.tracked)item.front=Math.min(1,item.front+step/Math.max(1e-3,item.travel));
   item.uniforms.uTime.value=time;item.uniforms.uFront.value=item.front;
   item.uniforms.uLife.value=Math.pow(1-age,.9);
   // The tongues stand tallest just behind the front and sink as the fire dies.
   item.tongues.scale.y=(.75+.35*item.power)*(.55+.45*smooth(item.front*3))*(1-smooth((age-.3)/.7)*.7);
   if(item===this.lightItem)lit=item;
  }
  if(lit){
   const age=lit.time/lit.life;
   this.frontPosition(this.light.position);this.light.position.y=.5;
   this.light.intensity=(1.4+lit.power*.8)*(lit.front<1?1.5:1)*(1-age)*lit.power;
  }else this.light.intensity=0;
 }
 reset(){for(const item of this.items){item.group.visible=false;item.tongues.visible=false;item.time=0;item.front=0;}this.warn.visible=false;this.warnUniforms.uWarn.value=0;this.light.intensity=0;this.lightItem=null;}
 dispose(){
  this.warn.removeFromParent();this.warn.geometry.dispose();this.warn.material.dispose();
  for(const item of this.items){for(const mesh of [item.soot,item.fire,item.tongues]){mesh.geometry.dispose();mesh.material.dispose();}item.group.removeFromParent();item.tongues.removeFromParent();}
  this.light.removeFromParent();
 }
}
