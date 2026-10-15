import { encodeLiquify, liquifyData, LIQUIFY_SIZE, sampleLiquifyInto } from './liquify.ts';
import type { Adjustments } from './engine.ts';
export type Landmark = { x: number; y: number; visibility?: number };
export type PortraitLandmarks = { faces: Landmark[][]; poses: Landmark[][] };
export const faceKeys = ['faceWidth', 'faceJaw', 'faceEyes', 'faceNose'] as const;
export const bodyKeys = ['bodyWaist', 'bodyShoulders', 'bodyHips'] as const;
export const hasPortraitEdits = (a: Adjustments) =>
  [...faceKeys, ...bodyKeys].some((k) => a[k] !== 0);
export function validatePortrait(value: unknown): PortraitLandmarks | null {
  if (value == null) return null;
  const v = value as PortraitLandmarks;
  const valid = (groups: Landmark[][], min: number, max: number) =>
    Array.isArray(groups) &&
    groups.length <= 5 &&
    groups.every(
      (points) =>
        Array.isArray(points) &&
        points.length >= min &&
        points.length <= max &&
        points.every(
          (p) =>
            p &&
            Number.isFinite(p.x) &&
            Number.isFinite(p.y) &&
            Math.abs(p.x) <= 2 &&
            Math.abs(p.y) <= 2 &&
            (p.visibility === undefined ||
              (Number.isFinite(p.visibility) && p.visibility >= 0 && p.visibility <= 1)),
        ),
    );
  if (!v || !valid(v.faces, 468, 478) || !valid(v.poses, 33, 33))
    throw Error('인물 인식 데이터가 올바르지 않습니다.');
  return v;
}
type Warp = { cx: number; cy: number; rx: number; ry: number; x: number; y: number };
const cache = new WeakMap<Adjustments, Adjustments>(),
  resolved = new WeakSet<Adjustments>();
