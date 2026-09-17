// Measure floor-reflection flicker between consecutive PNG stills of the game.
// Usage: node scripts/measure-reflection-flicker.mjs <dir-or-pngs...> [--region x0,y0,x1,y1]... [--control x0,y0,x1,y1]
//   With a directory, every *.png in it is taken in captures.json order (or name order).
//   Default regions are the wet centre of the nave either side of the player at the standard
//   fight camera (1600x813 headless): [100,330,700,800] and [900,330,1500,800]; boxes are clamped
//   to the frame. The control region is a
//   patch of static wall used as the noise floor (film grain + dither).
// Reports, per consecutive pair: mean absolute luminance change (8-bit levels), the share and
// count of "sparkle" pixels (delta > 40) and of "shimmer" pixels (delta > 20), plus the mean
// luma and the count of bright specks (luma > 110) in each frame.
// No dependencies: a minimal PNG decoder (8-bit RGB/RGBA, non-interlaced) lives below.
import {readFileSync, readdirSync, existsSync, statSync} from 'node:fs';
import {inflateSync} from 'node:zlib';
import path from 'node:path';

export function decodePNG(buffer){
 if(buffer.readUInt32BE(0)!==0x89504e47)throw new Error('not a PNG');
 let pos=8,width=0,height=0,bitDepth=0,colorType=0,interlace=0;const idat=[];
 while(pos<buffer.length){
  const len=buffer.readUInt32BE(pos),type=buffer.toString('ascii',pos+4,pos+8),data=buffer.subarray(pos+8,pos+8+len);
  if(type==='IHDR'){width=data.readUInt32BE(0);height=data.readUInt32BE(4);bitDepth=data[8];colorType=data[9];interlace=data[12];}
  else if(type==='IDAT')idat.push(data);
  else if(type==='IEND')break;
  pos+=12+len;
 }
 if(bitDepth!==8||interlace!==0)throw new Error(`unsupported PNG: depth ${bitDepth}, interlace ${interlace}`);
 const channels={0:1,2:3,4:2,6:4}[colorType];if(!channels)throw new Error('unsupported colour type '+colorType);
 const bpp=channels,stride=width*bpp,raw=inflateSync(Buffer.concat(idat));
 const out=new Uint8Array(width*height*channels);
 let prev=new Uint8Array(stride),inPos=0;
 for(let y=0;y<height;y++){
  const f=raw[inPos++];const line=raw.subarray(inPos,inPos+stride);inPos+=stride;
  const cur=new Uint8Array(stride);
  for(let i=0;i<stride;i++){
   const a=i>=bpp?cur[i-bpp]:0,b=prev[i],c=i>=bpp?prev[i-bpp]:0;let x=line[i];
   if(f===1)x+=a;else if(f===2)x+=b;else if(f===3)x+=(a+b)>>1;
   else if(f===4){const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);x+=(pa<=pb&&pa<=pc)?a:(pb<=pc?b:c);}
   cur[i]=x&255;
  }
  out.set(cur,y*stride);prev=cur;
 }
 return {width,height,channels,data:out};
}

export function luminance(png){
 const {width,height,channels,data}=png,out=new Float32Array(width*height);
 for(let i=0,j=0;i<out.length;i++,j+=channels)out[i]=.2126*data[j]+.7152*data[j+1]+.0722*data[j+2];
 return out;
}

export function compare(lumaA,lumaB,width,[x0,y0,x1,y1]){
 const height=lumaA.length/width;x0=Math.max(0,x0);y0=Math.max(0,y0);x1=Math.min(width,x1);y1=Math.min(height,y1);
 let sum=0,n=0,sparkle=0,shimmer=0,meanA=0,meanB=0,specksA=0,specksB=0;
 for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){
  const i=y*width+x,a=lumaA[i],b=lumaB[i],d=Math.abs(a-b);
  sum+=d;n++;if(d>40)sparkle++;if(d>20)shimmer++;meanA+=a;meanB+=b;if(a>110)specksA++;if(b>110)specksB++;
 }
 return {pixels:n,meanDelta:sum/n,sparkle,sparklePct:100*sparkle/n,shimmer,shimmerPct:100*shimmer/n,meanA:meanA/n,meanB:meanB/n,specksA,specksB};
}

