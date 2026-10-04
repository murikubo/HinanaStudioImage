import { test } from 'node:test';
import assert from 'node:assert/strict';
import { previewMaxSide } from '../src/preview-size.ts';
import { renderFloat } from '../src/precision-engine.ts';
import { defaults } from '../src/engine.ts';

test('mobile 24MP zoom buffers stay bounded at 50%, 100% and 150%', () => {
  const width = 4284,
    height = 5712;
  for (const zoom of [50, 100, 150]) {
    const side = previewMaxSide(width, height, zoom, true);
    const scale = Math.min(1, side / Math.max(width, height));
    assert.ok(Math.round(width * scale) * Math.round(height * scale) <= 4_000_000);
    assert.ok(side <= Math.max(width, height) * Math.min(1, zoom / 100));
  }
  assert.equal(previewMaxSide(width, height, 0, true), 1600);
  assert.equal(previewMaxSide(1200, 800, 50, true), 600);
  assert.equal(previewMaxSide(width, height, 100, false), height);
});

test('preview sizing leaves original resolution available for export', () => {
  const source = {
    width: 100,
    height: 80,
    data: new Float32Array(100 * 80 * 4).fill(0.5),
    colorSpace: 'display-p3' as const,
    hdr: false,
  };
  const preview = renderFloat(source, defaults, previewMaxSide(100, 80, 50, true));
  assert.deepEqual([preview.width, preview.height], [50, 40]);
  const exported = renderFloat(source, defaults, Infinity);
  assert.deepEqual([exported.width, exported.height], [100, 80]);
  assert.equal(source.data.length, 100 * 80 * 4);
});
