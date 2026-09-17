const EPS=1e-6;
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));

/** Swept discs: clip at the first surface, then preserve tangential travel. */
export function slideGround(position,delta,radius,bounds,obstacles=[]){
 const limits={minX:bounds.minX+radius,maxX:bounds.maxX-radius,minZ:bounds.minZ+radius,maxZ:bounds.maxZ-radius};
 const p={x:clamp(position.x,limits.minX,limits.maxX),z:clamp(position.z,limits.minZ,limits.maxZ)};
 const circles=obstacles.map(o=>({x:o.x,z:o.z,r:o.radius+radius}));
 const valid=c=>c.x>=limits.minX-EPS&&c.x<=limits.maxX+EPS&&c.z>=limits.minZ-EPS&&c.z<=limits.maxZ+EPS&&circles.every(o=>Math.hypot(c.x-o.x,c.z-o.z)>=o.r-EPS);
 // A reset/edge body separation may begin inside a base. Find the nearest legal
 // rim point, including rim/wall intersections, instead of pushing into a wall.
 for(const o of circles){
  if(Math.hypot(p.x-o.x,p.z-o.z)>=o.r-EPS)continue;
  const angle=Math.atan2(p.z-o.z,p.x-o.x),candidates=[];
  for(const a of [angle,0,Math.PI/2,Math.PI,Math.PI*1.5])candidates.push({x:o.x+Math.cos(a)*(o.r+EPS),z:o.z+Math.sin(a)*(o.r+EPS)});
  for(const x of [limits.minX,limits.maxX]){const q=o.r*o.r-(x-o.x)**2;if(q>=0)for(const sign of [-1,1])candidates.push({x,z:o.z+sign*Math.sqrt(q)});}
  for(const z of [limits.minZ,limits.maxZ]){const q=o.r*o.r-(z-o.z)**2;if(q>=0)for(const sign of [-1,1])candidates.push({x:o.x+sign*Math.sqrt(q),z});}
  const nearest=candidates.filter(valid).sort((a,b)=>Math.hypot(a.x-p.x,a.z-p.z)-Math.hypot(b.x-p.x,b.z-p.z))[0];
  if(nearest)Object.assign(p,nearest);
 }
 let remaining={...delta};
 for(let pass=0;pass<6&&Math.hypot(remaining.x,remaining.z)>EPS;pass++){
  let hit=null;
  const consider=(t,nx,nz)=>{if(t>=-EPS&&t<=1&&remaining.x*nx+remaining.z*nz<-EPS&&(!hit||t<hit.t))hit={t:Math.max(0,t),nx,nz};};
  if(remaining.x<0)consider((limits.minX-p.x)/remaining.x,1,0);
  if(remaining.x>0)consider((limits.maxX-p.x)/remaining.x,-1,0);
  if(remaining.z<0)consider((limits.minZ-p.z)/remaining.z,0,1);
  if(remaining.z>0)consider((limits.maxZ-p.z)/remaining.z,0,-1);
  const a=remaining.x**2+remaining.z**2;
  for(const o of circles){
   const x=p.x-o.x,z=p.z-o.z,b=x*remaining.x+z*remaining.z,c=x*x+z*z-o.r*o.r,discriminant=b*b-a*c;
   if(discriminant<0)continue;
   const t=(-b-Math.sqrt(discriminant))/a;
   if(t>=-EPS&&t<=1){const nx=(x+remaining.x*t)/o.r,nz=(z+remaining.z*t)/o.r;consider(t,nx,nz);}
  }
  if(!hit){p.x+=remaining.x;p.z+=remaining.z;break;}
  const travel=hit.t;
  p.x+=remaining.x*travel;p.z+=remaining.z*travel;
  remaining.x*=1-hit.t;remaining.z*=1-hit.t;
  const inward=remaining.x*hit.nx+remaining.z*hit.nz;
  remaining.x-=inward*hit.nx;remaining.z-=inward*hit.nz;
 }
 position.x=clamp(p.x,limits.minX,limits.maxX);position.z=clamp(p.z,limits.minZ,limits.maxZ);
 return position;
}
