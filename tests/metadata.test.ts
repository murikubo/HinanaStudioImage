import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readMetadata } from '../src/metadata.ts';
import { withExif } from './exif-fixture.mjs';
test('reads camera, rational exposures, ISO and preserves camera-local date', async () => {
  const metadata = await readMetadata(withExif(readFileSync('public/samples/alpine.jpg')));
  assert.equal(metadata.status, 'ready');
  const fields = Object.fromEntries(metadata.fields.map((f) => [f.label, f.value]));
  assert.equal(fields['카메라'], 'Hinana Portrait Cam');
  assert.equal(fields['셔터 속도'], '1/125 s');
  assert.equal(fields['조리개'], 'f/2.8');
  assert.equal(fields['ISO'], '400');
  assert.equal(fields['촬영 일시'], '2026:09:14 16:30:00 (현지 시각)');
});
test('missing metadata and corrupt metadata do not prevent editing', async () => {
  const empty = await readMetadata(readFileSync('public/samples/alpine.jpg'));
  assert.equal(empty.status, 'empty');
  const corrupt = await readMetadata(new Uint8Array([1, 2, 3, 4]));
  assert.equal(corrupt.status, 'error');
  assert.deepEqual(corrupt.fields, []);
});
