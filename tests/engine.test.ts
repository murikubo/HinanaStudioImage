import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adjustPixels, defaults, outputSize, histogram } from '../src/engine.ts';

test('neutral adjustments preserve all channels including transparency', () => {
  const pixels = new Uint8ClampedArray([
    0, 0, 0, 0, 255, 255, 255, 255, 132, 71, 208, 120, 28, 194, 90, 255,
  ]);
  const original = pixels.slice();
  adjustPixels(pixels, 2, 2, defaults);
  assert.deepEqual(pixels, original);
});
test('one exposure stop doubles brightness without changing alpha', () => {
  const pixels = new Uint8ClampedArray([40, 60, 80, 127]);
  adjustPixels(pixels, 1, 1, { ...defaults, exposure: 1 });
  assert.deepEqual([...pixels], [80, 120, 160, 127]);
});
test('monochrome yields equal RGB channels and preserves alpha', () => {
  const pixels = new Uint8ClampedArray([40, 160, 80, 64]);
  adjustPixels(pixels, 1, 1, { ...defaults, saturation: -100 });
  assert.equal(pixels[0], pixels[1]);
  assert.equal(pixels[1], pixels[2]);
  assert.equal(pixels[3], 64);
});
test('crop accounts for rotation before computing export dimensions', () => {
  assert.deepEqual(outputSize(6000, 4000, defaults), [6000, 4000]);
  assert.deepEqual(outputSize(6000, 4000, { ...defaults, rotation: 90 }), [4000, 6000]);
  assert.deepEqual(
    outputSize(6000, 4000, { ...defaults, rotation: 90, crop: '4:5' }),
    [4000, 5000],
  );
  assert.deepEqual(outputSize(6000, 4000, { ...defaults, crop: '1:1' }), [4000, 4000]);
});
test('temperature moves red and blue in opposite directions', () => {
  const pixels = new Uint8ClampedArray([100, 100, 100, 255]);
  adjustPixels(pixels, 1, 1, { ...defaults, temperature: 40 });
  assert.ok(pixels[0] > 100);
  assert.equal(pixels[1], 100);
  assert.ok(pixels[2] < 100);
});
test('histogram assigns samples to channel bins', () => {
  const bins = histogram(new Uint8ClampedArray([255, 0, 128, 255]));
  assert.equal(bins[0][63], 1);
  assert.equal(bins[1][0], 1);
  assert.equal(bins[2][32], 1);
});
