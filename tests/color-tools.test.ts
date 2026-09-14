import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyColorTools, colorDefaults, curveLut } from '../src/color-tools.ts';
test('neutral HSL and curve preserve all bytes', () => {
  const p = new Uint8ClampedArray([221, 35, 77, 255, 8, 54, 202, 127, 120, 120, 120, 255]);
  const before = p.slice();
  applyColorTools(p, colorDefaults);
  assert.deepEqual(p, before);
  assert.deepEqual(
    [...curveLut(colorDefaults)],
    Array.from({ length: 256 }, (_, i) => i),
  );
});
test('blue luminance only changes blue, keeps red and neutral pixels intact', () => {
  const p = new Uint8ClampedArray([0, 0, 255, 255, 255, 0, 0, 255, 128, 128, 128, 255]);
  applyColorTools(p, { ...colorDefaults, mixer_blue_luminance: -100 });
  assert.ok(p[2] < 255);
  assert.deepEqual([...p.slice(4)], [255, 0, 0, 255, 128, 128, 128, 255]);
});
test('red hue wraps around and saturation can remove selected color', () => {
  const p = new Uint8ClampedArray([255, 0, 0, 111]);
  applyColorTools(p, { ...colorDefaults, mixer_red_hue: -100 });
  assert.ok(p[2] > 0);
  assert.equal(p[1], 0);
  assert.equal(p[3], 111);
  const q = new Uint8ClampedArray([255, 0, 0, 255]);
  applyColorTools(q, { ...colorDefaults, mixer_red_saturation: -100 });
  assert.equal(q[0], q[1]);
  assert.equal(q[1], q[2]);
});
test('hue band transition is continuous at the red wraparound', () => {
  const a = new Uint8ClampedArray([230, 30, 31, 255]),
    b = new Uint8ClampedArray([230, 31, 30, 255]);
  const settings = { ...colorDefaults, mixer_red_luminance: 60, mixer_red_hue: 70 };
  applyColorTools(a, settings);
  applyColorTools(b, settings);
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(a[i] - b[i]) <= 3);
});
test('curve changes chosen tonal region and preserves endpoints and alpha', () => {
  const lut = curveLut({ ...colorDefaults, curveMidtones: 100 });
  assert.equal(lut[0], 0);
  assert.equal(lut[255], 255);
  assert.ok(lut[128] > 160);
  assert.equal(lut[0], 0);
  const p = new Uint8ClampedArray([128, 128, 128, 72]);
  applyColorTools(p, { ...colorDefaults, curveMidtones: 100 });
  assert.ok(p[0] > 128);
  assert.equal(p[3], 72);
});
