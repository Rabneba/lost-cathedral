import * as T from 'three';
import {wetMaskGLSL} from './puddles.js';

// A 10 m shaft must not stretch half a photograph over its entire height.
// Preserve continuous cylindrical/arch UVs while giving the existing stone
// photograph the same metre scale as planar masonry and broken slabs.
export function scaleStoneUV(geometry,origin=[0,0,0],scale=[1,1,1]) {
  if(geometry.userData.worldUV)return geometry;
  const uv=geometry.attributes.uv,p=geometry.parameters;
  if(!uv||!p)return geometry;
  if(geometry.type==='BoxGeometry'){geometry.userData.worldUV=true;return geometry;}
  const offsetU=origin[0]*.37+origin[2]*.23,offsetV=origin[1]||0;
  if(geometry.type==='CylinderGeometry'){
    const circumference=Math.PI*(p.radiusTop+p.radiusBottom)*Math.max(scale[0],scale[2]);
    const sideCount=(p.radialSegments+1)*(p.heightSegments+1);
    for(let i=0;i<uv.count;i++){
      if(i<sideCount)uv.setXY(i,uv.getX(i)*circumference+offsetU,uv.getY(i)*p.height*scale[1]+offsetV);
      else uv.setXY(i,geometry.attributes.position.getX(i)*scale[0]+offsetU,geometry.attributes.position.getZ(i)*scale[2]+origin[2]);
    }
  }else if(geometry.type==='TubeGeometry'){
    const length=p.path.getLength(),circumference=2*Math.PI*p.radius;
    for(let i=0;i<uv.count;i++)uv.setXY(i,uv.getX(i)*length+offsetU,uv.getY(i)*circumference+offsetV);
  }
  return geometry;
}

// Floor paving zones (round 2, 16 Sep). The user asked for "more varied floor
// textures" and pointed at the UE reference's wet chequered marble nave. The
// floor is still ONE plane and ONE material; three paving sets are blended by a
// world-space mask inside the shader, each with its own metre scale:
//   0  grey flagstone  (the material's own map/normalMap)  - the border band
//   1  black-and-bone chequered marble, 0.6 m tiles       - the nave centre
//   2  carved tomb slabs and ledger stones                 - the aisles
// The borders are straight and tile-aligned (a real floor changes paving on a
// course, not on a noise blob): the chequer runs |x| < 7.8 = 13 tiles either
// side of the axis and ends at the sanctuary step; the tomb slabs start at
// the railings (|x| > 9.85). Everything the room already drew on the floor -
// wax and soot decals, the light pools, the inlaid seal, the wet mask - sits on
// top unchanged. Each set carries a derived normal map with roughness in
// alpha (scripts/derive-pbr-maps.py), because the texture lane returns base
// colour only; the samples are shared between the map, roughness and normal
// chunks below so the whole floor costs six texture reads, not nine.
export const FLOOR_ZONES={chequerHalfWidth:7.8,chequerFarZ:-14.4,chequerNearZ:13.2,tombFromX:9.85,flagTile:3.0,chequerTile:2.4,tombTile:3.2};
// GLSL literal: a JS 3.0 interpolates as "3", which GLSL reads as an int and
// refuses to divide a vec2 by (caught in the first capture of the zoned floor).
const F=x=>{const s=String(x);return /[.e]/.test(s)?s:s+'.0';};