/** Landmark-guided inverse deformations composed before the user's manual liquify field. */
export function withPortraitWarp(a: Adjustments): Adjustments {
  if (resolved.has(a) || !hasPortraitEdits(a) || !a.portraitLandmarks) return a;
  const previous = cache.get(a);
  if (previous) return previous;
  const warps: Warp[] = [];
  const add = (p: Landmark, rx: number, ry: number, x: number, y = 0) => {
    if (rx > 0.002 && ry > 0.002 && (x || y)) warps.push({ cx: p.x, cy: p.y, rx, ry, x, y });
  };
  for (const f of a.portraitLandmarks.faces) {
    const w = Math.abs(f[454].x - f[234].x),
      h = Math.abs(f[152].y - f[10].y);
    const center = { x: (f[234].x + f[454].x) / 2, y: (f[10].y + f[152].y) / 2 };
    add(center, w * 0.7, h * 0.7, (a.faceWidth / 100) * 0.18);
    add(
      { x: center.x, y: (f[172].y + f[397].y) / 2 },
      w * 0.65,
      h * 0.35,
      (a.faceJaw / 100) * 0.18,
    );
    for (const [l, r] of [
      [33, 133],
      [362, 263],
    ])
      add(
        { x: (f[l].x + f[r].x) / 2, y: (f[l].y + f[r].y) / 2 },
        w * 0.24,
        h * 0.16,
        (-a.faceEyes / 100) * 0.28,
        (-a.faceEyes / 100) * 0.28,
      );
    add(f[1], w * 0.2, h * 0.25, (a.faceNose / 100) * 0.22);
  }
  for (const p of a.portraitLandmarks.poses) {
    if ([11, 12, 23, 24].some((i) => (p[i].visibility ?? 0) < 0.65)) continue;
    const shoulder = { x: (p[11].x + p[12].x) / 2, y: (p[11].y + p[12].y) / 2 };
    const hip = { x: (p[23].x + p[24].x) / 2, y: (p[23].y + p[24].y) / 2 };
    const w = Math.max(Math.abs(p[11].x - p[12].x), Math.abs(p[23].x - p[24].x)),
      h = Math.abs(hip.y - shoulder.y);
    add(shoulder, w * 0.8, h * 0.45, (a.bodyShoulders / 100) * 0.22);
    add(
      { x: (shoulder.x + hip.x) / 2, y: shoulder.y + (hip.y - shoulder.y) * 0.65 },
      w * 0.7,
      h * 0.5,
      (a.bodyWaist / 100) * 0.25,
    );
    add(hip, w * 0.75, h * 0.4, (a.bodyHips / 100) * 0.22);
  }
  if (!warps.length) return a;
  const manual = liquifyData(a.liquify),
    data = new Float32Array(LIQUIFY_SIZE * LIQUIFY_SIZE * 2),
    offset = new Float64Array(2);
  for (let y = 0; y < LIQUIFY_SIZE; y++)
    for (let x = 0; x < LIQUIFY_SIZE; x++) {
      const u = x / (LIQUIFY_SIZE - 1),
        v = y / (LIQUIFY_SIZE - 1);
      let qx = u,
        qy = v;
      for (const w of warps) {
        const dx = (qx - w.cx) / w.rx,
          dy = (qy - w.cy) / w.ry,
          d = dx * dx + dy * dy;
        if (d >= 1) continue;
        const weight = (1 - d) ** 2;
        qx += (qx - w.cx) * w.x * weight;
        qy += (qy - w.cy) * w.y * weight;
      }
      if (manual) {
        sampleLiquifyInto(manual, qx, qy, offset);
        qx += offset[0];
        qy += offset[1];
      }
      const i = (y * LIQUIFY_SIZE + x) * 2;
      data[i] = Math.max(0, Math.min(1, qx)) - u;
      data[i + 1] = Math.max(0, Math.min(1, qy)) - v;
    }
  const result = { ...a, liquify: encodeLiquify(data) };
  cache.set(a, result);
  resolved.add(result);
  return result;
}
export function portraitCrop(width: number, height: number, a: Adjustments): Partial<Adjustments> {
  const faces = a.portraitLandmarks?.faces;
  if (!faces?.length) throw Error('먼저 얼굴을 인식해 주세요.');
  const oriented = (p: Landmark) => {
    const x = (p.x - 0.5) * width,
      y = (p.y - 0.5) * height,
      angle = (a.rotation * Math.PI) / 180,
      c = Math.round(Math.cos(angle)),
      s = Math.round(Math.sin(angle));
    return { x: (c * x - s * y) * (a.flip ? -1 : 1), y: s * x + c * y };
  };
  const boxes = faces.map((f) => {
    const p = f.map(oriented),
      xs = p.map((p) => p.x),
      ys = p.map((p) => p.y);
    return {
      left: Math.min(...xs),
      right: Math.max(...xs),
      top: Math.min(...ys),
      bottom: Math.max(...ys),
    };
  });
  const b = boxes.sort(
    (a, b) => (b.right - b.left) * (b.bottom - b.top) - (a.right - a.left) * (a.bottom - a.top),
  )[0];
  const W = a.rotation % 180 ? height : width,
    H = a.rotation % 180 ? width : height;
  const baseW = Math.min(W, H * 0.8),
    baseH = baseW / 0.8;
  const factor = Math.max(0.25, Math.min(1, ((b.right - b.left) * 2.5) / baseW));
  const cw = Math.round(baseW * factor),
    ch = Math.round(baseH * factor);
  const cx = (b.left + b.right) / 2,
    cy = (b.top + b.bottom) / 2 + (b.bottom - b.top) * 0.55;
  const clamp = (v: number) => Math.max(-100, Math.min(100, v));
  return {
    crop: '4:5',
    cropZoom: (1 - factor) / 0.0075,
    cropX: W === cw ? 0 : clamp((cx / ((W - cw) / 2)) * 100),
    cropY: H === ch ? 0 : clamp((cy / ((H - ch) / 2)) * 100),
  };
}
