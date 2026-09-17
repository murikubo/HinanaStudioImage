import { decode, encode } from 'fast-png';
import { crc32, extractExif } from './exif-export.ts';
import {
  D50_D65,
  XYZ_P3,
  SRGB_P3,
  R2020_P3,
  P3_R2020,
  P3_SRGB,
  multiply,
  transform,
  linear,
  encoded,
  pqDecode,
  pqEncode,
  sdrMap,
  SDR_WHITE,
  type Matrix,
} from './precision-math.ts';
import type { WorkingColorSpace } from './color-space.ts';
export type FloatFrame = {
  width: number;
  height: number;
  data: Float32Array;
  colorSpace: WorkingColorSpace;
  hdr: boolean;
};
const ascii = (b: Uint8Array, at: number, n: number) =>
  String.fromCharCode(...b.subarray(at, at + n));
export function pngChunks(bytes: Uint8Array) {
  const chunks = new Map<string, Uint8Array>();
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (ascii(bytes, 1, 3) !== 'PNG') return chunks;
  for (let at = 8; at < bytes.length;) {
    if (at + 12 > bytes.length) throw Error('PNG 데이터가 잘렸습니다.');
    const n = v.getUint32(at);
    if (at + n + 12 > bytes.length) throw Error('PNG 청크가 잘렸습니다.');
    chunks.set(ascii(bytes, at + 4, 4), bytes.subarray(at + 8, at + 8 + n));
    at += n + 12;
  }
  return chunks;
}
export function pngInfo(bytes: Uint8Array) {
  const c = pngChunks(bytes),
    h = c.get('IHDR'),
    p = c.get('cICP');
  return { depth: h?.[8] || 8, hdr: !!p && (p[1] === 16 || p[1] === 18) };
}
function profileMatrix(icc: Uint8Array) {
  const v = new DataView(icc.buffer, icc.byteOffset, icc.byteLength);
  const tags = new Map<string, { at: number; size: number }>();
  if (icc.length < 132 || ascii(icc, 16, 4) !== 'RGB ' || ascii(icc, 20, 4) !== 'XYZ ')
    throw Error('이 ICC는 고정밀 RGB 매트릭스 프로파일이 아닙니다.');
  const count = v.getUint32(128);
  if (count > 1000 || 132 + count * 12 > icc.length) throw Error('ICC 태그가 올바르지 않습니다.');
  for (let i = 0; i < count; i++) {
    const p = 132 + i * 12,
      at = v.getUint32(p + 4),
      size = v.getUint32(p + 8);
    if (at + size > icc.length) throw Error('ICC 태그 범위를 초과했습니다.');
    tags.set(ascii(icc, p, 4), { at, size });
  }
  if (tags.has('A2B0') || tags.has('D2B0'))
    throw Error('LUT ICC 프로파일은 고정밀 PNG 불러오기에서 아직 지원하지 않습니다.');
  const cols = ['rXYZ', 'gXYZ', 'bXYZ'].map((key) => {
    const t = tags.get(key);
    if (!t || t.size < 20 || ascii(icc, t.at, 4) !== 'XYZ ')
      throw Error('ICC 원색 정보가 없습니다.');
    return [8, 12, 16].map((o) => v.getInt32(t.at + o) / 65536);
  });
  const matrix = multiply(
    multiply(XYZ_P3, D50_D65),
    [0, 1, 2].map((i) => cols.map((c) => c[i])),
  );
  const curves = ['rTRC', 'gTRC', 'bTRC'].map((key) => {
    const t = tags.get(key);
    if (!t || t.size < 12) throw Error('ICC 감마 정보가 없습니다.');
    const kind = ascii(icc, t.at, 4);
    let fn: (x: number) => number;
    if (kind === 'curv') {
      const count = v.getUint32(t.at + 8);
      if (12 + count * 2 > t.size) throw Error('ICC 감마 테이블이 잘렸습니다.');
      if (count === 0) fn = (x) => x;
      else if (count === 1) {
        const gamma = v.getUint16(t.at + 12) / 256;
        fn = (x) => x ** gamma;
      } else
        fn = (x) => {
          const p = x * (count - 1),
            lo = Math.floor(p),
            hi = Math.min(count - 1, lo + 1);
          return (
            (v.getUint16(t.at + 12 + lo * 2) * (1 - (p - lo)) +
              v.getUint16(t.at + 12 + hi * 2) * (p - lo)) /
            65535
          );
        };
    } else if (kind === 'para') {
      const type = v.getUint16(t.at + 8),
        counts = [1, 3, 4, 5, 7];
      if (type > 4 || 12 + counts[type] * 4 > t.size)
        throw Error('ICC 감마 함수가 올바르지 않습니다.');
      const p = Array.from(
        { length: counts[type] },
        (_, i) => v.getInt32(t.at + 12 + i * 4) / 65536,
      );
      const [g, a, b, c, d, e, f] = p;
      fn = (x) =>
        type === 0
          ? x ** g
          : type === 1
            ? x >= -b / a
              ? (a * x + b) ** g
              : 0
            : type === 2
              ? x >= -b / a
                ? (a * x + b) ** g + c
                : c
              : type === 3
                ? x >= d
                  ? (a * x + b) ** g
                  : c * x
                : x >= d
                  ? (a * x + b) ** g + e
                  : c * x + f;
    } else throw Error('지원하지 않는 ICC 감마 형식입니다.');
    const lut = new Float32Array(65536);
    for (let i = 0; i < lut.length; i++) {
      const x = fn(i / 65535);
      if (!Number.isFinite(x)) throw Error('ICC 감마 값이 올바르지 않습니다.');
      lut[i] = x;
    }
    return lut;
  });
  return { matrix, curves };
}
export const MAX_FLOAT_PIXELS = 32_000_000;
export function decodePrecisionPNG(bytes: Uint8Array): FloatFrame {
  const chunks = pngChunks(bytes),
    header = chunks.get('IHDR');
  if (!header) throw Error('PNG 헤더가 없습니다.');
  const hv = new DataView(header.buffer, header.byteOffset, header.byteLength);
  if (hv.getUint32(0) * hv.getUint32(4) > MAX_FLOAT_PIXELS)
    throw Error('고정밀 편집은 32MP 이하를 지원합니다.');
  const image = decode(bytes, { checkCrc: true });
  if (image.palette) throw Error('인덱스 PNG는 일반 이미지 경로로 불러와 주세요.');
  const data = new Float32Array(image.width * image.height * 4),
    max = image.depth === 16 ? 65535 : 255;
  const cicp = chunks.get('cICP');
  let hdr = false,
    matrix: Matrix | undefined,
    curves: Float32Array[] | undefined;
  if (cicp) {
    if (cicp.length !== 4 || cicp[2] !== 0 || cicp[3] !== 1)
      throw Error('지원하지 않는 PNG CICP 범위입니다.');
    if (cicp[0] === 9 && cicp[1] === 16) {
      hdr = true;
      matrix = R2020_P3;
    } else if ((cicp[0] === 1 || cicp[0] === 12) && cicp[1] === 13) {
      matrix = cicp[0] === 1 ? SRGB_P3 : undefined;
    } else
      throw Error(
        'HDR 입력은 BT.2100 PQ PNG를 지원합니다. HLG/다른 CICP는 아직 지원하지 않습니다.',
      );
  } else if (image.iccEmbeddedProfile) {
    ({ matrix, curves } = profileMatrix(image.iccEmbeddedProfile.profile));
  } else matrix = SRGB_P3;
  const gamma = chunks.get('gAMA');
  const gammaValue = gamma
    ? new DataView(gamma.buffer, gamma.byteOffset, gamma.byteLength).getUint32(0) / 100000
    : undefined;
  const transfer = (v: number, c: number) =>
    curves
      ? curves[c][image.depth === 16 ? v : v * 257]
      : hdr
        ? pqDecode(v / max) / SDR_WHITE
        : !cicp && !chunks.has('sRGB') && !image.iccEmbeddedProfile && gammaValue
          ? (v / max) ** (1 / gammaValue)
          : linear(v / max);
  for (let i = 0, p = 0; i < data.length; i += 4, p += image.channels) {
    const gray = image.channels < 3;
    const raw = [image.data[p], image.data[p + (gray ? 0 : 1)], image.data[p + (gray ? 0 : 2)]];
    const r = transfer(raw[0], 0),
      g = transfer(raw[1], 1),
      b = transfer(raw[2], 2);
    const rgb = matrix ? transform(matrix, r, g, b) : [r, g, b];
    data[i] = rgb[0];
    data[i + 1] = rgb[1];
    data[i + 2] = rgb[2];
    data[i + 3] =
      image.channels === 2 || image.channels === 4 ? image.data[p + image.channels - 1] / max : 1;
    if (image.transparency && raw.every((v, c) => v === image.transparency![gray ? 0 : c]))
      data[i + 3] = 0;
  }
  let orientation = 1;
  const exif = extractExif(bytes);
  if (exif && exif.length >= 8) {
    const v = new DataView(exif.buffer, exif.byteOffset, exif.byteLength),
      le = exif[0] === 73;
    const at = v.getUint32(4, le);
    if (at + 2 <= exif.length) {
      const count = v.getUint16(at, le);
      for (let i = 0; i < count && at + 2 + (i + 1) * 12 <= exif.length; i++) {
        const p = at + 2 + i * 12;
        if (
          v.getUint16(p, le) === 274 &&
          v.getUint16(p + 2, le) === 3 &&
          v.getUint32(p + 4, le) === 1
        )
          orientation = v.getUint16(p + 8, le);
      }
    }
  }
  if (orientation >= 2 && orientation <= 8) {
    const w = image.width,
      h = image.height,
      swap = orientation >= 5,
      width = swap ? h : w,
      height = swap ? w : h;
    const rotated = new Float32Array(data.length);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let dx = x,
          dy = y;
        if (orientation === 2) dx = w - 1 - x;
        else if (orientation === 3) {
          dx = w - 1 - x;
          dy = h - 1 - y;
        } else if (orientation === 4) dy = h - 1 - y;
        else if (orientation === 5) {
          dx = y;
          dy = x;
        } else if (orientation === 6) {
          dx = h - 1 - y;
          dy = x;
        } else if (orientation === 7) {
          dx = h - 1 - y;
          dy = w - 1 - x;
        } else if (orientation === 8) {
          dx = y;
          dy = w - 1 - x;
        }
        rotated.set(data.subarray((y * w + x) * 4, (y * w + x) * 4 + 4), (dy * width + dx) * 4);
      }
    return { width, height, data: rotated, colorSpace: 'display-p3', hdr };
  }
  return { width: image.width, height: image.height, data, colorSpace: 'display-p3', hdr };
}
export function addPNGChunk(png: Uint8Array, kind: string, payload: Uint8Array) {
  const chunk = new Uint8Array(payload.length + 12),
    v = new DataView(chunk.buffer);
  v.setUint32(0, payload.length);
  chunk.set(
    Uint8Array.from(kind, (c) => c.charCodeAt(0)),
    4,
  );
  chunk.set(payload, 8);
  v.setUint32(chunk.length - 4, crc32(chunk.subarray(4, chunk.length - 4)));
  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, 33));
  out.set(chunk, 33);
  out.set(png.subarray(33), 33 + chunk.length);
  return out;
}
export function encodePrecisionPNG(
  frame: FloatFrame,
  output: WorkingColorSpace | 'rec2100-pq',
  peak: number,
): Uint8Array {
  const result = new Uint16Array(frame.data.length);
  const inputToP3 = frame.colorSpace === 'srgb' ? SRGB_P3 : undefined;
  for (let i = 0; i < result.length; i += 4) {
    let [r, g, b] = inputToP3
      ? transform(inputToP3, frame.data[i], frame.data[i + 1], frame.data[i + 2])
      : [frame.data[i], frame.data[i + 1], frame.data[i + 2]];
    if (output === 'rec2100-pq') {
      [r, g, b] = transform(P3_R2020, r, g, b);
      for (const [c, v] of [r, g, b].entries())
        result[i + c] = Math.round(pqEncode(Math.min(peak, Math.max(0, v) * SDR_WHITE)) * 65535);
    } else {
      if (output === 'srgb') [r, g, b] = transform(P3_SRGB, r, g, b);
      if (frame.hdr) [r, g, b] = sdrMap(r, g, b);
      for (const [c, v] of [r, g, b].entries())
        result[i + c] = Math.round(Math.min(1, Math.max(0, encoded(v))) * 65535);
    }
    result[i + 3] = Math.round(Math.min(1, Math.max(0, frame.data[i + 3])) * 65535);
  }
  let png = encode(
    { width: frame.width, height: frame.height, channels: 4, depth: 16, data: result },
    { zlib: { level: 6 } },
  );
  if (output === 'rec2100-pq') png = addPNGChunk(png, 'cICP', new Uint8Array([9, 16, 0, 1]));
  return png;
}
