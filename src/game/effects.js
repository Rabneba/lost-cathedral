import * as T from 'three';
// Pool ceilings. The slam throws a wall of grit and a shower of fragments, so
// both are sized for one heavy impact overlapping the tail of the previous one.
// A slam has to fill a volume of air with grit. At 168 the particles had to be
// big and bright to cover the impact, and big + bright reads as a cluster of
// bokeh discs; 280 smaller, fainter ones merge into an actual cloud. Still one
// draw call and one preallocated buffer.
const DUST=280,CHIPS=96;
const DEFAULT_DUST=new T.Color(0x73736c);
// Tints arrive as hex literals from the hot path; cache the Colors they mean.
const TINTS=new Map();
export class Effects{
 constructor(scene){this.scene=scene;this.pool=[];this.dustPool=[];this.chipPool=[];const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(new Float32Array(240*3),3));g.setAttribute('color',new T.Float32BufferAttribute(new Float32Array(240*3),3));
 const sparkMaterial=new T.ShaderMaterial({transparent:true,depthWrite:false,blending:T.AdditiveBlending,vertexColors:true,
  vertexShader:'varying vec3 vColor;void main(){vColor=color;vec4 p=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*p;gl_PointSize=clamp(35./max(1.,-p.z),1.5,7.);}',
  fragmentShader:'varying vec3 vColor;void main(){float r=length(gl_PointCoord-.5)*2.;gl_FragColor=vec4(vColor,pow(max(0.,1.-r),2.));\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}'});
 this.points=new T.Points(g,sparkMaterial);this.points.frustumCulled=false;g.setDrawRange(0,0);scene.add(this.points);
 const streaks=new T.BufferGeometry();streaks.setAttribute('position',new T.Float32BufferAttribute(new Float32Array(480*3),3));streaks.setAttribute('color',new T.Float32BufferAttribute(new Float32Array(480*3),3));streaks.setDrawRange(0,0);
 this.streaks=new T.LineSegments(streaks,new T.LineBasicMaterial({vertexColors:true,transparent:true,opacity:.7,depthWrite:false,blending:T.AdditiveBlending}));this.streaks.frustumCulled=false;scene.add(this.streaks);
 this.flash=new T.PointLight(0xffb66b,0,6);scene.add(this.flash);
 const dustGeometry=new T.BufferGeometry();dustGeometry.setAttribute('position',new T.Float32BufferAttribute(new Float32Array(DUST*3),3));dustGeometry.setAttribute('alpha',new T.Float32BufferAttribute(new Float32Array(DUST),1));dustGeometry.setAttribute('size',new T.Float32BufferAttribute(new Float32Array(DUST),1));dustGeometry.setAttribute('tint',new T.Float32BufferAttribute(new Float32Array(DUST*3),3));dustGeometry.setAttribute('seed',new T.Float32BufferAttribute(new Float32Array(DUST),1));
 const dustMaterial=new T.ShaderMaterial({transparent:true,depthWrite:false,vertexShader:'attribute float alpha;attribute float size;attribute vec3 tint;attribute float seed;varying float vAlpha;varying vec3 vTint;varying float vSeed;void main(){vAlpha=alpha;vTint=tint;vSeed=seed;vec4 p=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*p;gl_PointSize=clamp(size*420./max(1.,-p.z),1.,96.);}',fragmentShader:'varying float vAlpha;varying vec3 vTint;varying float vSeed;float dh(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}float dn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(dh(i),dh(i+vec2(1.,0.)),f.x),mix(dh(i+vec2(0.,1.)),dh(i+vec2(1.,1.)),f.x),f.y);}void main(){float r=length(gl_PointCoord-.5)*2.;float nz=dn(gl_PointCoord*3.6+vSeed)*.62+dn(gl_PointCoord*8.4-vSeed)*.32;float a=pow(max(0.,1.-r*(.62+nz*.86)),2.3)*vAlpha;if(a<.002)discard;gl_FragColor=vec4(vTint,a);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}'});
 this.dust=new T.Points(dustGeometry,dustMaterial);this.dust.frustumCulled=false;this.dust.userData.noPuddleReflection=true;scene.add(this.dust);
 this.chips=new T.InstancedMesh(new T.TetrahedronGeometry(.024),new T.MeshStandardMaterial({color:0x77756e,roughness:1,metalness:0}),CHIPS);this.chips.instanceMatrix.setUsage(T.DynamicDrawUsage);this.chips.count=0;this.chips.frustumCulled=false;scene.add(this.chips);this.chipTransform=new T.Object3D();
 }
 burst(at,color=0xffb96e,count=22,flash=12){const c=new T.Color(color).multiplyScalar(2);for(let i=0;i<count;i++){if(this.pool.length>=240)this.pool.shift();this.pool.push({p:new T.Vector3(at.x,at.y,at.z),v:new T.Vector3((Math.random()-.5)*4,Math.random()*3,(Math.random()-.5)*4),life:.2+Math.random()*.45,c:c.clone()});}this.flash.position.copy(at);this.flash.color.set(color);this.flash.intensity=Math.max(this.flash.intensity,flash);}
 impact(at,direction=new T.Vector3(),shield=false){
  const color=new T.Color(shield?0xc8d4df:0xc9a574).multiplyScalar(1.7);
  for(let i=0;i<(shield?13:9);i++){if(this.pool.length>=240)this.pool.shift();this.pool.push({p:at.clone(),v:new T.Vector3((Math.random()-.5)*2.5,Math.random()*1.8,(Math.random()-.5)*2.5).addScaledVector(direction,.65),life:.12+Math.random()*.2,c:color.clone()});}
  this.flash.position.copy(at);this.flash.color.set(shield?0xc8d4df:0xffb66b);this.flash.intensity=shield?3.8:2.6;
 }
 ground(point,weight=1,{dust=1}={}){
  const at=point.clone?point:new T.Vector3(point.x,point.y??0,point.z);
  const count=dust<=0?0:weight<.5?2:7;
  for(let i=0;i<count;i++){if(this.dustPool.length>=DUST)this.dustPool.shift();const life=.35+Math.random()*.45;this.dustPool.push({p:at.clone().add(new T.Vector3((Math.random()-.5)*.14,.015,(Math.random()-.5)*.14)),v:new T.Vector3((Math.random()-.5)*.7,Math.random()*.35+.05,(Math.random()-.5)*.7).multiplyScalar(weight),life,total:life,size:(.18+Math.random()*.18)*Math.max(.5,weight),opacity:(weight<.5?.12:.28)*dust,tint:DEFAULT_DUST,seed:Math.random()*9.7});}
  // Heavy blade contacts loosen a few fragments; ordinary steps stay fine dust.
  if(weight>=.55)for(let i=0;i<Math.ceil(weight*5);i++){
   if(this.chipPool.length>=CHIPS)this.chipPool.shift();const life=.65+Math.random()*.45;
   this.chipPool.push({p:new T.Vector3(at.x,.028,at.z),v:new T.Vector3((Math.random()-.5)*1.6,.5+Math.random()*.75,(Math.random()-.5)*1.6).multiplyScalar(weight),r:new T.Vector3(Math.random()*6,Math.random()*6,Math.random()*6),spin:new T.Vector3(Math.random()*9,Math.random()*9,Math.random()*9),scale:new T.Vector3(.5+Math.random()*.6,.25+Math.random()*.4,.7+Math.random()*.9),life,bounced:false});
  }
 }
 /** A wall of displaced grit: a ring of large, slow dust thrown outward from a
  * point, optionally biased along a cut. Used for the slam's ground burst, the
  * sweep's displaced air and the soot of a hit. */
 dustWall(at,{count=12,radius=.4,speed=2.5,rise=1,size=.5,opacity=.3,tint=DEFAULT_DUST,direction=null,growth=1.8,life=.55}={}){
  const colour=tint instanceof T.Color?tint:(TINTS.get(tint)||TINTS.set(tint,new T.Color(tint)).get(tint));
  const y=Number.isFinite(at.y)?at.y:.05;
  for(let i=0;i<count;i++){
   if(this.dustPool.length>=DUST)this.dustPool.shift();
   const angle=Math.random()*Math.PI*2,spread=Math.sqrt(Math.random());
   const total=life+Math.random()*life*.8;
   const velocity=new T.Vector3(Math.cos(angle)*speed*spread,(.25+Math.random()*.75)*rise,Math.sin(angle)*speed*spread);
   if(direction)velocity.addScaledVector(direction,speed*.75);
   this.dustPool.push({p:new T.Vector3(at.x+Math.cos(angle)*radius*spread,y+Math.random()*.16,at.z+Math.sin(angle)*radius*spread),
    v:velocity,life:total,total,size:size*(.6+Math.random()*.7),opacity,growth,tint:colour,seed:Math.random()*9.7});
  }
 }
 update(dt){
  this.updateDust(dt);this.updateChips(dt);this.flash.intensity*=Math.exp(-dt*18);this.pool=this.pool.filter(p=>p.life>dt);
  const pos=this.points.geometry.attributes.position,col=this.points.geometry.attributes.color,tail=this.streaks.geometry.attributes.position,tailColor=this.streaks.geometry.attributes.color;
  this.pool.forEach((p,i)=>{p.life-=dt;p.v.y-=dt*7;p.p.addScaledVector(p.v,dt);const light=Math.min(1,p.life*5);
   pos.setXYZ(i,p.p.x,p.p.y,p.p.z);col.setXYZ(i,p.c.r*light,p.c.g*light,p.c.b*light);
   const length=Math.min(.022,.09/Math.max(.001,p.v.length()));tail.setXYZ(i*2,p.p.x,p.p.y,p.p.z);tail.setXYZ(i*2+1,p.p.x-p.v.x*length,p.p.y-p.v.y*length,p.p.z-p.v.z*length);
   tailColor.setXYZ(i*2,p.c.r*light,p.c.g*light,p.c.b*light);tailColor.setXYZ(i*2+1,0,0,0);
  });this.points.geometry.setDrawRange(0,this.pool.length);this.streaks.geometry.setDrawRange(0,this.pool.length*2);pos.needsUpdate=col.needsUpdate=tail.needsUpdate=tailColor.needsUpdate=true;
 }
 updateDust(dt){
  this.dustPool=this.dustPool.filter(p=>p.life>dt);const g=this.dust.geometry,p=g.attributes.position,a=g.attributes.alpha,s=g.attributes.size,t=g.attributes.tint,sd=g.attributes.seed;
  for(let i=0;i<DUST;i++){const d=this.dustPool[i];if(d){d.life-=dt;d.v.multiplyScalar(Math.exp(-dt*2));d.p.addScaledVector(d.v,dt);const progress=1-Math.max(0,d.life/d.total);p.setXYZ(i,d.p.x,d.p.y,d.p.z);s.setX(i,d.size*(1+progress*(d.growth??.9)));a.setX(i,d.opacity*Math.sin(Math.PI*progress));t.setXYZ(i,d.tint.r,d.tint.g,d.tint.b);sd.setX(i,d.seed??0);}else{p.setXYZ(i,0,-100,0);a.setX(i,0);}}
  g.setDrawRange(0,this.dustPool.length);p.needsUpdate=a.needsUpdate=s.needsUpdate=t.needsUpdate=sd.needsUpdate=true;
 }
 updateChips(dt){
  this.chipPool=this.chipPool.filter(p=>p.life>dt);
  this.chipPool.forEach((chip,i)=>{chip.life-=dt;chip.v.y-=dt*8;chip.p.addScaledVector(chip.v,dt);chip.r.addScaledVector(chip.spin,dt);
   if(chip.p.y<.018){chip.p.y=.018;chip.v.y=chip.bounced?0:Math.abs(chip.v.y)*.18;chip.v.x*=.45;chip.v.z*=.45;chip.spin.multiplyScalar(.45);chip.bounced=true;}
   const m=this.chipTransform;m.position.copy(chip.p);m.rotation.set(chip.r.x,chip.r.y,chip.r.z);m.scale.copy(chip.scale).multiplyScalar(Math.min(1,chip.life/.25));m.updateMatrix();this.chips.setMatrixAt(i,m.matrix);
  });this.chips.count=this.chipPool.length;this.chips.instanceMatrix.needsUpdate=true;
 }
 reset(){this.pool=[];this.dustPool=[];this.chipPool=[];this.flash.intensity=0;this.points.geometry.setDrawRange(0,0);this.streaks.geometry.setDrawRange(0,0);this.dust.geometry.setDrawRange(0,0);this.chips.count=0;}
}
