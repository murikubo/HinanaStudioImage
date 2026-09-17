export type Matrix = readonly (readonly number[])[];
export type RGB = [number, number, number];
export const SRGB_XYZ: Matrix = [
  [0.4123907993, 0.3575843394, 0.1804807884],
  [0.2126390059, 0.7151686788, 0.0721923154],
  [0.0193308187, 0.1191947798, 0.9505321522],
];
export const P3_XYZ: Matrix = [
  [0.4865709486, 0.2656676932, 0.1982172852],
  [0.2289745641, 0.6917385218, 0.0792869141],
  [0, 0.0451133819, 1.0439443689],
];
export const R2020_XYZ: Matrix = [
  [0.6369580483, 0.1446169036, 0.1688809752],
  [0.262700212, 0.6779980715, 0.0593017165],
  [0, 0.028072693, 1.0609850577],
];
export const XYZ_P3: Matrix = [
  [2.4934969119, -0.9313836179, -0.4027107845],
  [-0.8294889696, 1.7626640603, 0.0236246858],
  [0.0358458302, -0.0761723893, 0.956884524],
];
export const XYZ_SRGB: Matrix = [
  [3.2409699419, -1.5373831776, -0.4986107603],
  [-0.9692436363, 1.8759675015, 0.0415550574],
  [0.0556300797, -0.2039769589, 1.0569715142],
];
export const XYZ_R2020: Matrix = [
  [1.716651188, -0.3556707838, -0.2533662814],
  [-0.6666843518, 1.6164812366, 0.0157685458],
  [0.0176398574, -0.0427706133, 0.9421031212],
];
export const D50_D65: Matrix = [
  [0.9554734215, -0.0230984549, 0.0632592432],
  [-0.0283697093, 1.0099953981, 0.0210414412],
  [0.0123140149, -0.0205076493, 1.3303659262],
];
export const multiply = (a: Matrix, b: Matrix): Matrix =>
  a.map((row) => [0, 1, 2].map((c) => row.reduce((s, v, k) => s + v * b[k][c], 0)));
export const transform = (m: Matrix, r: number, g: number, b: number): RGB => [
  m[0][0] * r + m[0][1] * g + m[0][2] * b,
  m[1][0] * r + m[1][1] * g + m[1][2] * b,
  m[2][0] * r + m[2][1] * g + m[2][2] * b,
];
export const P3_SRGB = multiply(XYZ_SRGB, P3_XYZ),
  SRGB_P3 = multiply(XYZ_P3, SRGB_XYZ);
export const P3_R2020 = multiply(XYZ_R2020, P3_XYZ),
  R2020_P3 = multiply(XYZ_P3, R2020_XYZ);
export const linear = (x: number) =>
  Math.sign(x) *
  (Math.abs(x) <= 0.04045 ? Math.abs(x) / 12.92 : ((Math.abs(x) + 0.055) / 1.055) ** 2.4);
export const encoded = (x: number) =>
  Math.sign(x) *
  (Math.abs(x) <= 0.0031308 ? Math.abs(x) * 12.92 : 1.055 * Math.abs(x) ** (1 / 2.4) - 0.055);
export const SDR_WHITE = 203;
const m1 = 2610 / 16384,
  m2 = 2523 / 32,
  c1 = 3424 / 4096,
  c2 = 2413 / 128,
  c3 = 2392 / 128;
export function pqEncode(nits: number) {
  const y = (Math.max(0, Math.min(10000, nits)) / 10000) ** m1;
  return ((c1 + c2 * y) / (1 + c3 * y)) ** m2;
}
export function pqDecode(pq: number) {
  const p = Math.max(0, Math.min(1, pq)) ** (1 / m2);
  return 10000 * (Math.max(0, p - c1) / (c2 - c3 * p)) ** (1 / m1);
}
/** Luminance-preserving soft shoulder for SDR. Applies only to HDR→SDR, not SDR edits. */
export function sdrMap(r: number, g: number, b: number): RGB {
  const peak = Math.max(0, r, g, b);
  const mapped = peak <= 0.5 ? peak : 0.5 + 0.5 * (1 - Math.exp(-2 * (peak - 0.5)));
  const gain = peak > 0 ? mapped / peak : 1;
  return [r * gain, g * gain, b * gain];
}
