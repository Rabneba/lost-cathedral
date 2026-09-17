import test from 'node:test';
import assert from 'node:assert/strict';
import {gamePlaybackRate} from '../src/preview/game-pace.js';
import {ASSETS} from '../src/game/asset-paths.js';

test('studio game pace matches forward, lateral, retreat and guard travel with the current clips',()=>{
 const metadata=ASSETS.motion.player;
 // Speeds come from the selected manifest: V7 lowered locomotionSpeed to 2.6 for the treadmill capture.
 for(const [clip,speed] of [['run-forward',metadata.locomotionSpeed],['run-left',metadata.strafeSpeed],['run-backward',metadata.retreatSpeed],['walk-left',metadata.guardSpeed]])
  assert.ok(Math.abs(gamePlaybackRate('player',clip,metadata)*metadata.clips[clip].sourceSpeed-speed)<1e-6,clip);
});

test('studio game pace preserves baked idle and follows the boss forward-walk speed',()=>{
 const metadata=ASSETS.motion.boss;
 assert.equal(gamePlaybackRate('boss','idle',metadata),1);
 // The studio walks the boss at the game's configured pace (world metres per second after actor scaling).
 assert.ok(Math.abs(gamePlaybackRate('boss','walk-forward',metadata)*metadata.clips['walk-forward'].sourceSpeed-metadata.locomotionSpeed)<1e-6);
 assert.equal(gamePlaybackRate('player','transition-preview',ASSETS.motion.player),1);
});
