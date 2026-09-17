import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encode, decode } from 'fast-png';
import { decodePrecisionPNG, encodePrecisionPNG, pngChunks } from '../src/precision-codec.ts';
import { renderFloat } from '../src/precision-engine.ts';
import { defaults } from '../src/engine.ts';
import { pqEncode, pqDecode } from '../src/precision-math.ts';
test('16-bit input/edit/export retains more than 256 levels and source is immutable', () => {
  const data = new Uint16Array(4096 * 4);
  for (let i = 0; i < 4096; i++) {
    data.set([i * 16, i * 16, i * 16, 65535], i * 4);
  }
  const source = decodePrecisionPNG(
    encode({ width: 4096, height: 1, depth: 16, channels: 4, data }),
  );
  const copy = source.data.slice();
  const result = renderFloat(source, { ...defaults, precision: 'float', exposure: -0.3 }, Infinity);
  const out = decode(encodePrecisionPNG(result, 'srgb', 1000));
  assert.equal(out.depth, 16);
  assert.ok(new Set(Array.from(out.data).filter((_, i) => i % 4 === 0)).size > 4000);
  assert.deepEqual(source.data, copy);
  const identity = decode(
    encodePrecisionPNG(
      renderFloat(source, { ...defaults, precision: 'float' }, Infinity),
      'srgb',
      1000,
    ),
  );
  for (let i = 0; i < data.length; i++) assert.ok(Math.abs(identity.data[i] - data[i]) <= 1);
});
test('PQ known reference levels, HDR headroom and explicit SDR mapping', () => {
  assert.ok(Math.abs(pqEncode(1000) - 0.751827096) < 1e-8);
  for (const n of [0, 1, 100, 203, 1000, 4000, 10000])
    assert.ok(Math.abs(pqDecode(pqEncode(n)) - n) < 1e-6);
  const source = {
    width: 2,
    height: 1,
    data: new Float32Array([1, 1, 1, 1, 4, 4, 4, 1]),
    colorSpace: 'display-p3' as const,
    hdr: true,
  };
  const frame = renderFloat(
    source,
    { ...defaults, colorSpace: 'display-p3', precision: 'float', dynamicRange: 'hdr' },
    Infinity,
  );
  assert.ok(frame.data[4] > 3.99);
  const png = encodePrecisionPNG(frame, 'rec2100-pq', 1000);
  assert.deepEqual([...pngChunks(png).get('cICP')!], [9, 16, 0, 1]);
  assert.equal(decode(png).depth, 16);
  const reopened = decodePrecisionPNG(png);
  assert.equal(reopened.hdr, true);
  assert.ok(Math.abs(reopened.data[4] - 4) < 0.003);
  const sdr = decode(encodePrecisionPNG(frame, 'srgb', 1000));
  assert.ok(sdr.data[0] < sdr.data[4]);
  assert.ok(sdr.data[4] <= 65535);
});
test('linear alpha-aware rotation and crop', () => {
  const source = {
    width: 2,
    height: 1,
    data: new Float32Array([1, 0, 0, 1, 0, 1, 0, 1]),
    colorSpace: 'srgb' as const,
    hdr: false,
  };
  const rotated = renderFloat(source, { ...defaults, precision: 'float', rotation: 90 }, Infinity);
  assert.equal(rotated.width, 1);
  assert.equal(rotated.height, 2);
  assert.ok(rotated.data[0] > 0.99);
  assert.ok(rotated.data[5] > 0.99);
});

test('16-bit P3 ICC and EXIF orientation are decoded without an 8-bit round trip', async () => {
  const { readFile } = await import('node:fs/promises');
  const { embedICC } = await import('../src/icc.ts');
  const { injectExif } = await import('../src/exif-export.ts');
  const data = new Uint16Array([50001, 13001, 5001, 65535, 50123, 13099, 5111, 65535]);
  const png = encode({ width: 2, height: 1, channels: 4, depth: 16, data });
  const tagged = await embedICC(
    png,
    await readFile('public/profiles/display-p3.icc'),
    'image/png',
    2,
    1,
  );
  const frame = decodePrecisionPNG(tagged);
  const output = decode(encodePrecisionPNG(frame, 'display-p3', 1000));
  for (let i = 0; i < data.length; i++)
    assert.ok(Math.abs(output.data[i] - data[i]) < 12, `${i}: ${output.data[i]} vs ${data[i]}`);
  const tiff = new Uint8Array([
    73, 73, 42, 0, 8, 0, 0, 0, 1, 0, 18, 1, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0,
  ]);
  const rotated = decodePrecisionPNG(injectExif(tagged, tiff, 'image/png', 2, 1));
  assert.equal(rotated.width, 1);
  assert.equal(rotated.height, 2);
  assert.deepEqual(rotated.data, frame.data);
});

test('large image data URLs decode byte-for-byte without iterable expansion', async () => {
  const { dataURLBytes } = await import('../src/image-bytes.ts');
  const bytes = Buffer.alloc(1024 * 1024);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;
  assert.deepEqual(
    Buffer.from(dataURLBytes('data:image/png;base64,' + bytes.toString('base64'))),
    bytes,
  );
});
