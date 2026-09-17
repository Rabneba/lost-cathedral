import * as T from 'three';
import {EMBER_RAMP_GLSL,FIRE_NOISE_GLSL} from './weapon-fire.js';

const VERTEX=`attribute float aAge; attribute float aSide; attribute float aHeat;
 varying float vAge; varying float vSide; varying float vHeat;
 void main(){vAge=aAge;vSide=aSide;vHeat=aHeat;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;

const FRAGMENT=`uniform float uOpacity,uSmoke,uTime; varying float vAge,vSide,vHeat;
 ${FIRE_NOISE_GLSL}
 ${EMBER_RAMP_GLSL}
 void main(){
  float fade=pow(max(0.,1.-vAge),2.1);
  // The newest row sits on the blade itself; fading it in removes the hard
  // leading terminator the ribbon used to end on.
  float head=smoothstep(0.,.16,vAge);
  // The cutting edge (vSide 1) carries what heat there is; the haft side is
  // nothing. BOTH flanks are feathered well inside the ribbon's own geometry.
  float edgeward=smoothstep(.34,.99,vSide);
  float across=smoothstep(.02,.34,vSide)*(1.-smoothstep(.74,.96,vSide));
  // The only thing that decides what survives is noise, and it can reach zero:
  // a smear of heat torn into streaks, never a filled translucent slab.
  float grain=ffbm(vec2(vAge*9.5+uTime*.9,vSide*4.6+uTime*.25));
  float torn=smoothstep(.32,.62,grain+fade*.24);
  float a=fade*head*across*torn*mix(.10,1.,edgeward)*uOpacity;
  if(a<.004)discard;
  // Near-black body: additive blending makes it invisible away from the edge,
  // so the ribbon can never brighten a flat region of the screen.
  float heat=clamp(.46+vHeat*.28*edgeward,.46,.76);
  vec3 c=mix(vec3(.024,.020,.022),emberRamp(heat),clamp(vHeat*.95*edgeward*edgeward,0.,.88)*uSmoke);
  gl_FragColor=vec4(c*(.16+fade*.52),a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
 }`;

/** A ribbon swept from the blade segment's own history.
 * Each sample is the real [inner,tip] pair the hit detection used, so the trail
 * traces the actual cut rather than an approximated arc. Boss: long and smoky
 * with an ember edge. Player: short, faint steel. */
export class BladeTrail{
 constructor(scene,{samples=24,life=.28,opacity=.85,smoke=1,name='Blade trail'}={}){
  this.scene=scene;this.samples=samples;this.life=life;this.history=[];this.time=0;
  const geometry=this.geometry=new T.BufferGeometry();
  geometry.setAttribute('position',new T.Float32BufferAttribute(new Float32Array(samples*2*3),3));
  geometry.setAttribute('aAge',new T.Float32BufferAttribute(new Float32Array(samples*2),1));
  geometry.setAttribute('aSide',new T.Float32BufferAttribute(new Float32Array(samples*2),1));
  geometry.setAttribute('aHeat',new T.Float32BufferAttribute(new Float32Array(samples*2),1));
  const indices=[];
  for(let i=0;i<samples-1;i++){const o=i*2;indices.push(o,o+1,o+2,o+1,o+3,o+2);}
  geometry.setIndex(indices);geometry.setDrawRange(0,0);
  this.uniforms={uOpacity:{value:opacity},uSmoke:{value:smoke},uTime:{value:0}};
  this.mesh=new T.Mesh(geometry,new T.ShaderMaterial({uniforms:this.uniforms,transparent:true,depthWrite:false,side:T.DoubleSide,blending:T.AdditiveBlending,vertexShader:VERTEX,fragmentShader:FRAGMENT}));
  this.mesh.name=name;this.mesh.frustumCulled=false;this.mesh.renderOrder=5;
  this.mesh.userData.cosmetic=true;this.mesh.userData.noPuddleReflection=true;
  this.mesh.visible=false;
  scene.add(this.mesh);
 }
 /** @param {number[][]} segment world-space [[x,y,z],[x,y,z]] */
 push(segment,heat=0){
  if(!segment)return;
  const last=this.history.at(-1);
  // A stationary blade must not stack samples on top of each other.
  if(last&&Math.hypot(segment[1][0]-last.b[0],segment[1][1]-last.b[1],segment[1][2]-last.b[2])<.012&&this.time-last.t<.05)return;
  this.history.push({a:[...segment[0]],b:[...segment[1]],t:this.time,heat});
  while(this.history.length>this.samples)this.history.shift();
 }
 update(dt,time=0){
  this.time+=Math.max(0,dt);
  this.uniforms.uTime.value=time;
  while(this.history.length&&this.time-this.history[0].t>this.life)this.history.shift();
  const count=this.history.length;
  if(count<2){this.geometry.setDrawRange(0,0);this.mesh.visible=false;return;}
  const position=this.geometry.attributes.position,age=this.geometry.attributes.aAge,side=this.geometry.attributes.aSide,heat=this.geometry.attributes.aHeat;
  for(let i=0;i<count;i++){
   const sample=this.history[i],o=i*2,ratio=Math.min(1,(this.time-sample.t)/this.life);
   position.setXYZ(o,sample.a[0],sample.a[1],sample.a[2]);
   position.setXYZ(o+1,sample.b[0],sample.b[1],sample.b[2]);
   age.setX(o,ratio);age.setX(o+1,ratio);
   side.setX(o,0);side.setX(o+1,1);
   heat.setX(o,sample.heat);heat.setX(o+1,sample.heat);
  }
  position.needsUpdate=age.needsUpdate=side.needsUpdate=heat.needsUpdate=true;
  this.geometry.setDrawRange(0,(count-1)*6);
  this.mesh.visible=true;
 }
 reset(){this.history.length=0;this.time=0;this.geometry.setDrawRange(0,0);this.mesh.visible=false;}
 dispose(){this.mesh.removeFromParent();this.geometry.dispose();this.mesh.material.dispose();}
}
