// Player bundle V18 = V17 + light2 (the light combo's second hit). One-line fallback to V17: swap v18 -> v17 here and in playerRig below.
import playerMotion from '../../docs/player-motion-revision-3/player-video-candidate-v18-manifest.json' with {type:'json'};
// Round 3 (16 Sep evening): the fissure, faster/rarer sweep and slam. One-line fallback: boss-round2-manifest.json.
import bossMotion from '../../docs/boss-round3-manifest.json' with {type:'json'};
import {withActorScale} from './actor-scale.js';
// Round 2 (stream FX): the user's chosen combat sounds. Each key in the JSON is a
// list of local takes under assets/sfx/; the game picks one per play and never
// repeats the last (src/game/audio.js). Extend or swap takes by editing the JSON
// alone. Under Vite every mp3 in assets/sfx/ is resolved (and hashed in a build)
// by the glob; Node (tests, scripts) has no import.meta.env and takes plain URLs.
import soundsChosen from '../../docs/round-2-2026-09-16/sounds-chosen.json' with {type:'json'};
const SFX_URLS=import.meta.env?import.meta.glob('../../assets/sfx/**/*.mp3',{eager:true,query:'?url',import:'default'}):{};
const sfxUrl=relative=>SFX_URLS['../../'+relative]??new URL('../../'+relative,import.meta.url).href;
const chosenSounds=(key,fallback)=>{const takes=(Array.isArray(soundsChosen[key])?soundsChosen[key]:[soundsChosen[key]]).filter(take=>typeof take==='string'&&take.endsWith('.mp3')).map(sfxUrl);return takes.length?takes:fallback;};
export const ASSETS={
 playerRig:new URL('../../assets/player-motion-revision-3/player-video-candidate-v18.glb',import.meta.url).href, // V17 fallback: player-video-candidate-v17.glb + the v17 manifest import above
 bossRig:new URL('../../assets/production/boss-supported-combat.glb',import.meta.url).href,
 scythe:new URL('../../assets/idle-video-motion/scythe-fitted.glb',import.meta.url).href,
 scytheHeight:2.85,
 motion:{player:playerMotion,boss:withActorScale(bossMotion,1.3)},
 footstep:new URL('../../assets/a-single-muted-heavy-armored-boot-footst-cmu1i7mt.mp3',import.meta.url).href,
 playerShield:new URL('../../assets/create-the-exact-isolated-player-shield-cmu12nf3.glb',import.meta.url).href,
 playerSword:new URL('../../assets/create-the-exact-isolated-player-sword-s-cmu12ngf.glb',import.meta.url).href,
 stone:new URL('../../assets/ancient-gothic-cathedral-limestone-mason-cmu1fw79.png',import.meta.url).href,
 floor:new URL('../../assets/ancient-dark-cathedral-flagstone-floor-l-cmu1fw8c.png',import.meta.url).href,
 music:new URL('../../assets/seamless-loop-no-intro-or-outro-dark-got-cmu1fw9k.mp3',import.meta.url).href,
 impact:new URL('../../assets/one-powerful-heavy-steel-scythe-impact-a-cmu1fwan.mp3',import.meta.url).href,
 swing:new URL('../../assets/one-heavy-two-handed-scythe-swing-whoosh-cmu1fwbo.mp3',import.meta.url).href,
 groundSlam:new URL('../../assets/sfx/boss-ground-slam-cmu37r5d.mp3',import.meta.url).href,
 darkFire:new URL('../../assets/sfx/scythe-dark-fire-cmu37rdp.mp3',import.meta.url).href,
 bossRoar:new URL('../../assets/sfx/boss-awaken-roar-cmu37rfo.mp3',import.meta.url).href,
 // Cathedral surfaces and fittings (stream A). The banner atlas, lancet glass
 // and wall grunge are cropped and de-fringed copies of the generated PNGs.
 cathedralFloor:new URL('../../assets/seamless-tiling-ancient-cathedral-flagst-cmu38eyn.jpg',import.meta.url).href,
 cathedralWall:new URL('../../assets/seamless-tiling-weathered-gothic-limesto-cmu38f00.jpg',import.meta.url).href,
 cathedralOak:new URL('../../assets/seamless-tiling-very-dark-oxidised-oak-c-cmu38f1h.jpg',import.meta.url).href,
 cathedralMetal:new URL('../../assets/seamless-tiling-tarnished-brass-and-wrou-cmu38f45.jpg',import.meta.url).href,
 lancetGlass:new URL('../../assets/environment/lancet-glass.png',import.meta.url).href,
 bannerAtlas:new URL('../../assets/environment/banner-atlas.png',import.meta.url).href,
 wallGrunge:new URL('../../assets/environment/wall-grunge.png',import.meta.url).href,
 windowCookie:new URL('../../assets/greyscale-light-cookie-gobo-mask-three-t-cmu38gk1.png',import.meta.url).href,
 // Cloth relief and the chancel swag row (stream A, second session). Both were
 // generated last night and were sitting on disk wired to nothing.
 bannerDamask:new URL('../../assets/environment/banner-damask.jpg',import.meta.url).href,
 valanceSwag:new URL('../../assets/environment/valance-swag.png',import.meta.url).href,
 // Round 2, 16 Sep (stream ENV): three floor paving sets blended by a world-
 // space zone mask, the wall relief and a debris sprite sheet. The texture lane
 // returns base colour only on this account, so every *-nr.png is a normal map
 // (xyz) with roughness packed in alpha, derived from the photograph by
 // scripts/derive-pbr-maps.py. The wall relief is derived from cathedralWall
 // itself so its joints and streaks match the albedo exactly.
 floorFlagstoneGrey:new URL('../../assets/environment/floor-flagstone-grey.jpg',import.meta.url).href,
 floorFlagstoneGreyNR:new URL('../../assets/environment/floor-flagstone-grey-nr.png',import.meta.url).href,
 floorChequer:new URL('../../assets/environment/floor-chequer.jpg',import.meta.url).href,
 floorChequerNR:new URL('../../assets/environment/floor-chequer-nr.png',import.meta.url).href,
 // Round 2 follow-up (16 Sep evening): two darker nave sets, switchable in the pause menu (Floor).
 floorBasalt:new URL('../../assets/environment/floor-basalt.jpg',import.meta.url).href,
 floorBasaltNR:new URL('../../assets/environment/floor-basalt-nr.png',import.meta.url).href,
 floorMarble:new URL('../../assets/environment/floor-marble-diagonal.jpg',import.meta.url).href,
 floorMarbleNR:new URL('../../assets/environment/floor-marble-diagonal-nr.png',import.meta.url).href,
 floorTomb:new URL('../../assets/environment/floor-tomb.jpg',import.meta.url).href,
 floorTombNR:new URL('../../assets/environment/floor-tomb-nr.png',import.meta.url).href,
 wallAshlarNR:new URL('../../assets/environment/wall-ashlar-nr.png',import.meta.url).href,
 debrisAtlas:new URL('../../assets/environment/debris-atlas.png',import.meta.url).href,
 // Round 3 (16 Sep evening, graphics pass): a 2x2 atlas of floor damage decals (shattered slab, crack, crater,
 // rubble scatter), de-fringed copy of the generated sheet, laid over the fighting floor by arena.js.
 floorDamageAtlas:new URL('../../assets/environment/floor-damage-atlas.png',import.meta.url).href,
 // Round 4 (17 Sep, afternoon): the funerary seal inlaid in the fighting floor, a generated top-down inlay with alpha
 // between the metal (prepared by scripts/prepare-floor-seal.py) and a normal map derived from it.
 floorSeal:new URL('../../assets/environment/floor-seal.png',import.meta.url).href,
 floorSealNR:new URL('../../assets/environment/floor-seal-nr.png',import.meta.url).href,
 // The user's chosen combat sounds (round 2, stream FX): lists of takes from
 // docs/round-2-2026-09-16/sounds-chosen.json, falling back to the old pair.
 playerHitArmor:chosenSounds('playerHitArmor',[new URL('../../assets/one-powerful-heavy-steel-scythe-impact-a-cmu1fwan.mp3',import.meta.url).href]),
 bossSwing:chosenSounds('bossSwing',[new URL('../../assets/one-heavy-two-handed-scythe-swing-whoosh-cmu1fwbo.mp3',import.meta.url).href]),
 bossHitPlayer:chosenSounds('bossHitPlayer',[new URL('../../assets/one-powerful-heavy-steel-scythe-impact-a-cmu1fwan.mp3',import.meta.url).href]),
 playerSwing:chosenSounds('playerSwing',[new URL('../../assets/one-heavy-two-handed-scythe-swing-whoosh-cmu1fwbo.mp3',import.meta.url).href]),
 playerFootstep:chosenSounds('playerFootstep',[new URL('../../assets/a-single-muted-heavy-armored-boot-footst-cmu1i7mt.mp3',import.meta.url).href]),
 block:chosenSounds('block',[new URL('../../assets/one-powerful-heavy-steel-scythe-impact-a-cmu1fwan.mp3',import.meta.url).href]),
};

