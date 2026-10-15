import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { NativeGPUProcess, validateGeometry } from '../electron/native-gpu-process.ts';
import { defaults, outputSize } from '../src/engine.ts';
import { renderFloat } from '../src/precision-engine.ts';
import { encodeLiquify, newLiquifyData, pushLiquify } from '../src/liquify.ts';
import type { NativeGeometryRequest } from '../electron/native-gpu-types.ts';

function request(): NativeGeometryRequest {
  return {
    channel: 'precision',
    key: 'test',
    width: 37,
    height: 23,
    outputWidth: 37,
    outputHeight: 23,
    cropWidth: 37,
    cropHeight: 23,
    rotation: 0,
    flip: false,
    map: newLiquifyData(),
  };
}
test('native GPU boundary rejects invalid sizes, fields, and geometry', () => {
  for (const invalid of [
    { width: 0 },
    { outputWidth: 32_000_001 },
    { source: new Float32Array(4) },
    { map: new Float32Array(2) },
    { rotation: 45 },
    { cropWidth: NaN },
    { channel: 'arbitrary' },
    { key: '' },
  ])
    assert.throws(() => validateGeometry({ ...request(), ...invalid } as NativeGeometryRequest));
  const map = newLiquifyData();
  map[0] = NaN;
  assert.throws(() => validateGeometry({ ...request(), map }));
});

test(
  'Direct3D hardware matches CPU liquify, HDR alpha, crop/rotation, cached source, and resized output',
  {
    skip:
      process.platform !== 'win32'
        ? 'Windows hardware test'
        : !existsSync('native/bin/hinana-gpu.exe')
          ? 'Run npm run build:native first'
          : false,
  },
  async () => {
    const gpu = new NativeGPUProcess(path.resolve('native/bin/hinana-gpu.exe'));
    const source = {
      width: 37,
      height: 23,
      data: new Float32Array(37 * 23 * 4),
      colorSpace: 'display-p3' as const,
      hdr: true,
    };
    for (let y = 0; y < 23; y++)
      for (let x = 0; x < 37; x++) {
        const i = (y * 37 + x) * 4;
        source.data.set([x / 9, y / 8, ((x + y) % 7) / 3, (x % 5) / 4], i);
      }
    let first = true;
    try {
      for (const rotation of [0, 90, 180, 270, -90])
        for (const flip of [false, true]) {
          const map = newLiquifyData();
          pushLiquify(map, { x: 0.4, y: 0.4 }, { x: 0.5, y: 0.48 }, 0.3, 0.7, 37, 23);
          const a = {
            ...defaults,
            precision: 'float' as const,
            colorSpace: 'display-p3' as const,
            dynamicRange: 'hdr' as const,
            crop: '4:3',
            rotation,
            flip,
            liquify: encodeLiquify(map),
          };
          const [cw, ch] = outputSize(37, 23, a);
          for (const maxSide of [Infinity, 13]) {
            const scale = Math.min(1, maxSide / Math.max(cw, ch));
            const data = await gpu.render({
              ...request(),
              map,
              rotation,
              flip,
              source: first ? source.data : undefined,
              cropWidth: cw,
              cropHeight: ch,
              outputWidth: Math.max(1, Math.round(cw * scale)),
              outputHeight: Math.max(1, Math.round(ch * scale)),
            });
            first = false;
            const cpu = renderFloat(source, a, maxSide);
            const native = renderFloat(source, a, maxSide, data);
            let maxError = 0;
            for (let i = 0; i < cpu.data.length; i++) {
              // RGB is undefined for fully transparent pixels; compare premultiplied light.
              const alpha = i - (i % 4) + 3;
              const actual = native.data[i] * (i % 4 === 3 ? 1 : native.data[alpha]);
              const expected = cpu.data[i] * (i % 4 === 3 ? 1 : cpu.data[alpha]);
              maxError = Math.max(maxError, Math.abs(actual - expected));
            }
            assert.ok(
              maxError < 0.0003,
              `rotation=${rotation} flip=${flip} size=${maxSide} error=${maxError}`,
            );
          }
        }
      await assert.rejects(gpu.render({ ...request(), key: 'missing' }), /원본/);
      gpu.stop();
      await assert.rejects(gpu.render(request()), /원본/);
      const identity = await gpu.render({ ...request(), key: 'restart', source: source.data });
      assert.equal(identity.length, source.data.length);
    } finally {
      gpu.close();
    }
  },
);
