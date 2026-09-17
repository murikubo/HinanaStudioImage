import { adjustPixels, outputSize, type Adjustments } from './engine.ts';
import { type FloatFrame } from './precision-codec.ts';
import { P3_SRGB, SRGB_P3, transform, linear, encoded } from './precision-math.ts';
/** Linear-light geometry, alpha-aware bilinear resampling, then unquantized edits. */
export function renderFloat(source: FloatFrame, a: Adjustments, maxSide: number): FloatFrame {
  const [cw, ch] = outputSize(source.width, source.height, a),
    scale = Math.min(1, maxSide / Math.max(cw, ch));
  const width = Math.max(1, Math.round(cw * scale)),
    height = Math.max(1, Math.round(ch * scale));
  const data = new Float32Array(width * height * 4),
    angle = (a.rotation * Math.PI) / 180,
    cos = Math.round(Math.cos(angle)),
    sin = Math.round(Math.sin(angle));
  const matrix =
    source.colorSpace === a.colorSpace ? undefined : a.colorSpace === 'srgb' ? P3_SRGB : SRGB_P3;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const dx = ((x + 0.5) / width - 0.5) * cw * (a.flip ? -1 : 1),
        dy = ((y + 0.5) / height - 0.5) * ch;
      const sx = cos * dx + sin * dy + source.width / 2 - 0.5,
        sy = -sin * dx + cos * dy + source.height / 2 - 0.5;
      const fx = Math.floor(sx),
        fy = Math.floor(sy),
        tx = sx - fx,
        ty = sy - fy;
      let r = 0,
        g = 0,
        b = 0,
        alpha = 0;
      for (let j = 0; j < 2; j++)
        for (let k = 0; k < 2; k++) {
          const xx = Math.max(0, Math.min(source.width - 1, fx + k)),
            yy = Math.max(0, Math.min(source.height - 1, fy + j)),
            p = (yy * source.width + xx) * 4;
          const w = (k ? tx : 1 - tx) * (j ? ty : 1 - ty),
            wa = w * source.data[p + 3];
          alpha += wa;
          r += source.data[p] * wa;
          g += source.data[p + 1] * wa;
          b += source.data[p + 2] * wa;
        }
      if (alpha > 0) {
        r /= alpha;
        g /= alpha;
        b /= alpha;
      }
      if (matrix) [r, g, b] = transform(matrix, r, g, b);
      const i = (y * width + x) * 4;
      data[i] = encoded(Math.max(0, r) * 2 ** a.exposure) * 255;
      data[i + 1] = encoded(Math.max(0, g) * 2 ** a.exposure) * 255;
      data[i + 2] = encoded(Math.max(0, b) * 2 ** a.exposure) * 255;
      data[i + 3] = alpha * 255;
    }
  adjustPixels(data, width, height, { ...a, exposure: 0 });
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) data[i + c] = Math.max(0, linear(data[i + c] / 255));
    data[i + 3] /= 255;
  }
  return { width, height, data, colorSpace: a.colorSpace, hdr: a.dynamicRange === 'hdr' };
}