// Phone copies (17 Sep 2026, the mobile pass): the same models with their 4096-square maps resized to 1024 by
// scripts/make-mobile-assets.py (mesh, rig, clips and materials byte-for-byte the same), and the seal at 1024.
// main.js swaps these in on the touch path only; the desktop never reads this table.
export const MOBILE_ASSETS={
 playerRig:new URL('../../assets/mobile/player-video-candidate-v18.glb',import.meta.url).href,
 bossRig:new URL('../../assets/mobile/boss-supported-combat.glb',import.meta.url).href,
 scythe:new URL('../../assets/mobile/scythe-fitted.glb',import.meta.url).href,
 playerSword:new URL('../../assets/mobile/player-sword.glb',import.meta.url).href,
 playerShield:new URL('../../assets/mobile/player-shield.glb',import.meta.url).href,
 monument:new URL('../../assets/mobile/funerary-monument.glb',import.meta.url).href,
 monumentLod:new URL('../../assets/mobile/funerary-monument-lod.glb',import.meta.url).href,
 floorSeal:new URL('../../assets/mobile/floor-seal.png',import.meta.url).href,
 floorSealNR:new URL('../../assets/mobile/floor-seal-nr.png',import.meta.url).href,
};

// Music track choices (pause menu, Music track). 'cathedral' is ASSETS.music, the default.
// The two darker alternatives were generated on 16 Sep 2026 evening (docs/asset-plan.md).
export const MUSIC_TRACKS={
 cathedral:ASSETS.music,
 dread:new URL('../../assets/a-dark-gothic-boss-battle-theme-slow-and-cmu4dws4.mp3',import.meta.url).href,
 steady:new URL('../../assets/music/brooding-vigil.mp3',import.meta.url).href,
 bells:new URL('../../assets/very-dark-ambient-orchestral-theme-for-a-cmu4dwyf.mp3',import.meta.url).href,
};