const parseBox=s=>s.split(',').map(Number);
function main(){
 const args=process.argv.slice(2),regions=[],controls=[],inputs=[];
 for(let i=0;i<args.length;i++){
  if(args[i]==='--region')regions.push(parseBox(args[++i]));
  else if(args[i]==='--control')controls.push(parseBox(args[++i]));
  else inputs.push(args[i]);
 }
 if(!regions.length)regions.push([100,330,700,800],[900,330,1500,800]);
 if(!controls.length)controls.push([1380,150,1580,330]);
 let files=[];
 for(const input of inputs){
  if(existsSync(input)&&statSync(input).isDirectory()){
   const manifest=path.join(input,'captures.json');
   if(existsSync(manifest)){const j=JSON.parse(readFileSync(manifest,'utf8'));files.push(...j.results.map(r=>r.file).filter(f=>f.endsWith('.png')).map(f=>path.isAbsolute(f)?f:path.resolve(process.cwd(),f)));}
   else files.push(...readdirSync(input).filter(f=>f.endsWith('.png')).sort().map(f=>path.join(input,f)));
  }else files.push(input);
 }
 if(files.length<2){console.error('need at least two PNGs');process.exit(1);}
 const frames=files.map(f=>{const png=decodePNG(readFileSync(f));return {file:f,width:png.width,height:png.height,luma:luminance(png)};});
 const width=frames[0].width;
 const rows=[];
 for(let i=1;i<frames.length;i++){
  const a=frames[i-1],b=frames[i];
  if(a.width!==b.width||a.height!==b.height)throw new Error('frame sizes differ');
  const region=regions.map(r=>compare(a.luma,b.luma,width,r));
  const control=controls.map(r=>compare(a.luma,b.luma,width,r));
  const merge=list=>{const n=list.reduce((s,r)=>s+r.pixels,0);return {pixels:n,meanDelta:list.reduce((s,r)=>s+r.meanDelta*r.pixels,0)/n,sparkle:list.reduce((s,r)=>s+r.sparkle,0),shimmer:list.reduce((s,r)=>s+r.shimmer,0),meanA:list.reduce((s,r)=>s+r.meanA*r.pixels,0)/n,specksA:list.reduce((s,r)=>s+r.specksA,0),specksB:list.reduce((s,r)=>s+r.specksB,0)};};
  const R=merge(region),C=merge(control);
  rows.push({pair:`${path.basename(a.file,'.png')}->${path.basename(b.file,'.png')}`,region:R,control:C});
 }
 console.log(`${frames.length} frames, ${width}x${frames[0].height}; regions ${JSON.stringify(regions)} control ${JSON.stringify(controls)}`);
 console.log('pair                 | mean|d| | sparkle(>40) | shimmer(>20) | mean luma | specks(>110) A->B | control mean|d| / sparkle');
 for(const r of rows)console.log(`${r.pair.padEnd(20)} | ${r.region.meanDelta.toFixed(2).padStart(7)} | ${String(r.region.sparkle).padStart(6)} ${(100*r.region.sparkle/r.region.pixels).toFixed(3).padStart(6)}% | ${String(r.region.shimmer).padStart(6)} ${(100*r.region.shimmer/r.region.pixels).toFixed(2).padStart(6)}% | ${r.region.meanA.toFixed(1).padStart(7)} | ${String(r.region.specksA).padStart(5)} -> ${String(r.region.specksB).padStart(5)} | ${r.control.meanDelta.toFixed(2)} / ${r.control.sparkle}`);
 const avg=k=>rows.reduce((s,r)=>s+r.region[k],0)/rows.length;
 console.log(`AVERAGE mean|d| ${avg('meanDelta').toFixed(2)}  sparkle ${avg('sparkle').toFixed(0)}  shimmer ${avg('shimmer').toFixed(0)}  control mean|d| ${(rows.reduce((s,r)=>s+r.control.meanDelta,0)/rows.length).toFixed(2)}`);
 console.log(JSON.stringify({files,rows},null,0));
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(new URL(import.meta.url).pathname))main();
