import * as T from 'three';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {SMAAPass} from 'three/addons/postprocessing/SMAAPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {ShaderPass} from 'three/addons/postprocessing/ShaderPass.js';
import {GTAOPass} from 'three/addons/postprocessing/GTAOPass.js';
import {Pass,FullScreenQuad} from 'three/addons/postprocessing/Pass.js';
import {createPuddles} from './puddles.js';
import {pixelRatioFor} from './device.js';

// AgX keeps a candle flame orange instead of bleaching it to cream the way ACES
// does, but it is a darker curve. The gain is absorbed here so main.js's
// brightness slider (0.7 - 1.7, default 1.12) keeps its familiar range.
//
// Round 1 fix pass: 1.40 -> 2.05. Restoring the black point (see the grade
// below) and cutting the floor pools moved the whole frame down - the first fix
// capture measured mean 16.7 with 45.9 % of pixels under level 12 and p95 42,
// i.e. dark but unreadable, the opposite error. The right knob is EXPOSURE, not
// the shadow lift: with the lift gone, a scene luminance of zero stays at
// output level 5 whatever the exposure, so this raises the mids and the
// speculars without touching the blacks. Modelled per scene value against
// three's own AgX: mid stone lands back at 84 (shipped build: 80) and lit stone
// at 122 (shipped: 118), with true black at 6 instead of 17. Measured over the
// fight camera at 2.05 the frame came back mean 26.7 / 21.3 % black / p95 59
// against the shipped 34.9 / 2.2 % / 62 and the user's reference 33.5 / 20.3 %
// / 88 - so 2.25 is the last small step toward the reference's mid level with
// the black point kept.
// Bloom is unaffected - it runs on the linear buffer before OutputPass applies
// tone mapping - and main.js's brightness slider keeps its 0.7-1.7 range.
// Round 2 fix pass: 2.25 -> 2.55. Two things below this line changed the frame
// without the exposure moving. (a) Closing the vault and building the clerestory
// wall (arena.js) took away the broad sky ambient that used to fall on the whole
// nave through the open roof. (b) The grain that used to be added to the LINEAR
// value before AgX was symmetric in linear but NOT in output: AgX is convex in
// log, so the positive excursions lifted the frame more than the negative ones
// darkened it, and removing it cost several levels of mean. Measured on the
// entrance-to-altar wide at 2.25: mean 29.2 against the shipped build's 33.8 and
// the user's reference at 33.8. The black point is untouched - with the shadow
// lift gone a scene luminance of zero stays at output level 6 whatever this is.
const AGX_GAIN=2.55;

const QUAD_VERTEX='varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}';

// The moon's bearing, shared by the light, the sky shader, the shafts, the
// floor projections and the fog, so they can never drift apart.
export const MOON_BEARING=new T.Vector3(-8,17,-8).normalize();

