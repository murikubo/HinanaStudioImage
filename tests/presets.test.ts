import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaults, adjustPixels } from '../src/engine.ts';
import { parseCube, sampleCube, applyCube, validateCube } from '../src/cube-lut.ts';
import {
  capturePreset,
  validatePreset,
  presetValues,
  exportPreset,
  importPreset,
  mapXmp,
  exportXmp,
  portraitPresets,
} from '../src/preset-library.ts';

function cube(invert = false) {
  const rows = [];
  for (let b = 0; b < 2; b++)
    for (let g = 0; g < 2; g++)
      for (let r = 0; r < 2; r++)
        rows.push(invert ? `${1 - r} ${1 - g} ${1 - b}` : `${r} ${g} ${b}`);
  return `TITLE "Test"\nLUT_3D_SIZE 2\n${rows.join('\n')}`;
}
test('CUBE trilinear interpolation respects red-fastest order, bounds and input domain', () => {
  const { lut } = parseCube(cube());
  const out = [0, 0, 0];
  sampleCube(lut, 0.2, 0.4, 0.8, out);
  out.forEach((v, i) => assert.ok(Math.abs(v - [0.2, 0.4, 0.8][i]) < 1e-12));
  sampleCube(lut, -3, 2, 0.5, out);
  assert.deepEqual(out, [0, 1, 0.5]);
  const custom = { ...lut, min: [-1, -1, -1], max: [1, 1, 1] };
  sampleCube(custom, 0, 0, 0, out);
  assert.deepEqual(out, [0.5, 0.5, 0.5]);
  for (const text of [
    cube() + '\n0 0 0',
    cube().replace('1 1 1', ''),
    'LUT_1D_SIZE 2\n0 0 0',
    cube().replace('SIZE 2', 'SIZE 1000'),
  ])
    assert.throws(() => parseCube(text));
  assert.throws(() => validateCube({ ...lut, min: [0, 0, 0], max: [0, 1, 1] }));
});
test('CUBE affects shared pixel pipeline, preserves alpha, float precision, neutral P3 and HDR gain', () => {
  const identity = parseCube(cube()).lut,
    inverse = parseCube(cube(true)).lut;
  const pixels = new Uint8ClampedArray([50, 100, 150, 123, 30, 40, 50, 0]);
  adjustPixels(pixels, 2, 1, { ...defaults, colorLut: inverse });
  assert.deepEqual([...pixels], [205, 155, 105, 123, 30, 40, 50, 0]);
  const half = new Float32Array([50.25, 100.5, 150.75, 127]);
  applyCube(half, inverse, 50, 'srgb');
  assert.deepEqual([...half], [127.5, 127.5, 127.5, 127]);
  for (const space of ['srgb', 'display-p3'] as const) {
    const hdr = new Float32Array([510.25, 510.25, 510.25, 255]);
    applyCube(hdr, identity, 100, space);
    assert.ok(hdr.every(Number.isFinite));
    assert.ok(Math.abs(hdr[0] - 510.25) < 0.001);
    assert.equal(hdr[3], 255);
  }
});
test('preset scopes preserve geometry and portrait/color boundaries; safe serialization roundtrip', () => {
  const a = {
    ...defaults,
    skinSmooth: 44,
    skinUniformity: 30,
    contrast: 25,
    rotation: 90,
    colorLut: parseCube(cube()).lut,
  };
  const portrait = capturePreset(a, 'portrait');
  assert.equal(portrait.skinSmooth, 44);
  assert.ok(!('rotation' in portrait));
  assert.ok(!('contrast' in portrait));
  assert.ok(!('colorLut' in portrait));
  const color = capturePreset(a, 'color');
  assert.equal(color.contrast, 25);
  assert.ok(!('skinSmooth' in color));
  const preset = validatePreset({
    id: 'test',
    name: '  인물 & 색감  ',
    kind: 'combined',
    values: capturePreset(a, 'combined'),
    warnings: [],
  });
  const copy = importPreset(exportPreset(preset), 'test.hinanapreset');
  assert.deepEqual(copy.values, preset.values);
  assert.equal(copy.name, '인물 & 색감');
  assert.equal(presetValues(preset, 50).skinSmooth, 22);
  assert.equal(presetValues(preset, 50).colorLutAmount, 50);
  assert.deepEqual(presetValues(preset, 0), {});
  const applied = { ...a, ...presetValues(portraitPresets[0], 100) };
  assert.equal(applied.rotation, 90);
  assert.equal(applied.contrast, 25);
  assert.equal(applied.skinUniformity, 20);
  for (const values of [
    { rotation: 90 },
    { skinSmooth: -2 },
    { exposure: 4 },
    { colorLut: {} },
    { __proto__: null, nonsense: 1 },
  ])
    assert.throws(() => validatePreset({ ...preset, values }));
  assert.throws(() => importPreset('{"format":"evoto-token"}', 'token.json'));
});
test('XMP maps supported fields, reverses vignette sign and explicitly warns about unsupported AI/profile/white balance', () => {
  const mapped = mapXmp({
    Exposure2012: '1.2',
    Contrast2012: '+20',
    HueAdjustmentBlue: '-25',
    PostCropVignetteAmount: '-30',
    Temperature: '5500',
    CameraProfile: 'Custom Profile',
    LocalCorrections: 'AI',
  });
  assert.equal(mapped.values.exposure, 1.2);
  assert.equal(mapped.values.mixer_blue_hue, -25);
  assert.equal(mapped.values.vignette, 30);
  assert.ok(!('temperature' in mapped.values));
  assert.match(mapped.warnings.join(), /Temperature.*CameraProfile.*LocalCorrections/);
  const xml = exportXmp({
    id: 'x',
    name: '"인물" & <테스트>',
    kind: 'color',
    values: mapped.values,
    warnings: [],
  });
  assert.match(xml, /crs:Exposure2012="1.2"/);
  assert.match(xml, /crs:PostCropVignetteAmount="-30"/);
  assert.match(xml, /&amp; &lt;테스트&gt;/);
  assert.throws(() => mapXmp({ Exposure2012: 'NaN' }));
  assert.throws(() => mapXmp({ CameraProfile: 'Only Profile' }));
});
