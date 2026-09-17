import { linear, encoded } from './precision-math.ts';
export type MaskPoint = { x: number; y: number; start?: boolean; exclude?: boolean };
export type MaskStroke = { points: MaskPoint[]; radius: number; feather: number; erase: boolean };
export type SubjectTool = 'ai' | 'add' | 'erase';
export const MAX_REFINE_POINTS = 4096;
export const MAX_REFINE_STROKES = 128;
export type LocalMask = {
  id: string;
  name: string;
  kind: 'brush' | 'linear' | 'radial' | 'subject';
  raster?: { width: number; height: number; data: string };
  strokes?: MaskStroke[];
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
    name:
      kind === 'subject'
        ? '피사체'
        : kind === 'brush'
          ? '브러시'
          : kind === 'linear'
            ? '선형 그라디언트'
            : '원형 그라디언트',
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
  if (mask.kind === 'subject') {
    if (!mask.raster) return result;
    const raster = mask.raster,
      bytes = decodeRaster(raster);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const p = maskToSource({ x: (x + 0.5) / width, y: (y + 0.5) / height }, g);
        const xx = Math.max(0, Math.min(raster.width - 1, p.x * raster.width - 0.5));
        const yy = Math.max(0, Math.min(raster.height - 1, p.y * raster.height - 0.5));
        const x0 = Math.floor(xx),
          y0 = Math.floor(yy),
          x1 = Math.min(raster.width - 1, x0 + 1),
          y1 = Math.min(raster.height - 1, y0 + 1);
        const fx = xx - x0,
          fy = yy - y0;
        result[y * width + x] =
          ((bytes[y0 * raster.width + x0] * (1 - fx) + bytes[y0 * raster.width + x1] * fx) *
            (1 - fy) +
            (bytes[y1 * raster.width + x0] * (1 - fx) + bytes[y1 * raster.width + x1] * fx) * fy) /
          255;
      }
  } else if (mask.kind === 'brush') {
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
  if (mask.kind === 'subject') {
    for (const stroke of mask.strokes || []) {
      const weights = maskCoverage(
        {
          ...newMask('brush', 'stroke'),
          points: stroke.points,
          radius: stroke.radius,
          feather: stroke.feather,
        },
        width,
        height,
        g,
      );
      for (let i = 0; i < result.length; i++)
        result[i] = stroke.erase
          ? result[i] * (1 - weights[i])
          : result[i] + (1 - result[i]) * weights[i];
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
      !['brush', 'linear', 'radial', 'subject'].includes(m.kind) ||
      typeof m.enabled !== 'boolean' ||
      typeof m.inverted !== 'boolean' ||
      !Array.isArray(m.points) ||
      m.points.length > MAX_MASK_POINTS ||
      (['linear', 'radial'].includes(m.kind) && m.points.length !== 2) ||
      (m.kind === 'subject' && (m.points.length > 32 || m.points[0]?.exclude))
    )
      throw Error('마스크 데이터가 올바르지 않습니다.');
    ids.add(m.id);
    if (m.strokes !== undefined) {
      if (
        m.kind !== 'subject' ||
        !m.raster ||
        !Array.isArray(m.strokes) ||
        m.strokes.length > MAX_REFINE_STROKES
      )
        throw Error('수동 마스크 수정 데이터가 올바르지 않습니다.');
      let count = 0;
      for (const stroke of m.strokes) {
        if (
          !stroke ||
          typeof stroke.erase !== 'boolean' ||
          !Array.isArray(stroke.points) ||
          !stroke.points.length ||
          !Number.isFinite(stroke.radius) ||
          stroke.radius < 0.005 ||
          stroke.radius > 0.5 ||
          !Number.isFinite(stroke.feather) ||
          stroke.feather < 0 ||
          stroke.feather > 1
        )
          throw Error('수동 브러시 데이터가 올바르지 않습니다.');
        count += stroke.points.length;
        if (count > MAX_REFINE_POINTS) throw Error('수동 브러시 경로가 너무 많습니다.');
        for (const p of stroke.points)
          if (
            !p ||
            !Number.isFinite(p.x) ||
            !Number.isFinite(p.y) ||
            p.x < 0 ||
            p.x > 1 ||
            p.y < 0 ||
            p.y > 1
          )
            throw Error('수동 브러시 좌표가 올바르지 않습니다.');
      }
    }
    if (m.kind === 'subject') {
      if (m.points.some((p: MaskPoint) => typeof p?.exclude !== 'boolean'))
        throw Error('피사체 선택 좌표가 올바르지 않습니다.');
      if (m.raster) decodeRaster(m.raster);
      if (m.points.length && !m.raster) throw Error('피사체 선택 영역이 없습니다.');
    } else if (m.raster !== undefined) throw Error('마스크 종류가 올바르지 않습니다.');
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

const rasterCache = new WeakMap<object, Uint8Array>();
export function decodeRaster(r: NonNullable<LocalMask['raster']>): Uint8Array {
  if (
    !r ||
    typeof r !== 'object' ||
    !Number.isInteger(r.width) ||
    !Number.isInteger(r.height) ||
    r.width < 1 ||
    r.height < 1 ||
    r.width > 1024 ||
    r.height > 1024 ||
    typeof r.data !== 'string' ||
    r.data.length !== Math.ceil((r.width * r.height) / 3) * 4 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(r.data)
  )
    throw Error('피사체 선택 영역 데이터가 올바르지 않습니다.');
  const cached = rasterCache.get(r);
  if (cached) return cached;
  const decoded = atob(r.data);
  if (decoded.length !== r.width * r.height)
    throw Error('피사체 선택 영역 크기가 올바르지 않습니다.');
  const bytes = Uint8Array.from(decoded, (c) => c.charCodeAt(0));
  rasterCache.set(r, bytes);
  return bytes;
}