// ---------------------------------------------------------------------------
// HEIGHT FOG. FogExp2 fogs a vault rib at y = 17 exactly as hard as the
// flagstone at y = 0, so the room had no vertical structure and no atmospheric
// perspective: the far apse sat at the same value as the near floor. Both
// references get their depth from dense low haze under clean air, and a milky,
// slightly warmer far end.
//
// This patches the four global fog ShaderChunks ONCE, at module scope, before
// any material in the game compiles (rendering.js is imported before arena.js
// and actors.js). It therefore affects EVERY built-in material in the game,
// including the actors' GLBs and the other streams' effects. If an effect goes
// grey with distance that is this patch working correctly, and the fix is
// `fog:false` on that material, not a revert. ShaderMaterial defaults to
// fog:false, so nothing hand-written is touched.
//
// scene.fog must stay a non-null Fog instance or three strips the chunks
// entirely and this silently does nothing.
T.ShaderChunk.fog_pars_vertex=`
#ifdef USE_FOG
 varying float vFogDepth;
 varying vec3 vFogWorld;
#endif`;
T.ShaderChunk.fog_vertex=`
#ifdef USE_FOG
 vFogDepth = - mvPosition.z;
 vFogWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
#endif`;
T.ShaderChunk.fog_pars_fragment=`
#ifdef USE_FOG
 uniform vec3 fogColor;
 varying float vFogDepth;
 varying vec3 vFogWorld;
 #ifdef FOG_EXP2
  uniform float fogDensity;
 #else
  uniform float fogNear;
  uniform float fogFar;
 #endif
#endif`;
T.ShaderChunk.fog_fragment=`
#ifdef USE_FOG
 vec3 fogRay = vFogWorld - cameraPosition;
 float fogDist = length( fogRay );
 fogRay /= max( fogDist, 1e-4 );
 // Analytic integral of an exponential height distribution along the ray.
 float fogRy = fogRay.y;
 float fogDen = ( fogRy >= 0.0 ? 1.0 : -1.0 ) * max( abs( fogRy ), 1e-3 );
 #ifdef FOG_EXP2
  float fogScale = fogDensity * 4.0;
 #else
  float fogScale = 0.17;
 #endif
 float fogAmount = fogScale * exp( - ( cameraPosition.y - 0.6 ) / 7.0 )
  * ( 1.0 - exp( - fogDist * fogDen / 7.0 ) ) / fogDen;
 float fogFactor = clamp( 1.0 - exp( - max( fogAmount, 0.0 ) ), 0.0, 1.0 );
 // Cold slate away from the moon, a warmer lift along its bearing, so the far
 // end of the nave separates from the aisles instead of going uniformly grey.
 // LINEAR values, not sRGB: #0a1219 and #2c4150 converted. Writing the sRGB
 // triplets straight in here made the fog eight times too bright and turned the
 // whole cathedral into pale daylight mist.
 vec3 fogTint = mix( vec3( 0.0033, 0.0068, 0.0107 ), vec3( 0.0265, 0.0529, 0.0802 ),
  pow( max( dot( fogRay, vec3( -0.3766, 0.8003, -0.3766 ) ), 0.0 ), 4.0 ) );
 gl_FragColor.rgb = mix( gl_FragColor.rgb, fogTint, fogFactor );
#endif`;

// A cathedral needs a sky to reflect. RoomEnvironment is a white photographic
// studio box, which is why every piece of brass read as polished chrome and the
// wet floor reflected nothing. This is a night sky: cold slate overhead, black
// at the horizon, two warm candle-coloured lobes and one cold moon lobe.
// Optimization pass (16 Sep): the room carries 25 lights and three runs the full
// BRDF for every one of them at every lit pixel, in the main pass and again in
// the puddle mirror. getPointLightInfo/getSpotLightInfo already mark a light
// invisible when its colour is exactly zero - past its cutoff distance, outside
// its cone, or a pooled candle/flash light parked at intensity 0 - and every
// term RE_Direct adds is scaled by that colour, so skipping the call changes no
// pixel. It only stops the GPU from shading lights that contribute nothing.
const RE_DIRECT_CALL='RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';
if(!T.ShaderChunk.lights_fragment_begin.includes(RE_DIRECT_CALL))throw new Error('three lights_fragment_begin changed: re-check the light-skip patch');
T.ShaderChunk.lights_fragment_begin=T.ShaderChunk.lights_fragment_begin.split(RE_DIRECT_CALL).join('if ( directLight.visible ) { '+RE_DIRECT_CALL+' }');

// Graphics pass (16 Sep, evening): every built-in material's OUTPUT is capped at 32 in linear HDR. The bloom
// already clamps at 14, so in the main pass nothing over 14 was ever distinguishable; this only matters for
// the puddle mirror, whose half-float target the exile's sword overflowed to +Inf - its own fire light sits on
// the blade, so 1/d^2 times a low-roughness GGX spike - and whose mipmaps then spread that into blocks. A
// finite 32 reflects as a bright speck; Inf reflected as NaN (black blocks) or as clipped white squares.
if(!T.ShaderChunk.opaque_fragment.includes('gl_FragColor = vec4( outgoingLight, diffuseColor.a );'))throw new Error('three opaque_fragment changed: re-check the HDR clamp');
T.ShaderChunk.opaque_fragment=T.ShaderChunk.opaque_fragment.replace('gl_FragColor = vec4( outgoingLight, diffuseColor.a );','gl_FragColor = vec4( min( outgoingLight, vec3( 32.0 ) ), diffuseColor.a );');

