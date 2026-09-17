import * as T from 'three';
import {Reflector} from 'three/addons/objects/Reflector.js';

const RIPPLE_COUNT=8,RIPPLE_LIFE=1.4;
// Shared with the floor material so the flagstone itself darkens and glosses
// under the same pools the mirror draws, instead of a pale decal floating on
// dry-looking stone.
export const wetMaskGLSL=`
 float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
 float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}
 // Round 2 review, major: at smoothstep(.53,.58) the threshold band was 0.05
 // wide on a noise field whose steepest slope is about 0.4 per metre, i.e. a
 // shoreline roughly 12 cm across in WORLD space with a 16:1 value step over
 // it. Measured: a horizontal scan of the altar camera ran 6 -> 100 in ~20 px,
 // held ~100, then dropped to 14 in ~30 px; the floor read as patches of snow
 // or spilled paint, not as wet stone. The band is now 0.18 wide - a shore
 // about 45 cm across - so the edge is a gradient nobody can trace. The
 // midpoint is unchanged (.55), so the wet COVERAGE, the pools the Reflector
 // draws and every ripple origin stay exactly where they were.
 float waterAt(vec2 p){float n=noise(p*.36+3.1)*.64+noise(p*.97-5.3)*.25+noise(p*2.6)*.11;return smoothstep(.46,.64,n)*(1.-smoothstep(10.5,11.9,abs(p.x)))*(1.-smoothstep(16.3,19.5,abs(p.y)));}
`;
// CPU rejection is deliberately conservative. The shader re-evaluates the
// exact wet mask at each origin as well, avoiding CPU/GPU sine differences.
export function puddleCoverageAt(x,z){
 const fract=x=>x-Math.floor(x),hash=(x,y)=>fract(Math.sin(x*127.1+y*311.7)*43758.5453),mix=(a,b,t)=>a+(b-a)*t;
 const noise=(x,y)=>{const ix=Math.floor(x),iy=Math.floor(y);let fx=x-ix,fy=y-iy;fx*=fx*(3-2*fx);fy*=fy*(3-2*fy);return mix(mix(hash(ix,iy),hash(ix+1,iy),fx),mix(hash(ix,iy+1),hash(ix+1,iy+1),fx),fy);};
 const n=noise(x*.36+3.1,z*.36+3.1)*.64+noise(x*.97-5.3,z*.97-5.3)*.25+noise(x*2.6,z*2.6)*.11;
 return T.MathUtils.smoothstep(n,.46,.64)*(1-T.MathUtils.smoothstep(Math.abs(x),10.5,11.9))*(1-T.MathUtils.smoothstep(Math.abs(z),16.3,19.5));
}

