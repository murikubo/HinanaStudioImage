import { transform, SRGB_P3, P3_SRGB, linear, encoded } from './precision-math.ts';

export type CubeLut = { size: number; min: number[]; max: number[]; data: number[] };
export function validateCube(value: unknown): CubeLut | null {
  if (value == null) return null;
  const v = value as CubeLut;
  if (
    !Number.isInteger(v.size) ||
    v.size < 2 ||
    v.size > 65 ||
    !Array.isArray(v.data) ||
    v.data.length !== v.size ** 3 * 3 ||
    v.data.some((n) => typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > 16) ||
    !Array.isArray(v.min) ||
    !Array.isArray(v.max) ||
    v.min.length !== 3 ||
    v.max.length !== 3 ||
    v.min.some((n, i) => !Number.isFinite(n) || !Number.isFinite(v.max[i]) || n >= v.max[i])
  )
    throw Error('3D LUT 데이터가 올바르지 않습니다.');
  return { size: v.size, min: [...v.min], max: [...v.max], data: [...v.data] };
}
export function parseCube(text: string): { lut: CubeLut; name?: string } {
  let size = 0,
    name: string | undefined,
    min = [0, 0, 0],
    max = [1, 1, 1];
  const data: number[] = [];
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const s = line.replace(/#.*$/, '').trim();
    if (!s) continue;
    const parts = s.split(/\s+/),
      command = parts[0];
    if (command === 'TITLE') {
      name = s.slice(5).trim().replace(/^"|"$/g, '');
      continue;
    }
    if (command === 'LUT_3D_SIZE' && parts.length === 2 && !size) {
      size = Number(parts[1]);
      if (!Number.isInteger(size) || size < 2 || size > 65)
        throw Error('CUBE 크기는 2~65를 지원합니다.');
      continue;
    }
    if (['DOMAIN_MIN', 'DOMAIN_MAX'].includes(command) && parts.length === 4 && !data.length) {
      if (command === 'DOMAIN_MIN') min = parts.slice(1).map(Number);
      else max = parts.slice(1).map(Number);
      continue;
    }
    if (
      !size ||
      parts.length !== 3 ||
      parts.some((p) => !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(p))
    )
      throw Error('표준 3D CUBE만 지원합니다. 1D·결합 LUT는 지원하지 않습니다.');
    data.push(...parts.map(Number));
    if (data.length > size ** 3 * 3) throw Error('CUBE 색상 데이터가 너무 많습니다.');
  }
  return { lut: validateCube({ size, min, max, data })!, name };
}
/** Standard .cube ordering: red changes fastest, then green, then blue. */
export function sampleCube(lut: CubeLut, r: number, g: number, b: number, out: number[]) {
  const n = lut.size - 1;
  const x = Math.max(0, Math.min(1, (r - lut.min[0]) / (lut.max[0] - lut.min[0]))) * n;
  const y = Math.max(0, Math.min(1, (g - lut.min[1]) / (lut.max[1] - lut.min[1]))) * n;
  const z = Math.max(0, Math.min(1, (b - lut.min[2]) / (lut.max[2] - lut.min[2]))) * n;
  const ix = Math.min(n - 1, Math.floor(x)),
    iy = Math.min(n - 1, Math.floor(y)),
    iz = Math.min(n - 1, Math.floor(z));
  const tx = x - ix,
    ty = y - iy,
    tz = z - iz;
  out[0] = out[1] = out[2] = 0;
  for (let k = 0; k < 2; k++)
    for (let j = 0; j < 2; j++)
      for (let i = 0; i < 2; i++) {
        const p = (((iz + k) * lut.size + iy + j) * lut.size + ix + i) * 3;
        const w = (i ? tx : 1 - tx) * (j ? ty : 1 - ty) * (k ? tz : 1 - tz);
        for (let c = 0; c < 3; c++) out[c] += lut.data[p + c] * w;
      }
}
export function applyCube(
  data: Uint8ClampedArray | Float32Array,
  lut: CubeLut | null,
  amount: number,
  space: 'srgb' | 'display-p3',
) {
  if (!lut || !amount) return;
  const out = [0, 0, 0],
    mix = amount / 100;
  for (let i = 0; i < data.length; i += 4) {
    if (!data[i + 3]) continue;
    // LUTs are interpreted in encoded sRGB. Preserve HDR headroom as a per-pixel gain.
    const gain = Math.max(1, data[i] / 255, data[i + 1] / 255, data[i + 2] / 255);
    const rgb = [data[i] / (255 * gain), data[i + 1] / (255 * gain), data[i + 2] / (255 * gain)];
    const input =
      space === 'display-p3'
        ? transform(P3_SRGB, linear(rgb[0]), linear(rgb[1]), linear(rgb[2])).map((v) =>
            encoded(Math.max(0, v)),
          )
        : rgb;
    sampleCube(lut, input[0], input[1], input[2], out);
    const mapped =
      space === 'display-p3'
        ? transform(SRGB_P3, linear(out[0]), linear(out[1]), linear(out[2])).map((v) =>
            encoded(Math.max(0, v)),
          )
        : out;
    for (let c = 0; c < 3; c++)
      data[i + c] = Math.max(0, data[i + c] * (1 - mix) + mapped[c] * 255 * gain * mix);
  }
}
