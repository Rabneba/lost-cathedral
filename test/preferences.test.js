import test from 'node:test';
import assert from 'node:assert/strict';
import {sanitizePreferences} from '../src/game/preferences.js';

test('saved presentation preferences retain valid values and ignore malformed storage',()=>{
 assert.deepEqual(sanitizePreferences(null),sanitizePreferences('invalid'));
 const result=sanitizePreferences({quality:'balanced',brightness:1.3,'music-volume':.2,'toggle-shield':true});
 assert.equal(result.quality,'balanced');assert.equal(result.brightness,1.3);
 assert.equal(result['music-volume'],.2);assert.equal(result['toggle-shield'],true);
 const malformed=sanitizePreferences({quality:'unknown',brightness:Infinity,'music-volume':20,'effects-volume':-1,'toggle-shield':'true'});
 assert.equal(malformed.quality,'high');assert.equal(malformed.brightness,1.36);
 assert.equal(malformed['music-volume'],1);assert.equal(malformed['effects-volume'],0);assert.equal(malformed['toggle-shield'],false);
});

test('a saved profile still on the old brightness default picks up the new one; a hand-set value is kept',()=>{
 // 17 Sep 2026: the default moved 1.12 -> 1.24 -> 1.36, and every saved profile carries the full object, so an old
 // default would have pinned everyone there forever.
 assert.equal(sanitizePreferences({brightness:1.12}).brightness,1.36);
 assert.equal(sanitizePreferences({brightness:1.24}).brightness,1.36);
 assert.equal(sanitizePreferences({brightness:1.13}).brightness,1.13);
 assert.equal(sanitizePreferences({brightness:1.36}).brightness,1.36);
});