function nightEnvironment(){
 const canvas=document.createElement('canvas');canvas.width=256;canvas.height=128;
 const ctx=canvas.getContext('2d');
 const sky=ctx.createLinearGradient(0,0,0,128);
 sky.addColorStop(0,'#2b3a46');sky.addColorStop(.42,'#131c24');sky.addColorStop(.58,'#06080a');sky.addColorStop(1,'#000000');
 ctx.fillStyle=sky;ctx.fillRect(0,0,256,128);
 const blob=(u,v,r,color)=>{const g=ctx.createRadialGradient(u,v,0,u,v,r);g.addColorStop(0,color);g.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=g;ctx.fillRect(0,0,256,128);};
 blob(56,79,54,'rgba(255,150,70,.5)');
 blob(198,79,46,'rgba(255,138,62,.42)');
 blob(132,32,62,'rgba(176,208,232,.55)');
 const texture=new T.CanvasTexture(canvas);
 texture.mapping=T.EquirectangularReflectionMapping;
 texture.colorSpace=T.SRGBColorSpace;
 return texture;
}

// Replaces UnrealBloomPass. The stock pass renders a pure black frame on this
// build (verified by bisecting the composer: RenderPass/GTAO/grade/SMAA all
// produce a lit frame, adding UnrealBloomPass produces mean luminance 0), which
// left the whole game black at high and balanced quality. This does the same
// job - soft-knee bright pass, five separable-blur mips, weighted composite -
// and adds the scene back in one shader so the pass swaps buffers normally.
class CathedralBloom extends Pass{
 constructor(strength=.45,radius=.72,threshold=.85){
  super();
  this.strength=strength;this.radius=radius;this.threshold=threshold;this.knee=.50;
  this.levels=6;this.needsSwap=true;
  const options={type:T.HalfFloatType,depthBuffer:false,stencilBuffer:false};
  this.bright=new T.WebGLRenderTarget(1,1,options);
  this.horizontal=[];this.vertical=[];
  for(let i=0;i<this.levels;i++){this.horizontal.push(new T.WebGLRenderTarget(1,1,options));this.vertical.push(new T.WebGLRenderTarget(1,1,options));}
  const flat={depthTest:false,depthWrite:false};
  this.brightMaterial=new T.ShaderMaterial({
   ...flat,
   uniforms:{tDiffuse:{value:null},threshold:{value:threshold},knee:{value:this.knee}},
   vertexShader:QUAD_VERTEX,
   fragmentShader:`uniform sampler2D tDiffuse;uniform float threshold,knee;varying vec2 vUv;
    void main(){vec3 c=texture2D(tDiffuse,vUv).rgb;
     // A single NaN or Inf pixel anywhere in the HDR buffer - one bad particle,
     // one divide by zero in an effect shader - spreads through the blur mips
     // into screen-sized black blocks, which is exactly how the stock
     // UnrealBloomPass was blacking out the whole frame. max() against NaN is
     // implementation-defined (on Metal it kept the NaN, which is how the
     // puddle NaN of 16 Sep still got through), so NaN is tested explicitly;
     // min() caps Inf.
     c=mix(c,vec3(0.),vec3(isnan(c)));c=min(max(c,vec3(0.)),vec3(14.));
     float l=max(max(c.r,c.g),c.b);
     float soft=clamp(l-threshold+knee,0.,2.*knee);soft=soft*soft/(4.*knee+1e-5);
     float contribution=max(soft,l-threshold)/max(l,1e-5);
     gl_FragColor=vec4(c*contribution,1.);}`});
  this.blurMaterial=new T.ShaderMaterial({
   ...flat,
   uniforms:{tDiffuse:{value:null},direction:{value:new T.Vector2()}},
   vertexShader:QUAD_VERTEX,
   fragmentShader:`uniform sampler2D tDiffuse;uniform vec2 direction;varying vec2 vUv;
    void main(){vec3 c=texture2D(tDiffuse,vUv).rgb*.2270270270;
     c+=texture2D(tDiffuse,vUv+direction*1.3846153846).rgb*.3162162162;
     c+=texture2D(tDiffuse,vUv-direction*1.3846153846).rgb*.3162162162;
     c+=texture2D(tDiffuse,vUv+direction*3.2307692308).rgb*.0702702703;
     c+=texture2D(tDiffuse,vUv-direction*3.2307692308).rgb*.0702702703;
     gl_FragColor=vec4(c,1.);}`});
  this.compositeMaterial=new T.ShaderMaterial({
   ...flat,
   uniforms:{tDiffuse:{value:null},tBloom0:{value:null},tBloom1:{value:null},tBloom2:{value:null},tBloom3:{value:null},tBloom4:{value:null},tBloom5:{value:null},strength:{value:strength},radius:{value:radius}},
   vertexShader:QUAD_VERTEX,
   fragmentShader:`uniform sampler2D tDiffuse,tBloom0,tBloom1,tBloom2,tBloom3,tBloom4,tBloom5;uniform float strength,radius;varying vec2 vUv;
    float weight(float f){return mix(f,1.2-f,radius);}
    void main(){vec3 base=texture2D(tDiffuse,vUv).rgb;base=mix(base,vec3(0.),vec3(isnan(base)));base=min(max(base,vec3(0.)),vec3(14.));
     vec3 glow=weight(1.)*texture2D(tBloom0,vUv).rgb
      +weight(.83)*texture2D(tBloom1,vUv).rgb
      +weight(.66)*texture2D(tBloom2,vUv).rgb
      +weight(.5)*texture2D(tBloom3,vUv).rgb
      +weight(.33)*texture2D(tBloom4,vUv).rgb
      +weight(.17)*texture2D(tBloom5,vUv).rgb;
     gl_FragColor=vec4(base+glow*strength,1.);}`});
  this._quad=new FullScreenQuad(this.brightMaterial);
 }
 setSize(width,height){
  let w=Math.max(1,Math.round(width/2)),h=Math.max(1,Math.round(height/2));
  this.bright.setSize(w,h);
  for(let i=0;i<this.levels;i++){
   this.horizontal[i].setSize(w,h);this.vertical[i].setSize(w,h);
   w=Math.max(1,Math.round(w/2));h=Math.max(1,Math.round(h/2));
  }
 }
 render(renderer,writeBuffer,readBuffer){
  this.brightMaterial.uniforms.tDiffuse.value=readBuffer.texture;
  this.brightMaterial.uniforms.threshold.value=this.threshold;
  this.brightMaterial.uniforms.knee.value=this.knee;
  this._quad.material=this.brightMaterial;
  renderer.setRenderTarget(this.bright);this._quad.render(renderer);
  let source=this.bright;
  this._quad.material=this.blurMaterial;
  for(let i=0;i<this.levels;i++){
   const target=this.horizontal[i],texel=this.blurMaterial.uniforms.direction.value;
   this.blurMaterial.uniforms.tDiffuse.value=source.texture;
   texel.set(1/target.width,0);
   renderer.setRenderTarget(target);this._quad.render(renderer);
   this.blurMaterial.uniforms.tDiffuse.value=target.texture;
   texel.set(0,1/this.vertical[i].height);
   renderer.setRenderTarget(this.vertical[i]);this._quad.render(renderer);
   source=this.vertical[i];
  }
  const uniforms=this.compositeMaterial.uniforms;
  uniforms.tDiffuse.value=readBuffer.texture;
  for(let i=0;i<this.levels;i++)uniforms['tBloom'+i].value=this.vertical[i].texture;
  uniforms.strength.value=this.strength;uniforms.radius.value=this.radius;
  this._quad.material=this.compositeMaterial;
  renderer.setRenderTarget(this.renderToScreen?null:writeBuffer);
  this._quad.render(renderer);
 }
 dispose(){
  this.bright.dispose();
  for(let i=0;i<this.levels;i++){this.horizontal[i].dispose();this.vertical[i].dispose();}
  this.brightMaterial.dispose();this.blurMaterial.dispose();this.compositeMaterial.dispose();this._quad.dispose();
 }
}

