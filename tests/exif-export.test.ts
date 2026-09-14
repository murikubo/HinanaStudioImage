import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import exifr from 'exifr';
import { withExif } from './exif-fixture.mjs';
import { extractExif, normalizeExif, injectExif, crc32, preserveExif } from '../src/exif-export.ts';
const jpeg = new Uint8Array(readFileSync('public/samples/alpine.jpg'));
const source = withExif(Buffer.from(jpeg));
const tiff = extractExif(source)!;
const normalized = normalizeExif(tiff, 640, 480);
test('retains camera and exposure, normalizes orientation/dimensions, drops thumbnail reference', async () => {
  const output = injectExif(jpeg, normalized, 'image/jpeg', 640, 480);
  const tags = await exifr.parse(output, { translateValues: false });
  assert.equal(tags.Make, 'Hinana');
  assert.equal(tags.ISO, 400);
  assert.equal(tags.ExposureTime, 1 / 125);
  assert.equal(tags.Orientation, 1);
  assert.equal(tags.ImageWidth, 640);
  assert.equal(tags.ImageHeight, 480);
  assert.equal(tags.ExifImageWidth, 640);
  assert.equal(tags.ExifImageHeight, 480);
  assert.equal(tags.ColorSpace, 1);
  const v = new DataView(normalized.buffer);
  const root = v.getUint32(4, true);
  const count = v.getUint16(root, true);
  assert.equal(v.getUint32(root + 2 + count * 12, true), 0);
});
test('preserves opaque and GPS directory entries without relocating original payload', () => {
  const custom = new Uint8Array(tiff);
  const v = new DataView(custom.buffer);
  v.setUint16(10, 0x8825, true);
  v.setUint16(12, 4, true);
  v.setUint32(14, 1, true);
  v.setUint32(18, 300, true);
  v.setUint16(300, 0, true);
  const out = normalizeExif(custom, 300, 200);
  assert.deepEqual(out.slice(8, custom.length), custom.slice(8));
  const d = new DataView(out.buffer),
    root = d.getUint32(4, true);
  let gps = 0;
  for (let p = root + 2; p < root + 2 + d.getUint16(root, true) * 12; p += 12)
    if (d.getUint16(p, true) === 0x8825) gps = d.getUint32(p + 8, true);
  assert.equal(gps, 300);
});
test('big endian TIFF is normalized correctly', () => {
  const b = new Uint8Array(26),
    v = new DataView(b.buffer);
  b.set([77, 77]);
  v.setUint16(2, 42);
  v.setUint32(4, 8);
  v.setUint16(8, 1);
  v.setUint16(10, 0x112);
  v.setUint16(12, 3);
  v.setUint32(14, 1);
  v.setUint16(18, 6);
  const out = normalizeExif(b, 480, 640),
    d = new DataView(out.buffer);
  const root = d.getUint32(4);
  let orientation = 0;
  for (let p = root + 2; p < root + 2 + d.getUint16(root) * 12; p += 12)
    if (d.getUint16(p) === 0x112) orientation = d.getUint16(p + 8);
  assert.equal(orientation, 1);
});
test('PNG EXIF payload has valid CRC and can be read back', async () => {
  const png = new Uint8Array(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
      'base64',
    ),
  );
  const out = injectExif(png, normalized, 'image/png', 640, 480);
  assert.deepEqual(extractExif(out), normalized);
  const tags = await exifr.parse(out);
  assert.equal(tags.ISO, 400);
  const v = new DataView(out.buffer),
    at = 33,
    size = v.getUint32(at);
  assert.equal(v.getUint32(at + 8 + size), crc32(out.subarray(at + 4, at + 8 + size)));
});
test('WebP creates extended header, sets EXIF bit, length and padding', async () => {
  const webp = new Uint8Array(26);
  webp.set(Buffer.from('RIFF'));
  new DataView(webp.buffer).setUint32(4, 18, true);
  webp.set(Buffer.from('WEBPVP8L'), 8);
  new DataView(webp.buffer).setUint32(16, 5, true);
  webp[20] = 47;
  webp[24] = 16;
  const out = injectExif(webp, normalized, 'image/webp', 640, 480);
  assert.deepEqual(extractExif(out), normalized);
  assert.equal(new DataView(out.buffer).getUint32(4, true), out.length - 8);
  assert.equal(out[20] & 24, 24);
  const tags = await exifr.parse(extractExif(out));
  assert.equal(tags.ISO, 400);
});
test('no EXIF is a no-op; malformed TIFF fails instead of silently losing metadata', async () => {
  const blob = new Blob([jpeg], { type: 'image/jpeg' });
  const result = await preserveExif(
    blob,
    'data:image/jpeg;base64,' + Buffer.from(jpeg).toString('base64'),
    2200,
    1467,
  );
  assert.equal(result, blob);
  assert.throws(() => normalizeExif(new Uint8Array([0, 1, 2]), 10, 10));
  assert.throws(() => injectExif(jpeg, new Uint8Array(65535), 'image/jpeg', 10, 10));
});
