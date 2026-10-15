import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaults, outputSize, cropOffset } from '../src/engine.ts';
import {
  withPortraitWarp,
  validatePortrait,
  portraitCrop,
  type PortraitLandmarks,
} from '../src/portrait-ai.ts';
import { liquifyData } from '../src/liquify.ts';
import { renderFloat } from '../src/precision-engine.ts';
import { maskToDisplay, maskToSource } from '../src/local-masks.ts';
import { capturePreset, validatePreset } from '../src/preset-library.ts';
import { createPresetToken, readPresetToken } from '../src/preset-token.ts';
import { retouchSkin } from '../src/retouch.ts';
function analysis(): PortraitLandmarks {
  const f = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.35 }));
  for (const [i, x, y] of [
    [234, 0.35, 0.35],
    [454, 0.65, 0.35],
    [10, 0.5, 0.1],
    [152, 0.5, 0.6],
    [172, 0.4, 0.5],
    [397, 0.6, 0.5],
    [33, 0.4, 0.3],
    [133, 0.46, 0.3],
    [362, 0.54, 0.3],
    [263, 0.6, 0.3],
    [1, 0.5, 0.4],
  ])
    f[i] = { x, y };
  const p = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 1 }));
  p[11] = { x: 0.3, y: 0.3, visibility: 1 };
  p[12] = { x: 0.7, y: 0.3, visibility: 1 };
  p[23] = { x: 0.4, y: 0.7, visibility: 1 };
  p[24] = { x: 0.6, y: 0.7, visibility: 1 };
  return { faces: [f], poses: [p] };
}
test('landmark-guided face/body deformation is bounded, non-destructive and idempotent', () => {
  const landmarks = analysis();
  assert.equal(validatePortrait(landmarks), landmarks);
  assert.throws(() => validatePortrait({ faces: [[{ x: NaN, y: 0.5 }]], poses: [] }));
  const a = {
    ...defaults,
    portraitLandmarks: landmarks,
    faceWidth: 70,
    faceEyes: 40,
    bodyWaist: 60,
  };
  const result = withPortraitWarp(a),
    data = liquifyData(result.liquify)!;
  assert.equal(a.liquify, null);
  assert.ok(data.some((v) => Math.abs(v) > 0.00001));
  assert.ok(data.every((v) => Number.isFinite(v) && Math.abs(v) <= 1));
  assert.equal(withPortraitWarp(result), result);
  assert.equal(withPortraitWarp(a), result);
  const hidden = analysis();
  hidden.poses[0][23].visibility = 0.1;
  const off = { ...defaults, bodyWaist: 80, portraitLandmarks: hidden };
  assert.equal(withPortraitWarp(off).liquify, null);
});
test('off-center zoom crops correct source pixels and mask coordinates roundtrip for rotations and flips', () => {
  const source = {
    width: 8,
    height: 4,
    data: new Float32Array(8 * 4 * 4),
    colorSpace: 'srgb' as const,
    hdr: false,
  };
  for (let i = 0; i < 32; i++) source.data.set([i / 32, 0, 0, 1], i * 4);
  const a = { ...defaults, cropZoom: 100, cropX: 100, cropY: -100 };
  assert.deepEqual(outputSize(8, 4, a), [2, 1]);
  assert.deepEqual(cropOffset(8, 4, a), [3, -1.5]);
  const cropped = renderFloat(source, a, Infinity);
  assert.ok(Math.abs(cropped.data[0] - 6 / 32) < 1e-6);
  for (const rotation of [0, 90, 180, 270])
    for (const flip of [false, true]) {
      const settings = { ...a, rotation, flip };
      const [cw, ch] = outputSize(8, 4, settings),
        [offsetX, offsetY] = cropOffset(8, 4, settings);
      const geometry = {
        width: 8,
        height: 4,
        cropWidth: cw,
        cropHeight: ch,
        rotation,
        flip,
        offsetX,
        offsetY,
      };
      const p = { x: 0.4, y: 0.6 },
        q = maskToSource(maskToDisplay(p, geometry), geometry);
      assert.ok(Math.abs(p.x - q.x) < 1e-12 && Math.abs(p.y - q.y) < 1e-12);
    }
});
test('AI crop stays in source bounds and preset captures settings without landmarks or photo crop', () => {
  const a = {
    ...defaults,
    portraitLandmarks: analysis(),
    faceWidth: 50,
    bodyWaist: 25,
    cropZoom: 12,
    cropX: 70,
  };
  const crop = portraitCrop(1000, 1200, a);
  assert.equal(crop.crop, '4:5');
  assert.ok(crop.cropZoom! >= 0 && crop.cropZoom! <= 100);
  const values = capturePreset(a, 'portrait');
  assert.equal(values.faceWidth, 50);
  assert.equal(values.bodyWaist, 25);
  assert.ok(!('portraitLandmarks' in values));
  assert.ok(!('cropX' in values));
  assert.ok(!('cropZoom' in values));
  assert.ok(!('faceWidth' in capturePreset(a, 'color')));
});
test('Hinana share token carries portable AI settings, survives roundtrip and rejects corruption/version/oversize', async () => {
  const preset = validatePreset({
    id: 'test',
    name: '한글 AI 프리셋',
    kind: 'portrait',
    values: capturePreset(
      { ...defaults, faceWidth: 32, skinGloss: 45, portraitLandmarks: analysis() },
      'portrait',
    ),
    warnings: [],
  });
  const token = await createPresetToken(preset);
  assert.match(token, /^HINANA1\./);
  const imported = await readPresetToken(token);
  assert.deepEqual(imported.values, preset.values);
  assert.equal(imported.name, preset.name);
  assert.ok(!('portraitLandmarks' in imported.values));
  await assert.rejects(
    readPresetToken(token.slice(0, -1) + (token.endsWith('0') ? '1' : '0')),
    /손상/,
  );
  await assert.rejects(readPresetToken(token.replace('HINANA1', 'HINANA2')), /형식/);
  await assert.rejects(readPresetToken('x'.repeat(1_500_001)), /너무/);
});
test('gloss lifts skin highlights without changing alpha or non-skin backgrounds', () => {
  const p = new Float32Array([210, 170, 140, 120, 20, 40, 220, 255]);
  const before = p.slice();
  retouchSkin(p, 2, 1, { skinSmooth: 0, skinRedness: 0, skinBrightness: 0, skinGloss: 100 });
  assert.ok(p[0] > before[0]);
  assert.equal(p[3], 120);
  assert.deepEqual([...p.slice(4)], [...before.slice(4)]);
});