export function createRendering(canvas,{touch=false}={}) {
 // 1.15 retains supersampling with 4x MSAA + SMAA and leaves more headroom
 // for active combat than the previous 1.25 scale. Contact AO remains enabled.
 const renderer=new T.WebGLRenderer({canvas,antialias:false,powerPreference:'high-performance'});
 renderer.setPixelRatio(Math.min(devicePixelRatio,1.15));
 renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;
 renderer.toneMapping=T.AgXToneMapping;
 let brightness=1.12;
 Object.defineProperty(renderer,'toneMappingExposure',{configurable:true,get:()=>brightness*AGX_GAIN,set(value){brightness=value;}});
 const scene=new T.Scene();scene.background=new T.Color(0x070a0d);scene.fog=new T.FogExp2(0x0a1016,.028);
 const pmrem=new T.PMREMGenerator(renderer);const sky=nightEnvironment();
 const env=pmrem.fromEquirectangular(sky);scene.environment=env.texture;scene.environmentIntensity=.30;sky.dispose();pmrem.dispose();
 const puddles=createPuddles(scene);
 const camera=new T.PerspectiveCamera(52,1,.08,170);camera.position.set(0,3.5,14);
 const target=new T.WebGLRenderTarget(1,1,{type:T.HalfFloatType,samples:4});
 const composer=new EffectComposer(renderer,target);composer.addPass(new RenderPass(scene,camera));
 // Half-resolution contact occlusion anchors armor, feet and masonry crevices.
 // Transparent atmosphere never writes its billboard shape into the AO buffer.
 const ao=new GTAOPass(scene,camera,1,1);
 // Round 3 (graphics pass): radius .42 -> .50 and blend .72 -> .78 - the user's word was "flat"; a wider,
 // stronger contact term is what grounds the armour seams, the plinths and the rubble against the stone.
 ao.updateGtaoMaterial({radius:.50,thickness:.55,distanceExponent:1.0,samples:16,scale:1.0});
 // depthPhi 4 stops the denoiser bleeding floor occlusion across the actors'
 // silhouettes, which was eating pixels off the boss's outline.
 ao.updatePdMaterial({radius:4,samples:8,depthPhi:4,normalPhi:4.5});ao.blendIntensity=.78;
 const aoSize=ao.setSize.bind(ao);ao.setSize=(w,h)=>aoSize(Math.max(1,Math.round(w*.5)),Math.max(1,Math.round(h*.5)));
 ao._overrideVisibility=function(){scene.traverse(object=>{const materials=Array.isArray(object.material)?object.material:[object.material];if(object.visible&&(object.isPoints||object.isLine||object.isSprite||materials.some(m=>m?.transparent))){object.visible=false;this._visibilityCache.push(object);}});};
 const aoRender=ao.render.bind(ao);ao.render=(renderer,...args)=>{const update=renderer.shadowMap.autoUpdate;renderer.shadowMap.autoUpdate=false;try{aoRender(renderer,...args);}finally{renderer.shadowMap.autoUpdate=update;}};
 composer.addPass(ao);
 // 17 Sep: strength .55 -> .68 and threshold .62 -> .56 (user: "is bloom definitely enabled? maybe a little more").
 const bloom=new CathedralBloom(.68,.82,.56);composer.addPass(bloom);
 // Split-tone grade on linear HDR, before OutputPass. Shadows are lifted toward
 // cold slate and highlights pulled toward candle amber, which is the contrast
 // the Dark Souls references are built on; the filmic S-curve deepens the blacks
 // without crushing the boss silhouette out of the frame.
 // Round 3 (graphics pass) adds three lens terms to the same pass, all in linear HDR before AgX:
 //  - a radial chromatic aberration (.30: a lens, never a glitch - three taps instead of one);
 //  - the impact shock, one ring of refraction racing out from a slam, a burst, the fissure or the exile's
 //    heavy (uShock: centre in uv, radius in uv, strength), fed by post.shock() below;
 //  - the impact flash (uFlash: rgb, strength), a brief warm lift of the mids, never a white frame.
 const grade=new ShaderPass({uniforms:{tDiffuse:{value:null},time:{value:0},uAberration:{value:.30},uAspect:{value:1},uShock:{value:new T.Vector4(.5,.5,0,0)},uFlash:{value:new T.Vector4(1,.75,.5,0)}},vertexShader:QUAD_VERTEX,
  fragmentShader:`uniform sampler2D tDiffuse;uniform float time,uAberration,uAspect;uniform vec4 uShock,uFlash;varying vec2 vUv;
  // A sin()-based hash of gl_FragCoord breaks down past about 1000 px: the
  // argument loses mantissa bits and the "noise" becomes a coherent diagonal
  // moire across the whole frame. This one never calls sin().
  float gradeHash(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
  void main(){
   vec2 uv=vUv;vec2 centered=uv-.5;float r2=dot(centered,centered);
   // 17 Sep: the ring's falloff was exp(-pow(k,2.)) with k NEGATIVE inside the ring. GLSL leaves pow() undefined for
   // a negative base and this GPU (ANGLE Metal, Apple M2 Max) returns NaN there, so the whole inside of the
   // expanding ring sampled the buffer at a NaN coordinate: one flat texel painted as a hard-edged disc that grew
   // with the ring (the user's "black or brown circle" on every slam, burst, fissure and heavy hit; measured at
   // 5.65 % of the frame = the disc's area, 0 % once squared; docs/graphics-2026-09-17/probes/shock-nanmark.js).
   // A square has no undefined domain, and the coordinate is fenced anyway.
   if(uShock.w>.001){vec2 d=(uv-uShock.xy)*vec2(uAspect,1.);float r=length(d);float k=(r-uShock.z)*7.;float wave=exp(-k*k)*uShock.w;uv+=(d/max(r,1e-4))*wave*.014*vec2(1./uAspect,1.);}
   if(any(isnan(uv))||any(isinf(uv)))uv=vUv;
   vec2 ab=centered*r2*uAberration*.02;
   vec3 c=vec3(texture2D(tDiffuse,uv+ab).r,texture2D(tDiffuse,uv).g,texture2D(tDiffuse,uv-ab).b);
   c=mix(c,vec3(0.),vec3(isnan(c)));c=min(c,vec3(64.));
   float luma=dot(c,vec3(.2126,.7152,.0722));
   // Three-way: cold slate into the shadows, candle amber into the gain.
   //
   // Round 1 review measured the shipped build against the user's own
   // reference: 2.2 % of the frame below level 12 where the reference has
   // 19.7 % and the session's own starting point had 42 %. The frame had no
   // black point left - it was murky, not dark, which the brief rules out.
   // This lift was most of it: at scene luminance 0 it alone put the darkest
   // pixel in the game at level 19 AFTER AgX (modelled numerically against
   // three's AgXToneMapping, not guessed). A third of it lands true black at
   // level 3 and costs nothing above level 50, and the shoulder is pulled in
   // to .16 so it only ever touches real shadow.
   // Round 3: the lift at black is trimmed a tenth - the user asked for gloom, and true black is what the
   // candle pools and the fire read against. The exposure is untouched. (A fifth, with the S-curve at .50,
   // measured 39 % of the fight frame under level 12 against 22 % before: dark but unreadable.)
   // 17 Sep: the lift a fifth up (.0018/.0033/.0043 -> .0022/.0040/.0052) and the S-curve .47 -> .45 - the user asked
   // for the side walls to be "slightly more visible, just a tiny bit"; the hemisphere fill alone (.16 -> .24) moved
   // the walls by 6-8 %, which is under what a person can see.
   c+=vec3(.0022,.0040,.0052)*(1.-smoothstep(0.,.16,luma));
   c*=mix(vec3(1.),vec3(1.0,.824,.627),smoothstep(.28,1.4,luma)*.42);
   // The S-curve used to run on the whole LINEAR HDR value, so a candle flame
   // at 6.0 was pulled to 4.25 and 35 percent of every highlight was eaten
   // before AgX ever saw it. Shape only the 0-1 domain and add the rest back.
   vec3 low=min(c,vec3(1.));vec3 high=max(c-vec3(1.),vec3(0.));
   // .35 -> .40: the other half of the contrast collapse. The frame lived in a
   // narrow mid band (p95 62 against the reference's 88) - deep shadow and real
   // speculars both existed in the scene, the curve just was not separating
   // them. This steepens only the 0-1 domain, so the flame cores above 1.0 are
   // still handed to AgX untouched. (.46 in the first fix capture, pulled back
   // to .40 once the exposure above did the separating work.)
   // .40 -> .44 with the exposure above: the separation the frame lost when the
   // grain stopped manufacturing both tails (see AGX_GAIN).
   // .44 -> .47 (round 3): a steeper mid separation with the shadow lift trimmed above; the flame cores
   // above 1.0 are still handed to AgX untouched.
   low=mix(low,low*low*(3.-2.*low),.45);
   c=low+high;
   // Real film desaturates as it clips; a white-hot flame core should not stay
   // a saturated orange blob once bloom has spread it.
   float maxc=max(max(c.r,c.g),c.b);
   c=mix(c,vec3(maxc),smoothstep(1.2,4.0,luma)*.6);
   c=mix(vec3(dot(c,vec3(.2126,.7152,.0722))),c,1.12);
   float edge=smoothstep(.30,.86,length((vUv-.5)*vec2(1.,.82)));
   c*=1.-edge*.42;
   // The flash is a warm GAIN, not a lift: an additive term in linear HDR before AgX turned the whole frame
   // beige (the first capture), because AgX maps a linear .05 to a mid grey.
   c*=1.+uFlash.rgb*uFlash.w*1.6;
   // Round 2 review, major: the shadow-weighted grain used to be added HERE, to
   // the linear HDR value, immediately before AgX. AgX is a log encoding, so a
   // fixed linear offset in near-black is amplified enormously - and the
   // weighting deliberately put the grain exactly where it is amplified most.
   // Raising the exposure 1.40 -> 2.25 in round 1 without rescaling it made the
   // dark two thirds of the frame crawl like video static: measured
   // high-frequency std in three flat regions went 4.89/6.24/3.97 to
   // 8.12/9.43/8.70 while the region means went DOWN. The grain now lives in
   // the dither pass, after OutputPass and after SMAA, where one unit is one
   // output level whatever the exposure does. Nothing else in the grade moved.
   gl_FragColor=vec4(max(c,0.),1.);
  }`});
 composer.addPass(grade);
 composer.addPass(new OutputPass());
 // SMAA after OutputPass: edge detection on tone-mapped LDR finds the edges a
 // very dark linear-HDR buffer hides completely.
 const aa=new SMAAPass();composer.addPass(aa);
 // Ordered dither last, after SMAA, so the 8-bit canvas does not band across
 // the large smooth wall and fog gradients and SMAA cannot smooth it away.
 const dither=new ShaderPass({uniforms:{tDiffuse:{value:null},time:{value:0}},vertexShader:QUAD_VERTEX,
  fragmentShader:`uniform sampler2D tDiffuse;uniform float time;varying vec2 vUv;
  float grainHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
  float bayer4(vec2 p){vec2 q=floor(mod(p,4.));
   float i=q.x+q.y*4.;
   float m[16];m[0]=0.;m[1]=8.;m[2]=2.;m[3]=10.;m[4]=12.;m[5]=4.;m[6]=14.;m[7]=6.;
   m[8]=3.;m[9]=11.;m[10]=1.;m[11]=9.;m[12]=15.;m[13]=7.;m[14]=13.;m[15]=5.;
   float v=0.;for(int k=0;k<16;k++){if(float(k)==i)v=m[k];}
   return v/16.;}
  void main(){vec3 c=texture2D(tDiffuse,vUv).rgb;
   // Shadow-weighted film grain, in DISPLAY space. The dark two thirds of a
   // Dark Souls frame are never mathematically clean, and it hides 8-bit
   // banding in the vignette - but it has to be an output-level offset, not a
   // linear-HDR one (see the grade). +-2.5 levels at black, gone by mid grey:
   // measured high-frequency std in three flat dark patches of the fight camera
   // comes back to 1.9-2.6 against the 8.1-9.4 the round 2 review measured.
   float grainLuma=dot(c,vec3(.2126,.7152,.0722));
   float grain=(grainHash(gl_FragCoord.xy+vec2(fract(time*.37)*512.,fract(time*.61)*512.))-.5)*(5.0/255.);
   c+=grain*(1.-smoothstep(0.,.42,grainLuma));
   gl_FragColor=vec4(c+(bayer4(gl_FragCoord.xy)-.5)/255.,1.);}`});
 composer.addPass(dither);
 // Touch (17 Sep 2026, the mobile pass): on a phone or a tablet the pixel ratio comes from a pixel budget per preset
 // instead of the desktop caps (device.js pixelRatioFor) and is recomputed on every resize (a rotation changes the
 // viewport); contact AO is never on, the puddle mirror only at High (at the Balanced size), the dither only at High.
 // On the desktop every number below is exactly what shipped.
 let currentMode='high';
 const ratioFor=mode=>pixelRatioFor({mode,touch,dpr:devicePixelRatio,width:innerWidth,height:innerHeight});
 function resize(){const w=innerWidth,h=innerHeight;if(touch){const ratio=ratioFor(currentMode);renderer.setPixelRatio(ratio);composer.setPixelRatio(ratio);}renderer.setSize(w,h,false);composer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();grade.uniforms.uAspect.value=w/h;}
 addEventListener('resize',resize);resize();
 function quality(mode){currentMode=mode;puddles.quality(touch?(mode==='high'?'balanced':'low'):mode);const ratio=ratioFor(mode);renderer.setPixelRatio(ratio);composer.setPixelRatio(ratio);bloom.enabled=mode!=='low';ao.enabled=mode==='high'&&!touch;aa.enabled=touch?mode!=='low':true;/* Performance on a phone: MSAA alone, no SMAA passes */dither.enabled=touch?mode==='high':mode!=='low';resize();}
 renderer.info.autoReset=false;
 // Optimization pass (16 Sep): the boss's slam and burst effects are hidden until
 // first used, so their shaders compiled mid-fight - three 125-132 ms freezes in
 // a 40 s duel. warm() draws one frame behind the loading screen with every
 // hidden node shown (lights excepted: a light count change would re-key every
 // program), through the real passes so the exact program variants compile.
 function warm(){
  const shown=[];scene.traverse(o=>{if(!o.visible&&!o.isLight){o.visible=true;shown.push(o);}});
  try{render();}finally{for(const o of shown)o.visible=false;}
 }
 // Post hooks for the fight (round 3). shock() takes a WORLD position: it is projected with the final camera at
 // render time, so a ring started in the fixed step lands where the impact is on screen this frame. The ring
 // runs out over shockLife seconds; a second shock while one runs restarts it at the stronger of the two.
 const shock={pos:new T.Vector3(),strength:0,age:1,life:.5},flashColor=new T.Color(1,.75,.5);let flashStrength=0,lastRender=0;
 const projected=new T.Vector3();
 const post={
  shock(at,strength=1){if(!at)return;const left=Math.max(0,1-shock.age/shock.life)*shock.strength;shock.pos.set(at.x,Number.isFinite(at.y)?at.y:.3,at.z);shock.strength=Math.max(left,Math.min(1.2,strength));shock.age=0;},
  flash(rgb,strength=.15){if(Array.isArray(rgb))flashColor.setRGB(rgb[0],rgb[1],rgb[2]);flashStrength=Math.max(flashStrength,Math.min(.5,strength));},
  get state(){return{shockStrength:shock.strength*Math.max(0,1-shock.age/shock.life),flashStrength};}
 };
 function updatePost(now){
  const dt=lastRender?Math.min(.1,now-lastRender):0;lastRender=now;
  shock.age+=dt;const remaining=Math.max(0,1-shock.age/shock.life);
  const u=grade.uniforms;
  if(remaining>0&&shock.strength>0){
   projected.copy(shock.pos).project(camera);
   const behind=projected.z>1||projected.z<-1;
   u.uShock.value.set(projected.x*.5+.5,projected.y*.5+.5,shock.age/shock.life*1.15,behind?0:shock.strength*remaining*(1-remaining*.3));
  }else u.uShock.value.w=0;
  u.uFlash.value.set(flashColor.r,flashColor.g,flashColor.b,flashStrength);
  flashStrength*=Math.exp(-dt*9);if(flashStrength<.002)flashStrength=0;
 }
 function render(){const now=performance.now()/1000;puddles.update(now);grade.uniforms.time.value=now;dither.uniforms.time.value=now;updatePost(now);renderer.info.reset();
   // Mirror first, as its own top-level render (see puddles.renderMirror); when it ran it already refreshed the shadow maps for this frame.
   const shadowAuto=renderer.shadowMap.autoUpdate,mirrored=puddles.renderMirror(renderer,scene,camera);
   if(mirrored)renderer.shadowMap.autoUpdate=false;
   try{composer.render();}finally{renderer.shadowMap.autoUpdate=shadowAuto;}}
 return{renderer,scene,camera,composer,bloom,ao,puddles,quality,warm,post,touch,
  render:()=>render()};
}
