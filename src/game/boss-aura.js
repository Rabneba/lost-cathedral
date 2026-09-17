import * as T from 'three';
import {EMBER_RAMP_GLSL,FIRE_NOISE_GLSL} from './weapon-fire.js';

const FLAME_VERTEX=`varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const FLAME_FRAGMENT=`
 uniform float uTime,uThreat,uSeed,uLife;
 varying vec2 vUv;
 ${FIRE_NOISE_GLSL}
 ${EMBER_RAMP_GLSL}
 void main(){
  float up=vUv.y, across=(vUv.x-.5)*2.;
  // A narrow lick, not a plume: it narrows fast as it rises.
  float width=mix(.80,.30,pow(max(up,0.),.55));
  float shape=1.-smoothstep(width*.22,width,abs(across));
  if(shape<=0.)discard;
  vec2 q=vec2(across*4.4+uSeed,up*5.6)-vec2(0.,uTime*(1.4+uThreat*2.1));
  float warp=ffbm(q*.8+vec2(uTime*.33,-uTime*.27));
  float n=ffbm(q+vec2(warp*1.5,0.));
  // A second, slower noise punches real holes through the sheet, so four
  // overlapping licks can never add up to one filled silhouette.
  float holes=smoothstep(.30,.60,ffbm(q*.42+vec2(-uTime*.55,uTime*.21)));
  float survive=smoothstep(.42+up*(.40-uThreat*.10),.86,n);
  // The fire starts ABOVE the brow: the bottom third of the quad is empty so
  // the hood aperture and the face keep reading as a hood.
  float rise=smoothstep(.05,.36,up);
  float mask=survive*holes*shape*rise*(1.-smoothstep(.46+uThreat*.40,1.02,up));
  if(mask<.006)discard;
  // Ember lives in the root only. Everywhere else this is a cold indigo flame:
  // pushing ember through the whole plume is what turned it magenta once bloom
  // got hold of it.
  float root=smoothstep(.40,.10,up)*(.30+uThreat*.34)*mask;
  vec3 body=vec3(.030,.010,.100)*(.55+n*.95);
  vec3 c=mix(body,emberRamp(clamp(.50+root*.26,.50,.78)),clamp(root*1.2,0.,.58));
  // Present at rest: the floor here is what makes the hood burn between attacks.
  gl_FragColor=vec4(c*(.20+uThreat*.14)*uLife,clamp(mask*(.28+uThreat*.12),0.,.40)*uLife);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
 }`;

// Additive fire alone can only brighten, so a dark flame needs something that
// actually takes light away. This layer is normal-blended near-black violet
// smoke torn by the same noise: it gives the plume a silhouette, and the
// additive licks above read as fire burning out of a shadow.
const SMOKE_FRAGMENT=`
 uniform float uTime,uThreat,uSeed,uLife;
 varying vec2 vUv;
 ${FIRE_NOISE_GLSL}
 void main(){
  float up=vUv.y, across=(vUv.x-.5)*2.;
  float width=mix(.62,.92,pow(max(up,0.),.8));
  float shape=1.-smoothstep(width*.26,width,abs(across));
  if(shape<=0.)discard;
  vec2 q=vec2(across*2.4+uSeed,up*2.8)-vec2(0.,uTime*(.55+uThreat*.85));
  float warp=ffbm(q*.7+vec2(uTime*.21,-uTime*.17));
  float n=ffbm(q+vec2(warp*1.5,0.));
  // Shredded into separate tongues at every height — a solid shadow the size of
  // the hood is what made the boss read as a rendering fault.
  float body=smoothstep(.34,.74,n+shape*.26)*shape;
  float holes=smoothstep(.28,.58,ffbm(q*.5+vec2(uTime*.3,0.)));
  float mask=body*holes*smoothstep(.04,.30,up)*(1.-smoothstep(.40+uThreat*.42,1.05,up));
  if(mask<.004)discard;
  vec3 c=mix(vec3(.004,.002,.009),vec3(.020,.010,.044),n);
  gl_FragColor=vec4(c,clamp(mask*(.30+uThreat*.16),0.,.34)*uLife);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
 }`;

const WISP_VERTEX=`attribute float aHeat; attribute float aSize; varying float vHeat;
 void main(){vHeat=aHeat;vec4 p=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*p;gl_PointSize=clamp(aSize*240./max(1.,-p.z),1.,30.);}`;
const WISP_FRAGMENT=`varying float vHeat; ${EMBER_RAMP_GLSL}
 void main(){float r=length(gl_PointCoord-.5)*2.;float a=pow(max(0.,1.-r),2.5);
  if(a<.008)discard;
  vec3 c=mix(vec3(.034,.014,.078),emberRamp(clamp(.44+vHeat*.28,.44,.74)),clamp(vHeat*1.3,0.,.78));
  gl_FragColor=vec4(c*(.14+vHeat*.30),a*clamp(.05+vHeat*.20,0.,1.));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
 }`;

/** Dark fire pouring out of the boss's hood.
 * An anchor parented to the head bone (exactly as the recessed mist is) carries
 * the animation; the flames themselves live in world space so they always rise
 * along world up and never shear when the head turns. At rest the plume is a
 * smoulder contained by the hood; a windup makes it lick out, and the phase-two
 * awakening erupts. Wisps of the same fire drift down over the shoulders. */
export function createBossAura(head,scene,{scale=1,wisps=64}={}){
 if(!head||!scene)return null;
 // Head-bone frame is the rig's authored centimetres, as in head-effect.js.
 const anchor=new T.Object3D();anchor.position.set(-.2,-6.5,16.5);anchor.userData.cosmetic=true;head.add(anchor);
 const forwardAnchor=new T.Object3D();forwardAnchor.position.set(-.2,-3.5,45);forwardAnchor.userData.cosmetic=true;head.add(forwardAnchor);

 const group=new T.Group();group.name='Hood dark fire';group.userData.cosmetic=true;
 // Deliberately NOT flagged noPuddleReflection: a two-metre flame standing over
 // the wet flagstones has to appear in them. A yaw billboard is correct in a
 // floor mirror, because mirroring in Y leaves x and z — and so the yaw — alone.
 scene.add(group);
 const plumes=[];
 for(let i=0;i<4;i++){
  const uniforms={uTime:{value:0},uThreat:{value:0},uSeed:{value:i*5.77},uLife:{value:1}};
  const mesh=new T.Mesh(new T.PlaneGeometry(1,1,1,1),new T.ShaderMaterial({uniforms,transparent:true,depthWrite:false,side:T.DoubleSide,blending:T.AdditiveBlending,vertexShader:FLAME_VERTEX,fragmentShader:FLAME_FRAGMENT}));
  mesh.frustumCulled=false;mesh.renderOrder=8;
  mesh.userData.cosmetic=true;
  mesh.geometry.translate(0,.5,0); // grow upward from the hood mouth
  group.add(mesh);
  plumes.push({mesh,uniforms,yaw:(i-1.5)*1.18,lean:(i%2?1:-1)*.06,side:(i-1.5)*.052*scale,tall:1+((i*7)%3-1)*.22,width:(.155-Math.abs(i-1.5)*.028)*scale});
 }

 const smokes=[];
 for(let i=0;i<2;i++){
  const uniforms={uTime:{value:0},uThreat:{value:0},uSeed:{value:i*8.13+2.4},uLife:{value:1}};
  const mesh=new T.Mesh(new T.PlaneGeometry(1,1,1,1),new T.ShaderMaterial({uniforms,transparent:true,depthWrite:false,side:T.DoubleSide,blending:T.NormalBlending,vertexShader:FLAME_VERTEX,fragmentShader:SMOKE_FRAGMENT}));
  mesh.frustumCulled=false;mesh.renderOrder=7; // under the additive licks
  mesh.userData.cosmetic=true;
  mesh.geometry.translate(0,.5,0);
  group.add(mesh);
  smokes.push({mesh,uniforms,yaw:(i-.5)*1.35,lean:(i%2?1:-1)*.05,width:(.22-Math.abs(i-.5)*.05)*scale});
 }

 const geometry=new T.BufferGeometry();
 geometry.setAttribute('position',new T.Float32BufferAttribute(new Float32Array(wisps*3),3));
 geometry.setAttribute('aHeat',new T.Float32BufferAttribute(new Float32Array(wisps),1));
 geometry.setAttribute('aSize',new T.Float32BufferAttribute(new Float32Array(wisps),1));
 geometry.setDrawRange(0,0);
 const points=new T.Points(geometry,new T.ShaderMaterial({transparent:true,depthWrite:false,blending:T.AdditiveBlending,vertexShader:WISP_VERTEX,fragmentShader:WISP_FRAGMENT}));
 points.frustumCulled=false;points.renderOrder=8;points.name='Hood wisps';
 points.userData.cosmetic=true;points.userData.noPuddleReflection=true;scene.add(points);

 const light=new T.PointLight(0x8a3ad6,0,3.2*scale,2);light.userData.cosmetic=true;scene.add(light);

 const pool=[];const world=new T.Vector3(),top=new T.Vector3(),cameraPosition=new T.Vector3();
 let accumulator=0;const state={threat:0};

 return{
  group,points,light,plumes,smokes,anchor,state,
  /** `flare` is a short additive kick to the aura light (the burst eruption). */
  update(dt,time,{threat=0,camera,life=1,flare=0}={}){
   const step=Math.max(0,Math.min(dt,.1));
   state.threat=step>0?T.MathUtils.damp(state.threat,threat,threat>state.threat?9:3.5,step):threat;
   const t=state.threat;
   anchor.updateWorldMatrix(true,false);forwardAnchor.updateWorldMatrix(true,false);
   world.setFromMatrixPosition(anchor.matrixWorld);
   top.setFromMatrixPosition(forwardAnchor.matrixWorld);
   // The licks leave the TOP of the hood. Anchored at the hood mouth they
   // painted straight over the aperture and the face.
   group.position.set(world.x,world.y+.17*scale,world.z);
   // A slight lean toward where the head looks keeps the plume inside the hood.
   const outward=top.clone().sub(world).setY(0);
   const yawToCamera=camera?Math.atan2(camera.position.x-world.x,camera.position.z-world.z):0;
   // A resting plume is a real lick, not a stub: .20 m + the threat's share.
   const height=(.26+t*.58)*scale,width=(.84+t*.60);
   for(const plume of plumes){
    plume.uniforms.uTime.value=time;
    plume.uniforms.uThreat.value=t;
    plume.uniforms.uLife.value=life;
    plume.mesh.scale.set(plume.width*width,height*plume.tall*(1+plume.lean*4),1);
    plume.mesh.position.set(outward.x*plume.lean+Math.cos(yawToCamera)*plume.side,-.02*scale,outward.z*plume.lean-Math.sin(yawToCamera)*plume.side);
    plume.mesh.rotation.set(0,yawToCamera+plume.yaw*(1-t*.5),0);
   }
   // The shadow body sits a touch lower and wider than the licks it carries.
   for(const smoke of smokes){
    smoke.uniforms.uTime.value=time;
    smoke.uniforms.uThreat.value=t;
    smoke.uniforms.uLife.value=life;
    smoke.mesh.scale.set(smoke.width*width,height*(.74+t*.26),1);
    smoke.mesh.position.set(outward.x*smoke.lean,-.05*scale,outward.z*smoke.lean);
    smoke.mesh.rotation.set(0,yawToCamera+smoke.yaw*(1-t*.5),0);
   }
   // Wisps: cold fire that spills out and sinks across the shoulders.
   accumulator+=step*(5+t*t*95);
   while(accumulator>=1&&pool.length<wisps){
    accumulator-=1;
    const angle=Math.random()*Math.PI*2,radius=(.05+Math.random()*.16)*scale;
    pool.push({
     p:new T.Vector3(world.x+Math.cos(angle)*radius,world.y+(Math.random()-.2)*.12*scale,world.z+Math.sin(angle)*radius),
     v:new T.Vector3(Math.cos(angle)*(.14+t*.16),(Math.random()<.55?.40:-.26)*(.5+t),Math.sin(angle)*(.14+t*.16)).multiplyScalar(scale),
     life:.9+Math.random()*1.3,total:1,size:(.10+Math.random()*.17)*scale,heat:.16+Math.random()*.58});
    pool.at(-1).total=pool.at(-1).life;
   }
   if(accumulator>4)accumulator=4;
   const position=geometry.attributes.position,aHeat=geometry.attributes.aHeat,aSize=geometry.attributes.aSize;
   let n=0,write=0;
   for(let i=0;i<pool.length;i++){
    const particle=pool[i];
    particle.life-=step;
    if(particle.life<=0)continue;
    particle.v.y-=step*.22*scale;particle.v.multiplyScalar(Math.exp(-step*1.1));
    particle.p.addScaledVector(particle.v,step);
    const age=1-particle.life/particle.total;
    position.setXYZ(n,particle.p.x,particle.p.y,particle.p.z);
    aHeat.setX(n,particle.heat*(1-age)*(.45+t*1.0)*life);
    aSize.setX(n,particle.size*(1+age*1.5));
    n++;pool[write++]=particle;
   }
   pool.length=write;
   position.needsUpdate=aHeat.needsUpdate=aSize.needsUpdate=true;
   geometry.setDrawRange(0,n);
   light.position.copy(world);
   // At rest the light touches the hood and the pauldrons; a flare is the burst.
   light.intensity=((.15+t*.12+t*t*.20)+flare*1.4)*life;
   // Blue-violet at every threat. The old ramp ended at (.88,.22,.20), which is
   // red — it was washing the boss's whole chest plate pink.
   light.color.setRGB(.22+t*.10,.08+t*.04,.58+t*.12);
   return state;
  },
  reset(){pool.length=0;state.threat=0;accumulator=0;geometry.setDrawRange(0,0);light.intensity=0;for(const plume of plumes)plume.uniforms.uThreat.value=0;for(const smoke of smokes)smoke.uniforms.uThreat.value=0;},
  dispose(){
   group.removeFromParent();points.removeFromParent();light.removeFromParent();
   anchor.removeFromParent();forwardAnchor.removeFromParent();
   for(const item of [...plumes,...smokes]){item.mesh.geometry.dispose();item.mesh.material.dispose();}
   geometry.dispose();points.material.dispose();
  }
 };
}
