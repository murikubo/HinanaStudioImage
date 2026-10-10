/** A bounded inverse displacement map, in orientation-corrected original coordinates. */
export type Liquify = { width: number; height: number; data: string };
export const LIQUIFY_SIZE = 129;
const count = LIQUIFY_SIZE * LIQUIFY_SIZE * 2;
export function validateLiquify(value: unknown): Liquify | null {
  if (value == null) return null;
  const v = value as Liquify;
  if (
    v.width !== LIQUIFY_SIZE ||
    v.height !== LIQUIFY_SIZE ||
    typeof v.data !== 'string' ||
    v.data.length !== Math.ceil((count * 4) / 3) * 4
  )
    throw Error('리퀴파이 데이터가 올바르지 않습니다.');
  const bytes = Uint8Array.from(atob(v.data), (c) => c.charCodeAt(0));
  if (bytes.length !== count * 4) throw Error('리퀴파이 데이터 크기가 다릅니다.');
  const f = new Float32Array(bytes.buffer);
  if (f.some((n) => !Number.isFinite(n) || Math.abs(n) > 1))
    throw Error('리퀴파이 변형 범위가 올바르지 않습니다.');
  return v;
}
const cache = new WeakMap<Liquify, Float32Array>();
export function liquifyData(value: Liquify | null | undefined): Float32Array | undefined {
  if (!value) return;
  let f = cache.get(value);
  if (!f) {
    f = new Float32Array(Uint8Array.from(atob(value.data), (c) => c.charCodeAt(0)).buffer);
    cache.set(value, f);
  }
  return f;
}
export function encodeLiquify(data: Float32Array): Liquify {
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  const value = { width: LIQUIFY_SIZE, height: LIQUIFY_SIZE, data: btoa(binary) };
  cache.set(value, data.slice());
  return value;
}
/** Reuse the output pair in pixel loops: no per-pixel objects or closures. */
export function sampleLiquifyInto(data: Float32Array, x: number, y: number, out: Float64Array) {
  const n = LIQUIFY_SIZE - 1,
    gx = Math.max(0, Math.min(n, x * n)),
    gy = Math.max(0, Math.min(n, y * n));
  const ix = Math.min(n - 1, Math.floor(gx)),
    iy = Math.min(n - 1, Math.floor(gy)),
    tx = gx - ix,
    ty = gy - iy,
    p = (iy * LIQUIFY_SIZE + ix) * 2;
  for (let c = 0; c < 2; c++)
    out[c] =
      data[p + c] * (1 - tx) * (1 - ty) +
      data[p + 2 + c] * tx * (1 - ty) +
      data[p + LIQUIFY_SIZE * 2 + c] * (1 - tx) * ty +
      data[p + LIQUIFY_SIZE * 2 + 2 + c] * tx * ty;
}
export function sampleLiquify(data: Float32Array, x: number, y: number): [number, number] {
  const out = new Float64Array(2);
  sampleLiquifyInto(data, x, y, out);
  return [out[0], out[1]];
}
export function pushLiquify(
  data: Float32Array,
  from: { x: number; y: number },
  to: { x: number; y: number },
  radius: number,
  strength: number,
  width: number,
  height: number,
) {
  const rx = (radius * Math.min(width, height)) / width,
    ry = (radius * Math.min(width, height)) / height;
  const distance = Math.hypot((to.x - from.x) / rx, (to.y - from.y) / ry);
  const steps = Math.min(32, Math.max(1, Math.ceil(distance / 0.2)));
  const offset = new Float64Array(2);
  for (let step = 1; step <= steps; step++) {
    const cx = from.x + ((to.x - from.x) * step) / steps,
      cy = from.y + ((to.y - from.y) * step) / steps;
    const dx = ((to.x - from.x) * strength) / steps,
      dy = ((to.y - from.y) * strength) / steps,
      old = data.slice(),
      n = LIQUIFY_SIZE - 1;
    for (
      let y = Math.max(0, Math.floor((cy - ry) * n));
      y <= Math.min(n, Math.ceil((cy + ry) * n));
      y++
    )
      for (
        let x = Math.max(0, Math.floor((cx - rx) * n));
        x <= Math.min(n, Math.ceil((cx + rx) * n));
        x++
      ) {
        const d = Math.hypot((x / n - cx) / rx, (y / n - cy) / ry);
        if (d >= 1) continue;
        const weight = (1 - d * d) ** 2,
          qx = Math.max(0, Math.min(1, x / n - dx * weight)),
          qy = Math.max(0, Math.min(1, y / n - dy * weight));
        sampleLiquifyInto(old, qx, qy, offset);
        const ox = offset[0],
          oy = offset[1],
          p = (y * LIQUIFY_SIZE + x) * 2;
        data[p] = Math.max(0, Math.min(1, qx + ox)) - x / n;
        data[p + 1] = Math.max(0, Math.min(1, qy + oy)) - y / n;
      }
  }
}
export function newLiquifyData() {
  return new Float32Array(count);
}
