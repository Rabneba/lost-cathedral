import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

// Regression fence around stream A's cathedral work. buildArena needs a DOM, a
// GPU and a network, so this reads the sources instead: every one of these
// assertions is a bug that actually shipped and was invisible in the console.
const read=name=>readFileSync(new URL('../src/game/'+name,import.meta.url),'utf8');
const arena=read('arena.js'),weathering=read('stone-weathering.js'),paths=read('asset-paths.js'),dressing=read('set-dressing.js');

test('the arena wins the texture-path merge, so the cathedral maps are not dead code',()=>{
 // main.js passes the two legacy 2024 maps. For months the spread ran the other
 // way round, which put them LAST - so they won, and every map generated for
 // this room was loaded, uploaded and never drawn.
 const line=arena.split('\n').find(l=>l.includes('texturePaths={')&&l.includes('cathedralWall'));
 assert.ok(line,'buildArena no longer normalises texturePaths');
 assert.ok(line.indexOf('...texturePaths')<line.indexOf('cathedralWall'),
  'the spread must come FIRST or main.js\'s legacy maps override the cathedral set');
 // Round 2 (16 Sep, ENV): the floor's own set is the grey flagstone with its
 // derived relief; the chequer and tomb sets are blended in by the shader.
 assert.match(line,/floor:\{map:ASSETS\.floorFlagstoneGrey,normalMap:ASSETS\.floorFlagstoneGreyNR\}/);
});

test('every asset path in the table exists on disk',()=>{
 for(const [,relative] of paths.matchAll(/new URL\('([^']+)',import\.meta\.url\)/g)){
  const file=fileURLToPath(new URL(relative,new URL('../src/game/asset-paths.js',import.meta.url)));
  assert.ok(existsSync(file),`missing asset: ${relative}`);
 }
});

test('the wet mix stays the LAST statement in the floor roughness block',()=>{
 // The puddles are the one thing the user asked to keep. Any roughness written
 // after this mix (a roughnessMap, a damp term, a joint term) makes the pools
 // matte and the reflections vanish, with no error anywhere.
 const block=weathering.split('#include <roughnessmap_fragment>').pop();
 assert.ok(block,'the floor roughness injection is gone');
 const assignments=[...block.matchAll(/roughnessFactor\s*[-+]?=/g)];
 assert.ok(assignments.length>=4,'the floor roughness injection has been gutted');
 const last=assignments[assignments.length-1];
 // The value itself is tuned (round 2 review took it .055 -> .19, because a
 // mirror-smooth wet patch has no diffuse left and went black off the specular
 // lobe); what this fence pins is that it stays LAST.
 assert.match(block.slice(last.index,last.index+56),/roughnessFactor=mix\(roughnessFactor,\.\d+,wet\)/,
  'something writes roughness AFTER the wet mix - the puddles go matte and the reflections vanish');
});

test('procedural stone relief survives alongside any normal map',()=>{
 // arena.js zeroes bumpScale the moment a normalMap appears, and ALL of the
 // procedural ashlar and flagstone relief lives behind USE_BUMPMAP. Binding a
 // normal map without keeping bumpMap bound silently deletes it.
 assert.match(arena,/if\(m\.normalMap\)\{[^}]*m\.bumpMap=m\.map;m\.bumpScale=0;/,
  'bumpMap must stay bound at scale 0 so perturbNormalArb stays in scope');
 assert.match(weathering,/#ifdef USE_BUMPMAP[\s\S]*perturbNormalArb/);
});

test('the shader program cache keys are versioned together',()=>{
 // three silently reuses a cached program when the key does not change, and
 // none of the night's shader work appears.
 assert.match(weathering,/weathered-stone-\$\{[^}]+\}-v9/);
 assert.match(read('banners.js'),/vesper-banner-wind-v3/);
});

test('nothing in the set dressing creates a collider or enters the fight box',()=>{
 // cameraOrbitPosition ray-tests every Box3 against up to 13 orbit candidates
 // per frame, and a collider on a 2 cm handrail makes the camera snap on it.
 // Comments are allowed to MENTION them; the code may not call them.
 const code=dressing.split('\n').filter(l=>!l.trim().startsWith('//')).join('\n');
 assert.doesNotMatch(code,/cameraBox|groundColliders\.push|new T\.Box3/);
 // The playable floor is |x| <= 9.5, -15.5 <= z <= 16.
 for(const [,x] of dressing.matchAll(/railRun\(ctx,side\*\(shoved\?([\d.]+):([\d.]+)\)/g))assert.ok(Number(x)>9.5);
});

test('the height fog patch cannot be left half-applied',()=>{
 const rendering=read('rendering.js');
 // scene.fog must stay a non-null Fog instance or three strips the chunks and
 // the whole patch silently does nothing.
 assert.match(rendering,/scene\.fog=new T\.FogExp2/);
 for(const chunk of ['fog_pars_vertex','fog_vertex','fog_pars_fragment','fog_fragment'])
  assert.ok(rendering.includes('T.ShaderChunk.'+chunk+'='),`fog chunk ${chunk} not patched`);
 assert.ok(rendering.indexOf('T.ShaderChunk.fog_vertex')<rendering.indexOf('export function createRendering'),
  'the fog chunks must be patched at module scope, before any material compiles');
 assert.match(rendering,/varying vec3 vFogWorld;/);
});
