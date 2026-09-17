import test from 'node:test';
import assert from 'node:assert/strict';
import {tatteredWallCloth} from '../src/game/banners.js';

// Round 1 review: the ten aisle-bay cloths were flat PlaneGeometry rectangles
// that read as red-and-gold wallpaper glued between the piers - a dead-straight
// hem, no folds, and a repeating print. These fences pin the three properties
// that stop that happening again, none of which a GPU is needed to check.
const cloth = (side = -1) => tatteredWallCloth(side, -7.2, 12.55, 2.45, 6.1, 7.42, 3.82);

function bounds(g) {
  const p = g.attributes.position;
  const b = {minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity};
  for (let i = 0; i < p.count; i++) {
    b.minX = Math.min(b.minX, p.getX(i)); b.maxX = Math.max(b.maxX, p.getX(i));
    b.minY = Math.min(b.minY, p.getY(i)); b.maxY = Math.max(b.maxY, p.getY(i));
    b.minZ = Math.min(b.minZ, p.getZ(i)); b.maxZ = Math.max(b.maxZ, p.getZ(i));
  }
  return b;
}

test('a wall cloth has a torn hem, not a straight cut', () => {
  const g = cloth();
  const p = g.attributes.position;
  // Lowest vertex per Z column: a flat plane gives every column the same Y.
  const byColumn = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = p.getZ(i).toFixed(3);
    byColumn.set(key, Math.min(byColumn.get(key) ?? Infinity, p.getY(i)));
  }
  const hems = [...byColumn.values()];
  const spread = Math.max(...hems) - Math.min(...hems);
  assert.ok(hems.length > 20, `expected a sampled hem, got ${hems.length} columns`);
  assert.ok(spread > .35, `hem spread is only ${spread.toFixed(3)} m - that is a straight cut, not a tear`);
});

test('a wall cloth stands off the wall in folds, and never through it', () => {
  const g = cloth(-1);
  const p = g.attributes.position, xs = [];
  for (let i = 0; i < p.count; i++) xs.push(p.getX(i));
  const depth = Math.max(...xs) - Math.min(...xs);
  assert.ok(depth > .09, `fold depth ${depth.toFixed(3)} m - a flat plane has none`);
  // side -1 hangs on the x = -12.55 wall and may only bulge toward the nave,
  // i.e. toward x = 0. Nothing may end up behind the wall plane.
  assert.ok(Math.min(...xs) >= -12.55 - 1e-6, 'cloth pushed back through the ashlar');
  assert.ok(Math.max(...xs) <= -12.2, 'cloth billows too far into the aisle');
});

test('wall cloths stay outside the playable floor and carry the wind attributes', () => {
  for (const side of [-1, 1]) {
    const g = cloth(side);
    const b = bounds(g);
    assert.ok(Math.min(Math.abs(b.minX), Math.abs(b.maxX)) > 9.5,
      `cloth reaches x ${b.minX.toFixed(2)}..${b.maxX.toFixed(2)}, inside the |x| <= 9.5 fighting floor`);
    assert.ok(b.minY > 1.0, `cloth hem at y ${b.minY.toFixed(2)} hangs into head height`);
    assert.ok(g.attributes.uv && g.attributes.normal, 'cloth must merge with the other banners');
  }
});
