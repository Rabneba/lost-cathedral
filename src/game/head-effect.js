import * as T from 'three';

// A recessed surface inside the existing aperture, in this rig's native
// centimetre coordinates. The head bone (and actor scale) owns all motion.
export function createHeadEffect(head){
 if(!head)return null;
 // uThreat is the attack anticipation (0 at idle, pinned by the tests); uRest is
 // the standing glow the fight sets so the hood is never dark between attacks.
 const uniforms={uTime:{value:0},uThreat:{value:0},uLife:{value:1},uRest:{value:0}};
 const material=new T.ShaderMaterial({
  uniforms,transparent:true,depthWrite:false,depthTest:true,side:T.FrontSide,
  vertexShader:`varying vec2 vUv; varying vec3 vView;
   void main(){vUv=uv;vec4 p=modelViewMatrix*vec4(position,1.);vView=normalize(-p.xyz);gl_Position=projectionMatrix*p;}`,
  fragmentShader:`uniform float uTime,uThreat,uLife,uRest; varying vec2 vUv; varying vec3 vView;
   float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
   float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}
   float mist(vec2 p){return .57*noise(p)+.28*noise(p*2.03+4.1)+.15*noise(p*4.09-3.7);}
   void main(){
    vec2 p=(vUv-.5)*2.;float edge=1.-smoothstep(.64,1.,length(p));
    if(edge<.005)discard;
    float t=uTime*.12;
    vec2 q=p*vec2(2.3,3.7)+vec2(vView.x*.11,t);
    float warp=mist(q*.7+vec2(t*.35,-t*.6));
    float n=mist(q+vec2(warp*.9,-t));
    float filaments=smoothstep(.40,.72,n)*smoothstep(.27,.74,mist(q*.72+vec2(-t*.2,2.1)));
    float veil=mist(q*1.7+vec2(-t*.3,1.6));
    vec3 dark=vec3(.006,.009,.012);
    vec3 silver=vec3(.18,.25,.30)*(filaments*.72+veil*.13);
    float glow=clamp(uRest+uThreat,0.,1.4);
    float ember=pow(max(0.,n-.57)*3.3,3.)*glow;
    vec3 color=dark+silver*(1.+glow*1.6)+vec3(.32,.11,.035)*ember*.55;
    color*=uLife;
    gl_FragColor=vec4(color,edge*.94);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
   }`
 });
 const geometry=new T.PlaneGeometry(1,1,8,8),positions=geometry.attributes.position;
 for(let i=0;i<positions.count;i++){const x=positions.getX(i)*2,y=positions.getY(i)*2;positions.setZ(i,-.055*(x*x+y*y));}
 geometry.computeVertexNormals();
 const mesh=new T.Mesh(geometry,material);mesh.name='Recessed hood mist';
 mesh.position.set(-.2,-1.5,13);mesh.scale.set(15,23,12);mesh.frustumCulled=false;
 mesh.userData.cosmetic=true;head.add(mesh);
 return {mesh,uniforms,reset(){uniforms.uTime.value=0;uniforms.uThreat.value=0;uniforms.uLife.value=1;uniforms.uRest.value=0;},
  /** Standing glow, 0..1, set every frame by the combat effects (phase-aware). */
  setRest(value){uniforms.uRest.value=Number.isFinite(value)?Math.max(0,Math.min(1,value)):0;},
  update(dt,time,action,timing,health){
   uniforms.uTime.value=Number.isFinite(time)?time:0;
   // Any timed attack anticipates, not just the three the first pass knew:
   // COMBAT's new actions carry windup/hitWindows and are picked up here.
   const name=action?.name,elapsed=Math.max(0,action?.elapsed||0);
   const attacking=!!name&&!['idle','walk','hit','death','awaken'].includes(name)&&(Number.isFinite(timing?.hitWindows?.[0]?.[0])||Number.isFinite(timing?.windup));
   let threat=0;
   if(name==='awaken')threat=1-T.MathUtils.smoothstep(elapsed,1.9,2.6);
   else if(attacking){
    const start=timing?.hitWindows?.[0]?.[0]??timing?.windup??1;
    const end=timing?.hitWindows?.at(-1)?.[1]??start+(timing?.active??.35);
    // Gradual anticipation, then a brief exhale through the cut; no hit flash.
    threat=T.MathUtils.smoothstep(elapsed,Math.max(0,start-.8),start)*(1-T.MathUtils.smoothstep(elapsed,end,end+.65));
   }
   uniforms.uThreat.value=dt>0?T.MathUtils.damp(uniforms.uThreat.value,threat,6,Math.min(dt,.1)):threat;
   uniforms.uLife.value=health<=0?Math.max(0,1-elapsed/1.8):1;
  },dispose(){mesh.removeFromParent();geometry.dispose();material.dispose();}
 };
}
