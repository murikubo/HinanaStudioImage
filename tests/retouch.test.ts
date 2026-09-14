import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retouchSkin, skinWeight } from '../src/retouch.ts';
const off = { skinSmooth: 0, skinRedness: 0, skinBrightness: 0 };
test('zero retouch is exactly neutral', () => {
  const p = new Uint8ClampedArray([185, 125, 100, 128]);
  const before = p.slice();
  retouchSkin(p, 1, 1, off);
  assert.deepEqual(p, before);
});
test('soft selection includes light and dark skin-like colors but excludes blue and green', () => {
  assert.ok(skinWeight(215, 170, 140) > 0.5);
  assert.ok(skinWeight(110, 70, 50) > 0.5);
  assert.equal(skinWeight(20, 50, 220), 0);
  assert.equal(skinWeight(20, 200, 40), 0);
});
test('smoothing reduces fine variation and preserves a sharp boundary and alpha', () => {
  const p = new Uint8ClampedArray(20 * 20 * 4);
  for (let y = 0; y < 20; y++)
    for (let x = 0; x < 20; x++) {
      const noise = (x + y) % 2 ? 6 : -6;
      p.set(
        x < 10 ? [190 + noise, 140 + noise, 115 + noise, 128] : [20, 40, 200, 255],
        (y * 20 + x) * 4,
      );
    }
  const before = p.slice();
  retouchSkin(p, 20, 20, { ...off, skinSmooth: 100 });
  let initial = 0,
    after = 0;
  for (let y = 2; y < 18; y++)
    for (let x = 2; x < 8; x++) {
      const i = (y * 20 + x) * 4;
      initial += Math.abs(before[i] - 190);
      after += Math.abs(p[i] - 190);
      assert.equal(p[i + 3], 128);
    }
  assert.ok(after < initial * 0.8);
  for (let y = 0; y < 20; y++)
    for (let x = 10; x < 20; x++) {
      const i = (y * 20 + x) * 4;
      assert.deepEqual(p.slice(i, i + 4), before.slice(i, i + 4));
    }
});
test('redness decreases and brightness increases only selected opaque pixels', () => {
  const p = new Uint8ClampedArray([200, 135, 110, 255, 20, 40, 200, 255, 200, 135, 110, 0]);
  retouchSkin(p, 3, 1, { ...off, skinRedness: 100 });
  assert.ok(p[0] < 200);
  assert.ok(p[1] > 135);
  assert.deepEqual([...p.slice(4)], [20, 40, 200, 255, 200, 135, 110, 0]);
  const q = new Uint8ClampedArray([200, 135, 110, 255]);
  retouchSkin(q, 1, 1, { ...off, skinBrightness: 100 });
  assert.ok(q[0] > 200);
  assert.ok(q[1] > 135);
});
