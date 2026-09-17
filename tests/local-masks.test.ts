import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newMask,
  maskCoverage,
  maskToDisplay,
  maskToSource,
  applyLocalMasks,
  validateMasks,
} from '../src/local-masks.ts';
const geometry = {
  width: 100,
  height: 100,
  cropWidth: 100,
  cropHeight: 100,
  rotation: 0,
  flip: false,
};
test('radial masks isolate a feathered area; inversion, opacity and disable are deterministic', () => {
  const m = {
    ...newMask('radial', 'a'),
    points: [
      { x: 0.5, y: 0.5 },
      { x: 0.8, y: 0.8 },
    ],
  };
  const a = maskCoverage(m, 100, 100, geometry);
  assert.equal(a[50 * 100 + 50], 1);
  assert.equal(a[0], 0);
  assert.ok(a[50 * 100 + 75] > 0 && a[50 * 100 + 75] < 1);
  const b = maskCoverage({ ...m, inverted: true, opacity: 0.5 }, 100, 100, geometry);
  for (let i = 0; i < a.length; i++) assert.ok(Math.abs(b[i] - (1 - a[i]) * 0.5) < 1e-6);
  assert.ok(maskCoverage({ ...m, enabled: false }, 100, 100, geometry).every((v) => v === 0));
});
test('brush interpolation has no gaps and coordinates survive crop/rotation/flip', () => {
  const m = {
    ...newMask('brush', 'a'),
    radius: 0.05,
    points: [
      { x: 0.2, y: 0.5 },
      { x: 0.8, y: 0.5 },
    ],
  };
  const a = maskCoverage(m, 100, 100, geometry);
  for (let x = 20; x < 80; x++) assert.equal(a[50 * 100 + x], 1);
  assert.equal(a[0], 0);
  for (const rotation of [0, 90, 180, 270])
    for (const flip of [false, true]) {
      const g = { ...geometry, cropWidth: 60, cropHeight: 80, rotation, flip },
        p = { x: 0.35, y: 0.7 },
        r = maskToSource(maskToDisplay(p, g), g);
      assert.ok(Math.abs(r.x - p.x) < 1e-10 && Math.abs(r.y - p.y) < 1e-10);
    }
});
test('local exposure preserves HDR headroom, untouched pixels, and alpha', () => {
  const m = {
    ...newMask('linear', 'a'),
    feather: 0,
    points: [
      { x: 0, y: 0 },
      { x: 0.5, y: 0 },
    ],
    exposure: 2,
  };
  const pixels = new Float32Array([1, 1, 1, 0.5, 1, 1, 1, 1]);
  applyLocalMasks(
    pixels,
    2,
    1,
    [m],
    { ...geometry, cropWidth: 100, cropHeight: 100 },
    'srgb',
    true,
  );
  assert.equal(pixels[0], 4);
  assert.equal(pixels[3], 0.5);
  assert.equal(pixels[4], 1);
});
test('project mask validation rejects invalid and unbounded data', () => {
  const m = {
    ...newMask('radial', 'a'),
    points: [
      { x: 0.5, y: 0.5 },
      { x: 0.8, y: 0.8 },
    ],
  };
  assert.deepEqual(validateMasks([m]), [m]);
  assert.throws(() => validateMasks([m, m]));
  assert.throws(() => validateMasks([{ ...m, exposure: Infinity }]));
  assert.throws(() =>
    validateMasks([
      {
        ...m,
        points: [
          { x: -1, y: 0 },
          { x: 1, y: 1 },
        ],
      },
    ]),
  );
});

test('separate brush strokes never paint connecting lines', () => {
  const mask = {
    ...newMask('brush', 'a'),
    radius: 0.04,
    points: [
      { x: 0.1, y: 0.5, start: true },
      { x: 0.2, y: 0.5 },
      { x: 0.8, y: 0.5, start: true },
      { x: 0.9, y: 0.5 },
    ],
  };
  const weights = maskCoverage(mask, 100, 100, geometry);
  assert.equal(weights[50 * 100 + 50], 0);
  assert.equal(weights[50 * 100 + 15], 1);
});
test('float rendering applies masks after geometry and retains over-white local exposure', async () => {
  const { renderFloat } = await import('../src/precision-engine.ts');
  const { defaults, outputSize } = await import('../src/engine.ts');
  const data = new Float32Array(16 * 8 * 4).fill(1),
    source = { width: 16, height: 8, data, colorSpace: 'srgb' as const, hdr: true };
  const mask = {
    ...newMask('radial', 'a'),
    points: [
      { x: 0.4, y: 0.5 },
      { x: 0.6, y: 0.9 },
    ],
    feather: 0,
    exposure: 2,
  };
  const a = {
    ...defaults,
    precision: 'float' as const,
    dynamicRange: 'hdr' as const,
    rotation: 90,
    flip: true,
    crop: '1:1',
    masks: [mask],
  };
  const frame = renderFloat(source, a, Infinity);
  const [cropWidth, cropHeight] = outputSize(16, 8, a);
  const p = maskToDisplay(mask.points[0], {
    width: 16,
    height: 8,
    cropWidth,
    cropHeight,
    rotation: 90,
    flip: true,
  });
  const index = (Math.floor(p.y * frame.height) * frame.width + Math.floor(p.x * frame.width)) * 4;
  assert.ok(frame.data[index] > 3.99);
  assert.ok(Math.abs(frame.data[0] - 1) < 1e-5);
  assert.equal(frame.data[index + 3], 1);
  assert.ok(data.every((v) => v === 1));
});

