import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeLiquify,
  liquifyData,
  newLiquifyData,
  pushLiquify,
  sampleLiquify,
  validateLiquify,
} from '../src/liquify.ts';
import { renderFloat } from '../src/precision-engine.ts';
import { defaults } from '../src/engine.ts';
test('liquify is localized, bounded, immutable when archived, and roundtrips binary coordinates', () => {
  const f = newLiquifyData();
  pushLiquify(f, { x: 0.35, y: 0.3 }, { x: 0.45, y: 0.3 }, 0.18, 0.8, 4284, 5712);
  const saved = encodeLiquify(f),
    copy = liquifyData(validateLiquify(saved))!;
  assert.ok(sampleLiquify(copy, 0.45, 0.3)[0] < -0.02);
  assert.deepEqual(sampleLiquify(copy, 0.9, 0.9), [0, 0]);
  assert.equal(copy.byteLength, 129 * 129 * 8);
  const archived = copy.slice();
  pushLiquify(f, { x: 0.45, y: 0.3 }, { x: 0.45, y: 0.4 }, 0.18, 0.8, 4284, 5712);
  assert.deepEqual(copy, archived);
  assert.ok(f.every((v) => Number.isFinite(v) && Math.abs(v) <= 1));
  assert.deepEqual(liquifyData(validateLiquify({ ...saved })), archived);
  assert.throws(() => validateLiquify({ ...saved, width: 4096 }));
  const corrupt = newLiquifyData();
  corrupt[0] = NaN;
  assert.throws(() => validateLiquify(encodeLiquify(corrupt)));
});
test('liquify edits alpha-aware linear HDR pixels and follows rotation in export', () => {
  const width = 32,
    height = 32,
    data = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      data[p] = x / 31;
      data[p + 1] = y / 31;
      data[p + 2] = 4;
      data[p + 3] = 1;
    }
  const grid = newLiquifyData();
  pushLiquify(grid, { x: 0.35, y: 0.3 }, { x: 0.45, y: 0.4 }, 0.2, 0.5, width, height);
  const a = {
    ...defaults,
    precision: 'float' as const,
    dynamicRange: 'hdr' as const,
    liquify: encodeLiquify(grid),
  };
  const source = { width, height, data, colorSpace: 'srgb' as const, sourceBitDepth: 16 as const };
  const before = data.slice(),
    output = renderFloat(source, a, Infinity),
    x = 14,
    y = 12,
    p = (y * width + x) * 4;
  const d = sampleLiquify(grid, (x + 0.5) / width, (y + 0.5) / height);
  assert.ok(Math.abs(output.data[p] - (x + d[0] * width) / 31) < 0.0001);
  assert.ok(Math.abs(output.data[p + 1] - (y + d[1] * height) / 31) < 0.0001);
  assert.ok(output.data[p + 2] > 3.99);
  assert.deepEqual(data, before);
  const rotated = renderFloat(source, { ...a, rotation: 90 }, Infinity);
  assert.ok(Math.abs(rotated.data[(x * 32 + (31 - y)) * 4] - output.data[p]) < 0.0001);
});