// Surface-scale weathering shared by existing local stone textures. World-space
// modulation avoids the repeated dark patches that reveal tiled photographs.
// options.zones (floor only): {chequer:{map,nr}, tomb:{map,nr}} - the two extra
// paving sets; the material's own map/normalMap is the flagstone set.
// The nave set is swappable at runtime (user, 16 Sep evening: "a different floor, but keep this one").
// FLOOR_STYLES name each set's tile size, grid offset and grade; arena.setFloorStyle() swaps the
// shared uniforms, so no recompile. grade = [gain at black, gain at white, saturation kept].
export const FLOOR_STYLES={
  chequer:{label:'Chequered marble',tile:2.4,offset:[0,0],grade:[.62,.80,.85]},
  basalt:{label:'Black basalt',tile:4.8,offset:[.6,0],grade:[1.05,1.1,.9]},
  marble:{label:'Dark marble, diagonal',tile:3.0,offset:[0,0],grade:[1.25,1.4,.8]},
};
export function floorStyleUniforms(style,map,nr){
  const s=FLOOR_STYLES[style]||FLOOR_STYLES.chequer;
  return {uChequerMap:{value:map},uChequerNR:{value:nr},uChequerTile:{value:s.tile},uChequerOffset:{value:new T.Vector2(...s.offset)},uChequerGrade:{value:new T.Vector3(...s.grade)}};
}
export function weatherStone(material, {floor=false,masonry=false,zones=null}={}) {
  const zoned=floor&&zones&&zones.chequer?.map&&zones.tomb?.map;
  if(zoned)material.userData.floorUniforms=zones.chequer.uniforms||floorStyleUniforms('chequer',zones.chequer.map,zones.chequer.nr);
  material.onBeforeCompile=shader=>{
    if(zoned){
      Object.assign(shader.uniforms,material.userData.floorUniforms);
      shader.uniforms.uTombMap={value:zones.tomb.map};shader.uniforms.uTombNR={value:zones.tomb.nr};
    }
    shader.vertexShader=shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWeatherPosition;\nvarying vec3 vWeatherNormal;');
    shader.vertexShader=shader.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWeatherPosition=(modelMatrix*vec4(transformed,1.0)).xyz;\nvWeatherNormal=normalize(mat3(modelMatrix)*normal);');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vWeatherPosition;
      varying vec3 vWeatherNormal;
      float weatherHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float weatherNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(weatherHash(i),weatherHash(i+vec2(1,0)),f.x),mix(weatherHash(i+vec2(0,1)),weatherHash(i+vec2(1,1)),f.x),f.y);}
      ${floor?wetMaskGLSL:''}
      ${zoned?`
      uniform sampler2D uChequerMap,uChequerNR,uTombMap,uTombNR;uniform float uChequerTile;uniform vec2 uChequerOffset;uniform vec3 uChequerGrade;
      // x = flagstone, y = chequer, z = tomb slabs. Straight, tile-aligned borders
      // with a 6 cm feather so the seam is a grout line, not a blur.
      vec3 floorZones(vec2 p){
        float ax=abs(p.x);
        float chequer=(1.-smoothstep(${F(FLOOR_ZONES.chequerHalfWidth-.03)},${F(FLOOR_ZONES.chequerHalfWidth+.03)},ax))
          *(1.-smoothstep(${F(FLOOR_ZONES.chequerNearZ-.03)},${F(FLOOR_ZONES.chequerNearZ+.03)},p.y))
          *smoothstep(${F(FLOOR_ZONES.chequerFarZ-.03)},${F(FLOOR_ZONES.chequerFarZ+.03)},p.y);
        float tomb=smoothstep(${F(FLOOR_ZONES.tombFromX-.03)},${F(FLOOR_ZONES.tombFromX+.03)},ax);
        return vec3((1.-chequer)*(1.-tomb),chequer,tomb);
      }
      // Tomb cells are mirrored per 3.2 m cell by a hash, so the effigies do
      // not march down the aisle in lock-step. A seamless tile mirrored is
      // still continuous at the cell edge; the normal's x/y flip with it.
      vec4 tombCell(vec2 p){vec2 cell=floor(p/${F(FLOOR_ZONES.tombTile)});vec2 f=fract(p/${F(FLOOR_ZONES.tombTile)});float h=weatherHash(cell+vec2(3.7,1.3));
        float mx=h>.5?-1.:1.,my=fract(h*7.3)>.5?-1.:1.;if(mx<0.)f.x=1.-f.x;if(my<0.)f.y=1.-f.y;return vec4(f,mx,my);}
      `:''}
    `);
    // The floor samples its three paving sets here, in world metres, and keeps
    // the blended normal+roughness texel for the chunks further down.
    if(zoned)shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>', `
      vec3 zoneW=floorZones(vWeatherPosition.xz);
      vec4 tombC=tombCell(vWeatherPosition.xz);
      vec2 flagUv=vWeatherPosition.xz/${F(FLOOR_ZONES.flagTile)},chequerUv=(vWeatherPosition.xz+uChequerOffset)/uChequerTile;
      vec4 sampledDiffuseColor=vec4(0.);vec4 zoneNR=vec4(0.);
      #ifdef USE_MAP
      if(zoneW.x>0.){sampledDiffuseColor+=texture2D(map,flagUv)*zoneW.x;}
      #endif
      // The relief maps are read one mip level softer than the colour (LOD bias
      // +1) and with less anisotropy (arena.js): at a grazing floor anisotropic
      // filtering keeps millimetre facets alive ten metres away, and under any
      // camera motion those facets shimmer - measured as 8-10 % of the far
      // floor moving > 8 levels between frames while the lock-on camera
      // tracked the walking boss. Colour stays sharp; relief goes soft with
      // distance, which is also what a real floor does.
      #ifdef USE_NORMALMAP
      if(zoneW.x>0.){zoneNR+=texture2D(normalMap,flagUv,1.0)*zoneW.x;}
      #endif
      if(zoneW.y>0.){
        vec4 c=texture2D(uChequerMap,chequerUv);
        // Bone tiles at full albedo would be the brightest thing on the
        // fighting floor. Pulled toward their own mean and darkened so the
        // pattern reads under the boss without stealing his silhouette.
        float cl=dot(c.rgb,vec3(.2126,.7152,.0722));
        c.rgb=mix(vec3(cl),c.rgb,uChequerGrade.z)*mix(uChequerGrade.x,uChequerGrade.y,cl);
        sampledDiffuseColor+=c*zoneW.y;
        vec4 nr=texture2D(uChequerNR,chequerUv,1.0);nr.xy=(nr.xy-.5)*.75+.5;
        zoneNR+=nr*zoneW.y;
      }
      if(zoneW.z>0.){
        sampledDiffuseColor+=texture2D(uTombMap,tombC.xy)*vec4(.94,.93,.92,1.)*zoneW.z;
        vec4 nr=texture2D(uTombNR,tombC.xy,1.0);nr.x=(nr.x-.5)*tombC.z+.5;nr.y=(nr.y-.5)*tombC.w+.5;
        zoneNR+=nr*zoneW.z;
      }
      diffuseColor*=sampledDiffuseColor;
    `);
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      vec3 wp=vWeatherPosition;
      float broad=weatherNoise(wp.xz*.39+wp.y*.07);
      float fine=weatherNoise(wp.xz*2.3+wp.y*.19);
      float damp=${floor?'smoothstep(.49,.79,broad*.8+fine*.2)':'(1.-smoothstep(.1,2.4,wp.y))*(.35+.65*broad)'};
      diffuseColor.rgb*=mix(vec3(.77,.81,.82),vec3(1.04,1.02,.96),broad);
      diffuseColor.rgb*=mix(vec3(1.),vec3(.66,.72,.71),damp*.48);
      ${floor?`float nearestPierZ=clamp(floor((wp.z+15.)/6.+.5)*6.-15.,-15.,15.);
      float pierDistance=length(vec2(abs(wp.x)-10.7,wp.z-nearestPierZ));
      diffuseColor.rgb*=1.-exp(-pierDistance*pierDistance*.55)*.19;
      // Read existing photographed joints rather than overlaying a second grid.
      // Their recessed grit varies from dark damp mortar to pale mineral dust.
      float stoneLuma=.2;
      #ifdef USE_MAP
       stoneLuma=dot(sampledDiffuseColor.rgb,vec3(.2126,.7152,.0722));
      #endif
      // The chequer's black marble is not a joint: no dust lift, no procedural
      // relief on it (the zone weight gates both).
      float jointMask=(1.-smoothstep(.034,.105,stoneLuma))${zoned?'*(1.-zoneW.y)':''};
      float pierEdge=max(abs(abs(wp.x)-10.7)-1.025,abs(wp.z-nearestPierZ)-1.025);
      float baseDeposit=exp(-max(pierEdge,0.)*3.2);
      float jointDust=jointMask*(smoothstep(.37,.73,fine)*.63+baseDeposit*.37);
      diffuseColor.rgb+=vec3(.025,.023,.018)*jointDust;
      float wear=weatherNoise(wp.xz*.91+vec2(8.7,19.3));
      float wornFace=smoothstep(.11,.24,stoneLuma)*(1.-jointMask);
      diffuseColor.rgb*=1.+(wear-.5)*.20*wornFace;
      float flagstoneHeight=smoothstep(.037,.16,stoneLuma)*.012${zoned?'*(1.-zoneW.y)':''};
      flagstoneHeight+=(wear-.5)*.003*wornFace;
      // Standing water darkens stone, it does not whiten it. The pools the
      // Reflector draws sat lighter than the surrounding slabs, which read as
      // milky decals; the flagstone now goes dark and glossy underneath, with a
      // wider damp shore around every pool.
      float wet=waterAt(wp.xz);
      float wetNoise=noise(wp.xz*.36+3.1)*.64+noise(wp.xz*.97-5.3)*.25+noise(wp.xz*2.6)*.11;
      float dampWet=smoothstep(.34,.58,wetNoise)*(1.-smoothstep(10.5,11.9,abs(wp.x)))*(1.-smoothstep(16.3,19.5,abs(wp.z)));
      // Round 2 review, major: .52 albedo UNDER a roughness collapse to .055
      // (below) meant the wet flagstone kept neither diffuse nor, off the
      // specular lobe, anything else - dry stone measured luma 64 against wet
      // stone at 20 across a shoreline a few centimetres wide, and the nave
      // read as blotches of snow. Wet stone is darker than dry stone; it is not
      // sixteen times darker. .68 with the roughness below lands the step near
      // 2:1, which is what standing water on limestone actually does.
      diffuseColor.rgb*=mix(vec3(1.),vec3(.68,.71,.73),wet);
      diffuseColor.rgb*=mix(vec3(1.),vec3(.72,.75,.76),dampWet*.85);`:''}

      ${masonry?`float h=wp.x+wp.z;
      float course=floor(wp.y/.62),blockWidth=1.45+weatherHash(vec2(course,17.))*.65;
      vec2 ashlarUV=vec2((h+weatherHash(vec2(course,31.))*.8)/blockWidth,wp.y/.62);
      vec2 cell=fract(ashlarUV),jointDistance=min(cell,1.-cell)*vec2(blockWidth,.62);
      float edge=min(jointDistance.x,jointDistance.y)+(weatherNoise(vec2(h,wp.y)*7.)-.5)*.006;
      float jointAA=max(fwidth(h),fwidth(wp.y))*.55;
      float ashlarHeight=smoothstep(.006-jointAA,.024+jointAA,edge)*(1.-abs(normalize(vWeatherNormal).y));
      float blockTone=.88+.17*weatherHash(vec2(floor(ashlarUV.x),course));
      diffuseColor.rgb*=mix(.65,blockTone,ashlarHeight);
      // Rain entered through the broken upper roof. Elongated mineral stains
      // run down the apse without adding wall decals or repeating every course.
      float apse=1.-smoothstep(.8,1.5,abs(wp.z+20.));
      float runnel=weatherNoise(vec2(h*2.2,wp.y*.095));
      float trickle=weatherNoise(vec2(h*9.1,wp.y*.13));
      float stain=smoothstep(.52,.77,runnel*.75+trickle*.25)*smoothstep(2.,7.,wp.y)*apse;
      diffuseColor.rgb*=mix(vec3(1.),vec3(.67,.71,.69),stain*.75);
      // The same three things happen to every wall in a roofless cathedral and
      // none of them were modelled: damp wicking up out of the floor, rain
      // streaking down from the broken clerestory, and soot in the vault.
      float rise=1.-smoothstep(.15,4.4,wp.y);
      float streakBroad=weatherNoise(vec2(h*2.9,wp.y*.055));
      float streakFine=weatherNoise(vec2(h*10.7,wp.y*.085));
      float streaks=smoothstep(.44,.86,streakBroad*.72+streakFine*.28)*smoothstep(1.2,6.5,wp.y);
      float sootBand=smoothstep(8.2,15.5,wp.y);
      diffuseColor.rgb*=mix(vec3(1.),vec3(.55,.60,.61),rise*.62);
      diffuseColor.rgb*=mix(vec3(1.),vec3(.71,.74,.73),streaks*.5);
      diffuseColor.rgb*=mix(vec3(1.),vec3(.62,.60,.58),sootBand*.55);`:''}

    `);
    // Relief. With a normal map bound (round 2: every stone and floor set has
    // one) three's own tangent-space branch runs first; the procedural
    // ashlar/flagstone height is then layered on top through perturbNormalArb,
    // which needs bumpMap bound (at scale 0) to stay in scope. The zoned floor
    // replaces the normal-map read with the blended texel sampled above.
    if(masonry||floor)shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>', `
      ${zoned?`
      #if defined( USE_NORMALMAP_TANGENTSPACE )
       // Standing water has a FLAT surface: the relief of the slab under a pool
       // is refracted, not reflected. Measured with the relief left on under
       // the pools, nine flickering candle points and the cold apse key broke
       // into thousands of micro-facet highlights that changed 20-40 levels
       // every frame (12 % of the wet centre against 1.6 % before) - the
       // sparkle the user complained about, from a different source. The map
       // fades out with the wet mask and the damp shore, and the Reflector on
       // top carries the actual mirror image.
       vec3 mapN=zoneNR.xyz*2.0-1.0;mapN.xy*=normalScale*(1.-wet*.92)*(1.-dampWet*.35);normal=normalize(tbn*mapN);
      #endif
      `:'#include <normal_fragment_maps>'}
      #ifdef USE_BUMPMAP
       normal=perturbNormalArb(-vViewPosition,normal,vec2(dFdx(${floor?'flagstoneHeight*(1.-wet*.8)':'ashlarHeight*.007'}),dFdy(${floor?'flagstoneHeight*(1.-wet*.8)':'ashlarHeight*.007'})),faceDirection);
      #endif
    `);
    shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      // Roughness rides in the normal map's alpha (derived: rough in the joints
      // and on cracks, smoother on worn slab centres). Read here, before the
      // damp and wet terms, so the wet mix stays the last word.
      ${zoned?`roughnessFactor*=mix(1.,zoneNR.a,step(.001,zoneW.x+zoneW.y+zoneW.z));
      // Specular-shimmer clamp (round 2, the AA request). The derived roughness
      // maps reach .45 on the polished marble; under nine independently
      // flickering candle points every micro-facet highlight then pulsed as a
      // bright dash along the tile rows (temporal std map of the far floor:
      // 9.8 % of pixels moving > 8 levels with the camera still, against 3.4 %
      // before). Dry stone in this room is never glossier than .56; the damp
      // shore and the wet mix below still take it down to .42 and .19.
      roughnessFactor=max(roughnessFactor,.56);`:`
      #ifdef USE_NORMALMAP
       roughnessFactor*=texture2D(normalMap,vNormalMapUv).a;
      #endif`}
      roughnessFactor=mix(roughnessFactor,${floor?'.58':'.76'},damp*${floor?'.65':'.4'});
      ${masonry?'roughnessFactor=mix(roughnessFactor,.52,rise*.45);roughnessFactor=mix(roughnessFactor,.97,sootBand*.5);':''}
      ${floor?`roughnessFactor=mix(roughnessFactor,.94,jointDust*.65);roughnessFactor-=wornFace*smoothstep(.4,.78,wear)*.045;
      roughnessFactor=mix(roughnessFactor,.42,dampWet*.6);
      // .055 is a mirror: off the specular lobe the wet patch had no diffuse
      // left and went black, which is the other half of the snow-blotch step
      // above. .19 still gives a sharp candle highlight and a wet sheen - the
      // Reflector on top is what carries the actual mirror image - while the
      // stone under it keeps enough diffuse to stay stone.
      roughnessFactor=mix(roughnessFactor,.19,wet);`:''}
    `);
  };
  material.customProgramCacheKey=()=>`weathered-stone-${floor?(zoned?'floor-zoned':'floor'):masonry?'ashlar':'wall'}-v9`;
  material.needsUpdate=true;
  return material;
}

export function vaultSection(side,z,widthStart,widthEnd,length=5.7) {
  const positions=[],uvs=[],indices=[], across=10,along=3;
  for(let j=0;j<=along;j++)for(let i=0;i<=across;i++){
    const u=i/across,x=side*(widthStart+(widthEnd-widthStart)*u);
    const y=10.94+6.3*(1-Math.pow(Math.abs(x)/10.7,1.55));
    const zz=z+(j/along-.5)*length;
    positions.push(x,y,zz);uvs.push((x+11)*.9,zz*.9);
    if(i<across&&j<along){const a=j*(across+1)+i;indices.push(a,a+1,a+across+1,a+1,a+across+2,a+across+1);}
  }
  const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new T.Float32BufferAttribute(uvs,2));geometry.setIndex(indices);geometry.computeVertexNormals();return geometry;
}

// Real wall above a pointed arch; the rose is an actual opening, not a bright
// disc suspended in a rectangular black gap. Width overlaps the side masonry.
export function archSpandrel(hasRose=false) {
  const shape=new T.Shape();shape.moveTo(-4.1,6.4);shape.lineTo(-4.1,19);shape.lineTo(4.1,19);shape.lineTo(4.1,6.4);shape.lineTo(3,6.4);
  for(let i=1;i<=40;i++){const x=3-i/40*6;shape.lineTo(x,6.4+5*(1-Math.pow(Math.abs(x)/3,1.55)));}
  shape.lineTo(-4.1,6.4);
  if(hasRose){const hole=new T.Path();hole.absarc(0,14.4,2.78,0,Math.PI*2,false);shape.holes.push(hole);}
  return new T.ShapeGeometry(shape,48);
}

export function pointedGateShape() {
  const shape=new T.Shape();shape.moveTo(-2.94,0);shape.lineTo(2.94,0);shape.lineTo(2.94,6.4);
  for(let i=1;i<=40;i++){const x=2.94-i/40*5.88;shape.lineTo(x,6.4+4.85*(1-Math.pow(Math.abs(x)/2.94,1.55)));}
  shape.lineTo(-2.94,0);return new T.ShapeGeometry(shape);
}
