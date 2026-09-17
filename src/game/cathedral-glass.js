import * as T from 'three';

// The existing rose disc remains one draw call. Leaded panes, imperfect glass
// and muted surviving pigments are evaluated in its local circular UV space.
export function cathedralGlass() {
 const material=new T.MeshStandardMaterial({color:0xffffff,emissive:0xffffff,emissiveIntensity:.68,roughness:.83,metalness:.04,side:T.DoubleSide});
 material.onBeforeCompile=shader=>{
  shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec2 vRoseUv;');
  shader.vertexShader=shader.vertexShader.replace('#include <uv_vertex>','#include <uv_vertex>\nvRoseUv=uv;');
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
   varying vec2 vRoseUv;
   float glassHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
   vec3 rosePane(vec2 uv){
    vec2 p=(uv-.5)*2.;float r=length(p),a=(atan(p.y,p.x)+3.14159265)/6.2831853;
    float ring=floor(r*4.);float sector=floor(a*24.+mod(ring,2.)*.5);
    float seed=glassHash(vec2(sector,ring));
    vec3 pigment=vec3(.17,.265,.315);
    if(seed>.64) pigment=vec3(.255,.126,.139);
    if(seed>.86) pigment=vec3(.30,.245,.135);
    if(r<.18) pigment=vec3(.28,.30,.275);
    float radialCell=fract(r*4.),angularCell=fract(a*24.+mod(ring,2.)*.5);
    float leadDistance=min(min(radialCell,1.-radialCell)*.25,min(angularCell,1.-angularCell)*max(r,.05)*.2618);
    float aa=max(fwidth(r),.0002);
    float glass=smoothstep(.003-aa,.007+aa,leadDistance);
    float waviness=.88+.12*sin(p.x*83.+sin(p.y*61.)*1.7)*sin(p.y*72.+p.x*9.);
    float grime=mix(.7,1.,smoothstep(.02,.14,leadDistance));
    return mix(vec3(.018,.022,.024),pigment*(.8+seed*.35)*waviness*grime,glass);
   }
  `);
  shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\nvec3 pane=rosePane(vRoseUv);diffuseColor.rgb*=pane;');
  shader.fragmentShader=shader.fragmentShader.replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\ntotalEmissiveRadiance*=pane;');
 };
 material.customProgramCacheKey=()=> 'vesper-leaded-rose-v1';
 return material;
}