// All patches share one clipped reflection of the real scene. This is not a
// second floor material or a reflected sky texture: animated actors are visible.
export function createPuddles(scene){
 const ripples=Array.from({length:RIPPLE_COUNT},()=>new T.Vector4(0,0,-100,0));
 const reflector=new Reflector(new T.PlaneGeometry(24,40),{
  // Round 2 (16 Sep): the user's first complaint was that the candle
  // reflections "jitter and flicker unattractively, especially when I move".
  // Every flame is a 1-3 texel bright speck in this target, and without MSAA a
  // sub-texel camera move flips a speck's coverage between 0 and 100 percent -
  // measured 1 100-1 200 pixels per frame changing by more than 40 levels in
  // the wet centre with the camera STILL. 4x MSAA quantises coverage to
  // quarter steps; the mipmapped, explicit-LOD sampling below does the rest.
  textureWidth:768,textureHeight:432,multisample:4,clipBias:.001,
  shader:{name:'Shallow cathedral water',uniforms:{
   color:{value:new T.Color(0x667b86)},tDiffuse:{value:null},textureMatrix:{value:new T.Matrix4()},
   uTime:{value:0},uTexel:{value:new T.Vector2(1/768,1/432)},uReflect:{value:1},uRipples:{value:ripples}
  },vertexShader:`uniform mat4 textureMatrix;uniform vec4 uRipples[${RIPPLE_COUNT}];varying float vRippleWet[${RIPPLE_COUNT}];varying vec4 vProjected;varying vec3 vWorld;
   ${wetMaskGLSL}
   void main(){for(int i=0;i<${RIPPLE_COUNT};i++)vRippleWet[i]=uRipples[i].w>0.?step(.55,waterAt(uRipples[i].xy)):0.;vProjected=textureMatrix*vec4(position,1.);vWorld=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
  fragmentShader:`uniform sampler2D tDiffuse;uniform vec2 uTexel;uniform float uTime,uReflect;uniform vec4 uRipples[${RIPPLE_COUNT}];varying float vRippleWet[${RIPPLE_COUNT}];varying vec4 vProjected;varying vec3 vWorld;
   ${wetMaskGLSL}
   // Capped at 10: a candle core reflects at about 6, so nothing legitimate is touched, and a blown metal
   // highlight (the sword under its own fire light) reflects as a candle-bright speck instead of a square.
   vec3 tap(vec2 uv,float lod){vec3 c=texture2DLodEXT(tDiffuse,uv,lod).rgb;c=mix(c,vec3(0.),vec3(isnan(c)));return min(c,vec3(10.));}
   void main(){
    vec2 p=vWorld.xz;
    float water=waterAt(p);
    // Uneven shallow pools with a dry threshold and broken feathered shores.
    if(water<.01)discard;
    vec2 uv=vProjected.xy/vProjected.w;
    vec2 ripple=vec2(sin(p.x*3.7+p.y*2.1+uTime*.52),cos(p.y*4.2-p.x*1.8-uTime*.43));
    float contactSurface=0.;
    for(int i=0;i<${RIPPLE_COUNT};i++){
     float age=uTime-uRipples[i].z;
     if(uRipples[i].w>0.&&vRippleWet[i]>.5&&age>0.&&age<${RIPPLE_LIFE}){
      vec2 delta=p-uRipples[i].xy;float radius=length(delta),front=.07+age*.7;
      float band=(radius-front)/.11;
      float wave=sin(band*3.3)*exp(-band*band)*smoothstep(0.,.07,age)*pow(max(1.-age/${RIPPLE_LIFE},0.),2.)*uRipples[i].w;
      ripple+=delta/max(radius,.02)*wave*12.;
      contactSurface+=abs(wave);
     }
    }
    // Two analytic sines alone are too clean to be water. A slow chop of the
    // same value noise the wet mask is built from gives the surface micro
    // structure, so the reflection breaks up the way standing water does.
    vec2 micro=vec2(noise(p*2.35+vec2(uTime*.07,0.))-.5,noise(p*2.35+vec2(17.,9.-uTime*.055))-.5);
    // The chop is a smooth field, but at a grazing view one screen pixel spans
    // a quarter of its period and it degenerates into per-pixel noise that
    // re-jitters the sample with every sub-pixel camera move. Fade it out
    // where it aliases; up close it still breaks the mirror the way it should.
    vec2 dp=fwidth(p);
    float microFade=1.-smoothstep(.035,.12,max(dp.x,dp.y));
    ripple+=micro*1.7*microFade;
    uv+=ripple*uTexel*.34;
    float facing=abs(normalize(cameraPosition-vWorld).y);
    float graze=1.-facing;
    // Roughness by depth. The reflection target has no mips, so widening the
    // sample kernel IS the correct way to fake a rougher surface: sharp in the
    // middle of a pool, blurred out toward the shore where it is a millimetre
    // deep, and blurred more the more grazing the view.
    float depthT=smoothstep(.02,.35,water);
    float streak=uTexel.y*mix(1.0,.22,depthT)*(.35+.65*graze);
    // The target now carries mips, and every tap reads an EXPLICIT level: the
    // reflector is magnified on screen (768 texels across 1600 px), so the
    // implicit LOD is negative and a bias would clamp to level 0 and do
    // nothing. The streak taps read level 1.25, a prefiltered image in which a
    // candle is a stable blob instead of a texel that blinks; the mirror tap
    // stays close to full resolution in a deep pool (.6) and softens toward
    // the shore (1.35). Real standing water never resolves a flame to a pixel.
    float sharpLod=mix(1.35,.6,depthT),blurLod=1.25;
    // Graphics pass (16 Sep, evening): every tap is capped. The target is half
    // float, and the exile's sword - low roughness, lit by the 170-candela
    // nave wash - overflows it to +Inf at its highlight; downstream, the
    // warm-smear term below computed Inf - Inf = NaN, the NaN went into the
    // HDR buffer and the bloom mips spread it into the pixel-stepped black
    // blocks the user saw "on the floor". A reflected highlight brighter than
    // 10 is clipped white in any case, so nothing visible changes.
    vec3 blur=tap(uv+vec2(0.,streak),blurLod)*.20;
    blur+=tap(uv+vec2(0.,streak*2.),blurLod)*.17;
    blur+=tap(uv+vec2(0.,streak*3.5),blurLod)*.14;
    blur+=tap(uv+vec2(0.,streak*5.5),blurLod)*.12;
    blur+=tap(uv+vec2(0.,streak*8.),blurLod)*.10;
    blur+=tap(uv+vec2(0.,streak*11.),blurLod)*.10;
    blur+=tap(uv+vec2(0.,streak*15.),blurLod)*.09;
    blur+=tap(uv+vec2(0.,streak*20.),blurLod)*.08;
    vec2 lateral=vec2(uTexel.x*.9,0.);
    vec3 sharp=tap(uv,sharpLod)*.7+(tap(uv+lateral,sharpLod)+tap(uv-lateral,sharpLod))*.15;
    // Round 1 review: the mirror read as a milky grey fog sheet - the user's one
    // explicit "keep this" turned into milk. Two causes, both here. The blur was
    // mixed in at .38 EVERYWHERE, so even the deep middle of a pool, which is
    // the part that should show a candle as a candle, was more blurred than
    // sharp. Depth now drives the mix: a deep pool is a mirror (.13), the
    // millimetre-deep shore stays rough (.72), and grazing only roughens what
    // is already shallow.
    float shore=1.-smoothstep(.04,.42,water);
    vec3 reflection=mix(sharp,blur,clamp(.13+.59*shore+.26*graze*shore,0.,.92))*.4;
    // Leaves the dim 90 percent alone and lets reflected flame and window punch.
    reflection=reflection*.55+pow(max(reflection,0.),vec3(1.7))*1.9;
    float fresnel=.025+.975*pow(max(1.-facing,0.),5.);
    vec3 waterColor=mix(vec3(.010,.013,.015),reflection*vec3(.86,.93,.97),uReflect);
    // Reflected flame smears warm, reflected window stays cold.
    waterColor+=vec3(.020,.011,.004)*pow(max(reflection.r-reflection.b,0.),2.);
    // A small broad crest catches the room light; never a white/emissive ring.
    waterColor+=vec3(.014,.020,.022)*min(.4,contactSurface*.7);
    // The second cause of the milk: the base alpha had been lifted .11 -> .155
    // to stop the wet centre swallowing the boss's legs, which instead laid a
    // flat opaque wash over the near floor at every viewing angle. Back to .105
    // - the readability it was bought for now comes from the corona pools and
    // the restored black point, not from painting over the stone.
    gl_FragColor=vec4(waterColor,water*(.105+.60*fresnel+min(.025,contactSurface*.018)));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
   }`
  }
 });
 reflector.name='Shared shallow puddle reflections';reflector.rotation.x=-Math.PI/2;reflector.position.y=.012;
 // Mips on the reflection target: three regenerates them after every mirror
 // render (updateRenderTargetMipmap), and the shader reads explicit levels.
 // Set here, before the target is first uploaded; setSize() in quality()
 // keeps the texture parameters.
 {const rt=reflector.getRenderTarget();rt.texture.generateMipmaps=true;rt.texture.minFilter=T.LinearMipmapLinearFilter;rt.texture.magFilter=T.LinearFilter;}
 reflector.material.transparent=true;reflector.material.depthWrite=false;reflector.renderOrder=1;
 reflector.userData.cosmetic=true;
 scene.add(reflector);
 // Reflector clones shader uniforms, so keep the actual live pool reference.
 const pool=reflector.material.uniforms.uRipples.value;
 const originalRender=reflector.onBeforeRender;let enabled=true,nextRipple=0,seenContacts=new WeakSet();
 // Optimization pass (16 Sep): the mirror used to render from inside the main
 // pass (Reflector's onBeforeRender). A nested render gets its own render state
 // and so its own lights state, and every lit material then flipped between
 // the two light versions twice a frame: 62 program lookups per frame and a
 // full re-upload of all 25 lights' uniforms each time. renderMirror() is
 // called by rendering.js as a top-level render just before the main pass,
 // with the same camera, the same frustum test the main pass applied to this
 // mesh and the same scene state, so the reflection is the same image.
 reflector.onBeforeRender=()=>{};
 const frustum=new T.Frustum(),viewProjection=new T.Matrix4();
 function renderMirror(renderer,scene,camera){
  if(!enabled||!reflector.visible)return false;
  for(let node=reflector.parent;node;node=node.parent)if(!node.visible)return false;
  scene.updateMatrixWorld();if(camera.parent===null&&camera.matrixWorldAutoUpdate===true)camera.updateMatrixWorld();
  viewProjection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);frustum.setFromProjectionMatrix(viewProjection,renderer.coordinateSystem,camera.reversedDepth);
  if(!frustum.intersectsObject(reflector))return false;
  // Dust and volumetric atmosphere should not become flat mirrored billboards.
  // Nodes flagged puddleReflectionOnly exist for the mirror alone: the soft
  // flame glow sprites in arena.js, which give every reflected candle a
  // stable, several-texel blob instead of a blinking speck. Shown here, hidden
  // again in finally, so the main pass never draws them.
  const hidden=[],shown=[];scene.traverse(node=>{if(node===reflector)return;if(node.userData.puddleReflectionOnly){if(!node.visible){node.visible=true;shown.push(node);}return;}if(node.visible&&(node.isPoints||node.isSprite||node.userData.noPuddleReflection)){hidden.push(node);node.visible=false;}});
  // The mirror now renders first, so it is the pass that brings the shadow
  // maps up to date this frame; rendering.js then skips the refresh in the
  // main pass. The moon's shadow camera is fixed in the world, so the map is
  // the same whichever camera triggers it.
  // Reflector switches shadowMap.autoUpdate OFF around its nested render, so
  // on its own it never refreshes a map: needsUpdate survives that switch and
  // is what actually triggers the refresh (WebGLShadowMap clears it after).
  // Without it the moon's shadow froze on the loading frame and the three
  // cookie spotlights - baked once, on the first shadow render - were never
  // baked at all: their cones lit the whole nave unshaped through a stale
  // matrix, which is what washed the floor flat after the optimization pass.
  const shadows=renderer.shadowMap;
  if(shadows.enabled&&(shadows.autoUpdate||shadows.needsUpdate))shadows.needsUpdate=true;
  try{originalRender.call(reflector,renderer,scene,camera);}finally{hidden.forEach(node=>node.visible=true);shown.forEach(node=>node.visible=false);}
  return true;
 }
 return {mesh:reflector,renderMirror,update(time){const now=Number.isFinite(time)?time:0;reflector.material.uniforms.uTime.value=now;for(const ripple of pool)if(now-ripple.z>=RIPPLE_LIFE)ripple.w=0;},
  footstep(contact,{boss=false}={}){
   if(!contact||typeof contact!=='object'||!['step','landing'].includes(contact.kind)||seenContacts.has(contact))return false;
   seenContacts.add(contact);const p=contact.position;
   if(!p||![p.x,p.y,p.z].every(Number.isFinite)||Math.abs(p.y)>.1||puddleCoverageAt(p.x,p.z)<.45)return false;
   const strength=Math.min(.9,(boss?.62:.42)*(contact.kind==='landing'?1.35:1));
   pool[nextRipple].set(p.x,p.z,reflector.material.uniforms.uTime.value,strength);nextRipple=(nextRipple+1)%RIPPLE_COUNT;return true;
  },
  reset(){for(const ripple of pool)ripple.set(0,0,-100,0);seenContacts=new WeakSet();nextRipple=0;},
  quality(mode){enabled=mode!=='low';reflector.material.uniforms.uReflect.value=enabled?1:0;const width=mode==='high'?768:448,height=mode==='high'?432:252;reflector.getRenderTarget().setSize(width,height);reflector.material.uniforms.uTexel.value.set(1/width,1/height);},
  dispose(){reflector.removeFromParent();reflector.geometry.dispose();reflector.dispose();}
 };
}
