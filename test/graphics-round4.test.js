// Round 4 (17 Sep 2026): the "black circle" (an undefined pow() in the shock ring that went NaN on Apple GPUs),
// the blade-spine fire, and the numbers the user asked to nudge.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import * as T from 'three';
import {bladeSpine,createWeaponFire,SPINE_STATIONS} from '../src/game/weapon-fire.js';

const GAME=new URL('../src/game/',import.meta.url);
const source=name=>readFileSync(new URL(name,GAME),'utf8');

test('no GLSL pow() in the game is left with a base that can go negative',()=>{
 // pow(x,y) is undefined for x<0 in GLSL ES and returns NaN on ANGLE Metal (probes/pow-nan.js): every base is
 // wrapped in max(), clamp() or abs(). Math.pow (JavaScript) and comments are not shader code.
 const offenders=[];
 for(const name of readdirSync(GAME)){
  if(!name.endsWith('.js'))continue;
  const text=source(name);
  const lines=text.split('\n');
  lines.forEach((line,i)=>{
   const code=line.replace(/\/\/.*$/,'');
   for(const match of code.matchAll(/(?<![\w.])pow\s*\(\s*([a-zA-Z_][\w]*)?\s*\(?/g)){
    const after=code.slice(match.index+match[0].indexOf('(')+1).replace(/^\s+/,'');
    if(/^(max|clamp|abs)\s*\(/.test(after))continue;
    offenders.push(`${name}:${i+1}: ${code.trim().slice(0,90)}`);
   }
  });
 }
 assert.deepEqual(offenders,[],'unguarded pow() bases:\n'+offenders.join('\n'));
});

test('the shock ring is a square, not pow(), and the sample coordinate is fenced',()=>{
 const text=source('rendering.js');
 assert.ok(!/pow\(\(r-uShock/.test(text),'the old pow((r-uShock.z)*7.,2.) is gone');
 assert.ok(text.includes('float k=(r-uShock.z)*7.;float wave=exp(-k*k)*uShock.w;'),'the ring falls off on k*k');
 assert.ok(text.includes('if(any(isnan(uv))||any(isinf(uv)))uv=vUv;'),'a NaN or Inf coordinate falls back to the pixel itself');
 // The window projections were the other exp(-pow(negative,2.)) in the game.
 const arena=source('arena.js');
 assert.ok(arena.includes('exp(-m1*m1)+exp(-m2*m2)')&&arena.includes('exp(-tr*tr)'),'window mullions and transom are squares');
});

test('bloom and the fill are up the little the user asked for',()=>{
 assert.ok(source('rendering.js').includes('new CathedralBloom(.68,.82,.56)'),'bloom .68 strength, .56 threshold');
 assert.ok(source('arena.js').includes('new T.HemisphereLight(0x53707f,0x080604,.24)'),'hemisphere fill .24');
});

test('the fighting floor carries the generated seal decal instead of the iron hoops',()=>{
 const arena=source('arena.js');
 assert.ok(!arena.includes("for(const radius of [4.8,4.95,5.15])"),'the three torus hoops are gone');
 assert.ok(arena.includes("seal.name='floor seal'")&&arena.includes('sealHeat(value)'),'one decal mesh with a heat hook');
 for(const file of ['floor-seal.png','floor-seal-nr.png'])assert.ok(existsSync(new URL('../assets/environment/'+file,import.meta.url)),file+' exists');
 assert.ok(source('main.js').includes("arena?.sealHeat?.(1)"),'the phase change heats the seal');
});

/** A blade mesh whose centre bows away from the chord: z = bow * t^2 along y from 0.28 to 1.27 (the exile's sword
 * measured 0.23 m at the tip), with a thin flat side along x. */
function curvedBlade(bow,{width=.03,thickness=.006}={}){
 const positions=[];
 for(let i=0;i<=60;i++){const t=i/60,y=.28+t*.99,z=bow*t*t;
  for(const [dx,dz] of [[-thickness,-width],[thickness,-width],[-thickness,width],[thickness,width]])positions.push(dx,y,z+dz);}
 const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));
 const mesh=new T.Mesh(geometry,new T.MeshStandardMaterial());
 const wrapper=new T.Group();wrapper.add(mesh);
 return wrapper;
}

test('bladeSpine follows a curved blade and returns the chord for a straight one',()=>{
 const a=new T.Vector3(0,.28,0),b=new T.Vector3(0,1.27,0);
 const curved=bladeSpine(curvedBlade(.23),a,b);
 assert.equal(curved.points.length,SPINE_STATIONS);
 assert.ok(curved.bow>.17&&curved.bow<.24,`bow ${curved.bow.toFixed(3)} follows the 0.23 m tip offset`);
 // Monotonic bow toward the tip, on the +z side, and x stays on the chord.
 for(let i=1;i<curved.points.length;i++)assert.ok(curved.points[i].z>=curved.points[i-1].z-1e-6,'the bow grows toward the tip');
 assert.ok(curved.points.at(-1).z>.15&&Math.abs(curved.points.at(-1).x)<.01);
 assert.ok(Math.abs(curved.thin.x)>.99,'the flat side of the blade is x');
 const straight=bladeSpine(curvedBlade(0),a,b);
 assert.ok(straight.bow<.005,'a straight blade sits on its chord');
 const none=bladeSpine(new T.Group(),a,b);
 assert.equal(none.filled,0);assert.ok(none.bow===0&&none.points[0].distanceTo(a)<.1,'no steel: the segment itself');
});

test('the weapon fire is built on the spine: ribbons bend in the shader, embers and light sit on the steel',()=>{
 const wrapper=curvedBlade(.23);const scene=new T.Scene();scene.add(wrapper);
 const fire=createWeaponFire(wrapper,[[0,.28,0],[0,1.27,0]],{scene,boss:false,embers:8,gain:.55});
 assert.ok(fire.spine.bow>.17);
 const sheet=fire.sheets[1];
 assert.equal(sheet.uniforms.uSpine.value.length,SPINE_STATIONS);
 assert.ok(sheet.mesh.material.vertexShader.includes('spineAt('),'the ribbon vertex shader bends along the spine');
 // The spine in the group frame keeps its bow (the group's X is the chord).
 const local=sheet.uniforms.uSpine.value;
 assert.ok(Math.hypot(local.at(-1).y,local.at(-1).z)>.15,'the bow survives in the group frame');
 assert.ok(Math.abs(local[0].x+local.at(-1).x)<.05,'stations run symmetrically along the chord');
 // The light: on the spine at .55, pushed off the flat of the blade, linear falloff, dimmer than before.
 const camera=new T.PerspectiveCamera();camera.position.set(3,1,0);camera.updateMatrixWorld();
 fire.update(1/60,0,{heat:1,camera});
 assert.equal(fire.light.decay,1);
 assert.ok(fire.light.intensity<.8,'the exile light peaks under .8');
 assert.ok(Math.abs(fire.light.position.x-.12)<.02,'the light is .12 m off the flat side, toward the camera');
 assert.ok(fire.light.position.z>.04,'and on the bowed steel, not on the chord');
 // The boss's strike flare: taller flames at full heat, inverse-square light kept.
 const boss=createWeaponFire(curvedBlade(.07),[[0,.28,0],[0,1.27,0]],{scene,boss:true,embers:8});
 boss.update(1/60,0,{heat:1});boss.update(1/60,.1,{heat:1});
 const tall=boss.sheets[1].uniforms.uHeight.value;
 const exile=fire.sheets[1].uniforms.uHeight.value;
 assert.ok(tall>exile*1.2,`the boss's flames stand ${tall.toFixed(2)} against the exile's ${exile.toFixed(2)}`);
 assert.equal(boss.light.decay,2);
});
