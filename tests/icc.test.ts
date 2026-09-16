import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { inflateSync } from 'node:zlib';
import { PNG } from 'pngjs';
import { embedICC } from '../src/icc.ts';
import { normalizeExif } from '../src/exif-export.ts';
import { p3ToSRGB } from '../src/color-space.ts';
import { adjustPixels, defaults } from '../src/engine.ts';
import piexif from 'piexifjs';
import exifr from 'exifr';
const icc = fs.readFileSync('public/profiles/display-p3.icc');
test('Display P3 saturated red lies outside sRGB; white and neutrals remain neutral', () => {
  const red = p3ToSRGB(255, 0, 0);
  assert.ok(red[0] > 255 && red[1] < 0 && red[2] < 0);
  const white = p3ToSRGB(255, 255, 255);
  white.forEach((v) => assert.ok(Math.abs(v - 255) < 0.001));
  const gray = p3ToSRGB(128, 128, 128);
  gray.forEach((v) => assert.ok(Math.abs(v - 128) < 0.001));
});
test('P3 edits leave neutral settings byte-exact and use P3 luminance for monochrome', () => {
  const p = new Uint8ClampedArray([255, 77, 0, 255]);
  adjustPixels(p, 1, 1, { ...defaults, colorSpace: 'display-p3' });
  assert.deepEqual([...p], [255, 77, 0, 255]);
  adjustPixels(p, 1, 1, { ...defaults, colorSpace: 'display-p3', saturation: -100 });
  assert.equal(p[0], 112);
  assert.equal(p[0], p[1]);
  assert.equal(p[1], p[2]);
});
test('PNG ICC replacement retains pixels and produces one valid compressed profile', async () => {
  const png = new PNG({ width: 2, height: 1 });
  png.data.fill(200);
  let bytes = await embedICC(PNG.sync.write(png), icc, 'image/png', 2, 1);
  bytes = await embedICC(bytes, icc, 'image/png', 2, 1);
  assert.deepEqual(PNG.sync.read(Buffer.from(bytes)).data, png.data);
  const b = Buffer.from(bytes);
  let count = 0;
  for (let at = 8; at < b.length;) {
    const n = b.readUInt32BE(at);
    if (b.toString('ascii', at + 4, at + 8) === 'iCCP') {
      count++;
      const data = b.subarray(at + 8, at + 8 + n);
      assert.deepEqual(inflateSync(data.subarray(data.indexOf(0) + 2)), icc);
    }
    at += n + 12;
  }
  assert.equal(count, 1);
});
test('ICC JPEG and WebP containers replace old profiles and preserve VP8X flags', async () => {
  const jpeg = new Uint8Array([255, 216, 255, 218, 0, 2, 255, 217]);
  const once = await embedICC(jpeg, icc, 'image/jpeg', 2, 1);
  assert.deepEqual(await embedICC(once, icc, 'image/jpeg', 2, 1), once);
  const payload = Buffer.alloc(30);
  payload.write('RIFF');
  payload.writeUInt32LE(22, 4);
  payload.write('WEBP', 8);
  payload.write('VP8X', 12);
  payload.writeUInt32LE(10, 16);
  payload[20] = 24;
  payload[24] = 1;
  const webp = Buffer.from(await embedICC(payload, icc, 'image/webp', 2, 1));
  assert.equal(webp[20], 56);
  assert.equal(webp.toString('ascii', 30, 34), 'ICCP');
  assert.equal(webp.readUInt32LE(4), webp.length - 8);
  assert.deepEqual(await embedICC(webp, icc, 'image/webp', 2, 1), new Uint8Array(webp));
});
test('P3 EXIF is uncalibrated with ICC, while sRGB keeps EXIF ColorSpace=1', async () => {
  const tiff = Buffer.from(
    piexif.dump({ '0th': { 272: 'P3 Camera' }, Exif: { 40961: 1 } }).slice(6),
    'binary',
  );
  const p3 = await exifr.parse(normalizeExif(tiff, 20, 10, 'display-p3'), {
    translateValues: false,
  });
  assert.equal(p3.ColorSpace, 65535);
  assert.equal(p3.Model, 'P3 Camera');
  const srgb = await exifr.parse(normalizeExif(tiff, 20, 10, 'srgb'), { translateValues: false });
  assert.equal(srgb.ColorSpace, 1);
});
