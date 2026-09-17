import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
const jobs = JSON.parse(readFileSync('docs/model-preview-jobs.json', 'utf8'));
const selection = JSON.parse(readFileSync('docs/approved-selection.json', 'utf8'));
const info = {
  'player-body': ['Thorn Exile', 'PLAYER / BODY', 'Sculpted dark armor, ivory crescent pauldron, narrow masked silhouette.', 'Empty hands. Shield, sword, plume and loose cloth are separate attachments. The cloth toggle shows a static layout made in code.'],
  'player-shield': ['Cathedral shield', 'PLAYER / SHIELD', 'A separate pointed shield with silver tracery and a dark inset face.', 'Generated on its own. No shield is baked into the player body.'],
  'player-sword': ['Thorn flamberge', 'PLAYER / SWORD', 'An independent weapon with a slender, undulating blade.', 'Separate geometry for the weapon grip, combat movement and hit detection.'],
  'boss-body': ['Reliquary Saint', 'BOSS / BODY', 'A funerary mask, branching limbs and an exposed golden chest relic.', 'Static model review. The unusual limb structure needs its own articulation plan before animation.'],
  'boss-blade': ['Reliquary blade', 'BOSS / WEAPON', 'A long bone execution blade with an elaborate hooked grip.', 'Separate from the boss body so its attacks can move the weapon independently.']
};
const url = path => path ? `new URL(${JSON.stringify('../../' + path)}, import.meta.url).href` : 'null';
const entries = jobs.map(job => {
  const [title, part, description, note] = info[job.key];
  const concept = job.key.startsWith('player') ? selection.player.conceptImage : selection.boss.conceptImage;
  return `{...${JSON.stringify({ key: job.key, title, part, description, note, frontYaw: job.frontYaw ?? 0 })}, modelUrl: ${url(job.localPath)}, inputUrl: ${url(job.inputPath)}, conceptUrl: ${url(concept)}}`;
});
const rigFolder='assets/rigs/reliquary-saint/';
if (existsSync(rigFolder+'reliquary-saint-armed-rig.glb')) {
  const rig={key:'boss-rig',title:'Reliquary Saint · Rig',part:'BOSS / CUSTOM RIG',frontYaw:0,
    description:'Eight independent arms, articulated claws, two legs and separate weapon sockets.',
    note:'Custom Blender skeleton. Use the static pose checks and skeleton overlay to inspect deformation. The Blender file includes hand/foot contact controls. Combat animation is a later stage.',isRig:true};
  entries.splice(4,0,`{...${JSON.stringify(rig)},modelUrl:${url(rigFolder+'reliquary-saint-armed-rig.glb')},downloadUrl:${url(rigFolder+'reliquary-saint-rig.glb')},blendUrl:${url(rigFolder+'reliquary-saint-rig.blend')},poseUrl:${url(rigFolder+'diagnostic-poses.json')},inputUrl:${url('assets/prepare-a-precise-3d-modeling-input-from-cmu12gd4.png')},conceptUrl:${url(selection.boss.conceptImage)}}`);
}
mkdirSync('src/preview', { recursive: true });
writeFileSync('src/preview/assets.generated.js', `// Generated from docs/model-preview-jobs.json. All URLs are bundled local files.\nexport const assets = [\n${entries.join(',\n')}\n];\n`);