test('subject raster survives serialization, transforms, inverse and linear HDR composition', () => {
  const m = {
    ...newMask('subject', 'subject'),
    points: [{ x: 0.25, y: 0.5, exclude: false }],
    raster: { width: 2, height: 2, data: Buffer.from([255, 0, 255, 0]).toString('base64') },
    exposure: 1,
  };
  const saved = validateMasks(JSON.parse(JSON.stringify([m])))[0];
  const g = { ...geometry, width: 2, height: 2, cropWidth: 2, cropHeight: 2 };
  assert.deepEqual([...maskCoverage(saved, 2, 2, g)], [1, 0, 1, 0]);
  assert.deepEqual([...maskCoverage(saved, 2, 2, { ...g, flip: true })], [0, 1, 0, 1]);
  assert.deepEqual([...maskCoverage(saved, 2, 2, { ...g, rotation: 90 })], [1, 1, 0, 0]);
  assert.deepEqual(
    [...maskCoverage({ ...saved, inverted: true, opacity: 0.5 }, 2, 2, g)],
    [0, 0.5, 0, 0.5],
  );
  const pixels = new Float32Array([2, 1, 0.5, 1, 2, 1, 0.5, 1, 2, 1, 0.5, 1, 2, 1, 0.5, 1]);
  applyLocalMasks(pixels, 2, 2, [saved], g, 'display-p3', true);
  assert.equal(pixels[0], 4);
  assert.equal(pixels[4], 2);
  assert.equal(pixels[3], 1);
  assert.deepEqual(
    [...maskCoverage({ ...newMask('subject', 'empty'), inverted: true }, 2, 2, g)],
    [0, 0, 0, 0],
  );
});
test('subject validation rejects malformed rasters and invalid prompts before rendering', () => {
  const m = {
    ...newMask('subject', 's'),
    points: [{ x: 0.5, y: 0.5, exclude: false }],
    raster: { width: 1, height: 1, data: '/w==' },
  };
  for (const patch of [
    { raster: { width: 1025, height: 1, data: '' } },
    { raster: { width: 1, height: 1, data: 'AAAA' } },
    { raster: { width: 1, height: 1, data: '!!!!' } },
    { raster: undefined },
    { points: [{ x: 0.5, y: 0.5, exclude: true }] },
    { points: Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, exclude: false })) },
  ])
    assert.throws(() => validateMasks([{ ...m, ...patch }]));
});

test('subject brush additions and erasures compose in order and keep original AI raster', () => {
  const g = { ...geometry, width: 100, height: 100, cropWidth: 100, cropHeight: 100 };
  const raster = { width: 2, height: 2, data: Buffer.from([255, 0, 255, 0]).toString('base64') };
  const m = {
    ...newMask('subject', 's'),
    points: [{ x: 0.25, y: 0.5, exclude: false }],
    raster,
    strokes: [
      { points: [{ x: 0.8, y: 0.5 }], radius: 0.1, feather: 0.5, erase: false },
      { points: [{ x: 0.25, y: 0.5 }], radius: 0.1, feather: 0.5, erase: true },
    ],
  };
  const a = maskCoverage(m, 100, 100, g);
  assert.equal(a[50 * 100 + 80], 1);
  assert.equal(a[50 * 100 + 25], 0);
  assert.equal(a[50 * 100 + 5], 1);
  assert.equal(a[5 * 100 + 90], 0);
  const restored = {
    ...m,
    strokes: [
      ...m.strokes,
      { points: [{ x: 0.25, y: 0.5 }], radius: 0.03, feather: 0, erase: false },
    ],
  };
  assert.equal(maskCoverage(restored, 100, 100, g)[50 * 100 + 25], 1);
  assert.equal(raster.data, '/wD/AA==');
  const inverse = maskCoverage({ ...m, inverted: true, opacity: 0.4 }, 100, 100, g);
  for (let i = 0; i < a.length; i++) assert.ok(Math.abs(inverse[i] - (1 - a[i]) * 0.4) < 1e-6);
  assert.deepEqual(maskCoverage(validateMasks(JSON.parse(JSON.stringify([m])))[0], 100, 100, g), a);
  const rotated = maskCoverage(m, 100, 100, { ...g, rotation: 90, flip: true });
  assert.equal(rotated[80 * 100 + 50], 1);
  const crop = maskCoverage(m, 50, 50, { ...g, cropWidth: 50, cropHeight: 50 });
  assert.equal(crop[25 * 50], 0);
  // Changing brush settings must not resize old strokes.
  assert.deepEqual(maskCoverage({ ...m, radius: 0.5, feather: 0 }, 100, 100, g), a);
});
test('manual strokes reject invalid values and excessive data', () => {
  const m = {
    ...newMask('subject', 's'),
    points: [{ x: 0.5, y: 0.5, exclude: false }],
    raster: { width: 1, height: 1, data: '/w==' },
  };
  const stroke = { points: [{ x: 0.5, y: 0.5 }], radius: 0.1, feather: 0.5, erase: false };
  for (const strokes of [
    null,
    [null],
    [{ ...stroke, radius: NaN }],
    [{ ...stroke, feather: 2 }],
    [{ ...stroke, erase: 'yes' }],
    [{ ...stroke, points: [] }],
    [{ ...stroke, points: [{ x: 2, y: 0.5 }] }],
    Array(129).fill(stroke),
    [{ ...stroke, points: Array(4097).fill({ x: 0.5, y: 0.5 }) }],
  ])
    assert.throws(() => validateMasks([{ ...m, strokes }]));
});
