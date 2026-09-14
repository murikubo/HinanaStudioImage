export type SkinSettings = { skinSmooth: number; skinRedness: number; skinBrightness: number };
const smoothstep = (a: number, b: number, v: number) => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** Soft chroma selection, not face detection. Similar-colored background can be selected. */
export function skinWeight(r: number, g: number, b: number): number {
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  return (
    smoothstep(25, 55, y) *
    (1 - smoothstep(235, 255, y)) *
    smoothstep(75, 88, cb) *
    (1 - smoothstep(126, 140, cb)) *
    smoothstep(130, 142, cr) *
    (1 - smoothstep(175, 190, cr))
  );
}
/** Five-tap separable bilateral smoothing with a soft skin mask and preserved alpha. */
export function retouchSkin(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  a: SkinSettings,
) {
  if (!a.skinSmooth && !a.skinRedness && !a.skinBrightness) return;
  const source = data.slice();
  const radius = Math.max(1, Math.min(12, Math.round(Math.min(width, height) * 0.003)));
  let blurred = source;
  if (a.skinSmooth > 0) {
    for (const horizontal of [true, false]) {
      const out = new Uint8ClampedArray(source.length);
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          out[i + 3] = source[i + 3];
          if (!source[i + 3] || skinWeight(source[i], source[i + 1], source[i + 2]) < 0.01) {
            out.set(blurred.subarray(i, i + 4), i);
            continue;
          }
          let total = 0,
            r = 0,
            g = 0,
            b = 0;
          for (let k = -2; k <= 2; k++) {
            const xx = Math.max(0, Math.min(width - 1, x + (horizontal ? k * radius : 0)));
            const yy = Math.max(0, Math.min(height - 1, y + (horizontal ? 0 : k * radius)));
            const j = (yy * width + xx) * 4;
            const dr = source[i] - source[j],
              dg = source[i + 1] - source[j + 1],
              db = source[i + 2] - source[j + 2];
            const difference = (dr * dr + dg * dg + db * db) / (3 * 22 * 22);
            const w =
              (((k === 0 ? 1 : Math.abs(k) === 1 ? 0.8 : 0.4) / (1 + difference * difference)) *
                source[j + 3]) /
              255;
            total += w;
            r += blurred[j] * w;
            g += blurred[j + 1] * w;
            b += blurred[j + 2] * w;
          }
          out[i] = r / total;
          out[i + 1] = g / total;
          out[i + 2] = b / total;
        }
      blurred = out;
    }
  }
  for (let i = 0; i < data.length; i += 4) {
    if (!source[i + 3]) continue;
    const mask = skinWeight(source[i], source[i + 1], source[i + 2]);
    if (!mask) continue;
    const mix = ((mask * a.skinSmooth) / 100) * 0.85;
    let r = source[i] + (blurred[i] - source[i]) * mix;
    let g = source[i + 1] + (blurred[i + 1] - source[i + 1]) * mix;
    let b = source[i + 2] + (blurred[i + 2] - source[i + 2]) * mix;
    const red = ((Math.max(0, r - g - 18) * mask * a.skinRedness) / 100) * 0.45;
    r -= red;
    g += red * 0.45;
    b += red * 0.2;
    const light = ((mask * a.skinBrightness) / 100) * 18;
    data[i] = r + light;
    data[i + 1] = g + light;
    data[i + 2] = b + light;
  }
}
