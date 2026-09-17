import { linear, encoded } from './precision-math.ts';
export type MaskPoint = { x: number; y: number; start?: boolean };
export type LocalMask = {
  id: string;
  name: string;
  kind: 'brush' | 'linear' | 'radial';
  points: MaskPoint[];
  radius: number;
  feather: number;
  opacity: number;
  inverted: boolean;
  enabled: boolean;
  exposure: number;
  contrast: number;
  saturation: number;
  temperature: number;
};
export type MaskGeometry = {
  width: number;
  height: number;
  cropWidth: number;
  cropHeight: number;
  rotation: number;
  flip: boolean;
};
export const MAX_MASKS = 8;
export const MAX_MASK_POINTS = 1024;
export function newMask(kind: LocalMask['kind'], id: string): LocalMask {
  return {
    id,
    name: kind === 'brush' ? '브러시' : kind === 'linear' ? '선형 그라디언트' : '원형 그라디언트',
    kind,
    points: [],
    radius: 0.08,
    feather: 0.65,
    opacity: 1,
    inverted: false,
    enabled: true,
    exposure: 0,
    contrast: 0,
    saturation: 0,
    temperature: 0,
  };
}
/** Coordinates are anchored to the uncropped, orientation-corrected source. */
export function maskToDisplay(p: MaskPoint, g: MaskGeometry): MaskPoint {
  const angle = (g.rotation * Math.PI) / 180,
    c = Math.round(Math.cos(angle)),
    s = Math.round(Math.sin(angle));
  const x = (p.x - 0.5) * g.width,
    y = (p.y - 0.5) * g.height;
  return {
    x: 0.5 + ((c * x - s * y) * (g.flip ? -1 : 1)) / g.cropWidth,
    y: 0.5 + (s * x + c * y) / g.cropHeight,
  };
}
export function maskToSource(p: MaskPoint, g: MaskGeometry): MaskPoint {
  const angle = (g.rotation * Math.PI) / 180,
    c = Math.round(Math.cos(angle)),
    s = Math.round(Math.sin(angle));
  const x = (p.x - 0.5) * g.cropWidth * (g.flip ? -1 : 1),
    y = (p.y - 0.5) * g.cropHeight;
  return { x: 0.5 + (c * x + s * y) / g.width, y: 0.5 + (-s * x + c * y) / g.height };
}
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const edge = (distance: number, feather: number) => {
  if (distance >= 1) return 0;
  if (feather <= 0) return 1;
  const t = clamp((distance - (1 - feather)) / feather);
  return 1 - t * t * (3 - 2 * t);
};
/** Scalar coverage only: no quantization of image pixels. Brush segments use bounded rasterization. */
export function maskCoverage(
  mask: LocalMask,
  width: number,
  height: number,
  g: MaskGeometry,
): Float32Array {
  const result = new Float32Array(width * height);
  if (!mask.enabled || !mask.points.length) return result;
  const points = mask.points.map((p) => {
    const v = maskToDisplay(p, g);
    return { x: v.x * width, y: v.y * height, start: p.start };
  });
  if (mask.kind === 'brush') {
    const radius = Math.max(0.5, (mask.radius * Math.min(g.width, g.height) * width) / g.cropWidth);
    for (let k = 0; k < points.length; k++) {
      const a = points[points[k].start ? k : Math.max(0, k - 1)],
        b = points[k],
        dx = b.x - a.x,
        dy = b.y - a.y,
        length = dx * dx + dy * dy;
      const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x) - radius)),
        x1 = Math.min(width - 1, Math.ceil(Math.max(a.x, b.x) + radius));
      const y0 = Math.max(0, Math.floor(Math.min(a.y, b.y) - radius)),
        y1 = Math.min(height - 1, Math.ceil(Math.max(a.y, b.y) + radius));
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const t = length ? clamp(((x + 0.5 - a.x) * dx + (y + 0.5 - a.y) * dy) / length) : 0;
          const d = Math.hypot(x + 0.5 - a.x - t * dx, y + 0.5 - a.y - t * dy) / radius;
          const i = y * width + x;
          result[i] = Math.max(result[i], edge(d, mask.feather));
        }
    }
  } else if (points.length >= 2) {
    const [a, b] = points,
      dx = b.x - a.x,
      dy = b.y - a.y,
      length = dx * dx + dy * dy;
    if (length < 0.000001) return result;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const d =
          mask.kind === 'radial'
            ? Math.hypot(
                (x + 0.5 - a.x) / Math.max(0.5, Math.abs(dx)),
                (y + 0.5 - a.y) / Math.max(0.5, Math.abs(dy)),
              )
            : ((x + 0.5 - a.x) * dx + (y + 0.5 - a.y) * dy) / length;
        result[y * width + x] = edge(d, mask.feather);
      }
  }
  for (let i = 0; i < result.length; i++)
    result[i] = (mask.inverted ? 1 - result[i] : result[i]) * mask.opacity;
  return result;
}
/** Local edits are composited in linear light after global edits, retaining HDR headroom and alpha. */
export function applyLocalMasks(
  data: Float32Array | Uint8ClampedArray,
  width: number,
  height: number,
  masks: LocalMask[],
  g: MaskGeometry,
  colorSpace: 'srgb' | 'display-p3',
  linearInput: boolean,
) {
  for (const mask of masks) {
    if (
      !mask.enabled ||
      !mask.opacity ||
      (!mask.exposure && !mask.contrast && !mask.saturation && !mask.temperature)
    )
      continue;
    const coverage = maskCoverage(mask, width, height, g),
      gain = 2 ** mask.exposure,
      contrast = (1 + mask.contrast / 100) ** 2,
      sat = 1 + mask.saturation / 100,
      w =
        colorSpace === 'display-p3' ? [0.2289746, 0.6917385, 0.0792869] : [0.2126, 0.7152, 0.0722];
    for (let p = 0; p < coverage.length; p++) {
      const f = coverage[p],
        i = p * 4;
      if (!f || !data[i + 3]) continue;
      const r = linearInput ? data[i] : linear(data[i] / 255),
        g = linearInput ? data[i + 1] : linear(data[i + 1] / 255),
        b = linearInput ? data[i + 2] : linear(data[i + 2] / 255);
      let rr = (r * gain - 0.18) * contrast + 0.18,
        gg = (g * gain - 0.18) * contrast + 0.18,
        bb = (b * gain - 0.18) * contrast + 0.18;
      rr *= 2 ** (mask.temperature * 0.003);
      bb *= 2 ** (-mask.temperature * 0.003);
      const l = rr * w[0] + gg * w[1] + bb * w[2];
      rr = l + (rr - l) * sat;
      gg = l + (gg - l) * sat;
      bb = l + (bb - l) * sat;
      for (const [c, v] of [r + (rr - r) * f, g + (gg - g) * f, b + (bb - b) * f].entries())
        data[i + c] = linearInput
          ? Math.max(0, v)
          : Math.max(0, Math.min(255, encoded(Math.max(0, v)) * 255));
    }
  }
}
export function validateMasks(value: unknown): LocalMask[] {
  if (!Array.isArray(value) || value.length > MAX_MASKS)
    throw Error('마스크는 사진당 8개까지 지원합니다.');
  const ids = new Set<string>();
  for (const m of value) {
    if (
      !m ||
      typeof m.id !== 'string' ||
      m.id.length > 80 ||
      ids.has(m.id) ||
      typeof m.name !== 'string' ||
      m.name.length > 80 ||
      !['brush', 'linear', 'radial'].includes(m.kind) ||
      typeof m.enabled !== 'boolean' ||
      typeof m.inverted !== 'boolean' ||
      !Array.isArray(m.points) ||
      m.points.length > MAX_MASK_POINTS ||
      (m.kind !== 'brush' && m.points.length !== 2)
    )
      throw Error('마스크 데이터가 올바르지 않습니다.');
    ids.add(m.id);
    for (const p of m.points)
      if (
        !p ||
        (p.start !== undefined && typeof p.start !== 'boolean') ||
        !Number.isFinite(p.x) ||
        !Number.isFinite(p.y) ||
        p.x < 0 ||
        p.x > 1 ||
        p.y < 0 ||
        p.y > 1
      )
        throw Error('마스크 좌표가 올바르지 않습니다.');
    for (const [key, min, max] of [
      ['radius', 0.005, 0.5],
      ['feather', 0, 1],
      ['opacity', 0, 1],
      ['exposure', -3, 3],
      ['contrast', -100, 100],
      ['saturation', -100, 100],
      ['temperature', -100, 100],
    ] as const)
      if (!Number.isFinite(m[key]) || m[key] < min || m[key] > max)
        throw Error('마스크 보정 범위를 초과했습니다.');
  }
  return value;
}
