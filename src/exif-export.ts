import { dataURLBytes } from './image-bytes.ts';
import type { WorkingColorSpace } from './color-space.ts';
// Container references: https://www.w3.org/TR/png-3/#11eXIf
// https://developers.google.com/speed/webp/docs/riff_container
const ascii = (b: Uint8Array, start: number, size: number) =>
  String.fromCharCode(...b.subarray(start, start + size));
const bytes = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);
const join = (...parts: Uint8Array[]) => {
  const result = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    result.set(p, at);
    at += p.length;
  }
  return result;
};
const fail = () =>
  new Error(
    'EXIF를 안전하게 보존할 수 없습니다. 원본 파일을 확인하거나 EXIF 보존을 해제해 주세요.',
  );
function bound(b: Uint8Array, at: number, size: number) {
  if (at < 0 || size < 0 || at + size > b.length) throw fail();
}
function stripPrefix(b: Uint8Array) {
  return ascii(b, 0, 6) === 'Exif\0\0' ? b.slice(6) : b.slice();
}
export function extractExif(b: Uint8Array): Uint8Array | undefined {
  const v = view(b);
  if (b[0] === 255 && b[1] === 216) {
    let at = 2;
    while (at < b.length) {
      if (b[at++] !== 255) throw fail();
      while (b[at] === 255) at++;
      const marker = b[at++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      bound(b, at, 2);
      const size = v.getUint16(at);
      if (size < 2) throw fail();
      bound(b, at, size);
      if (marker === 0xe1 && ascii(b, at + 2, 6) === 'Exif\0\0') return b.slice(at + 8, at + size);
      at += size;
    }
  } else if (ascii(b, 1, 3) === 'PNG') {
    for (let at = 8; at < b.length;) {
      bound(b, at, 12);
      const size = v.getUint32(at);
      bound(b, at, size + 12);
      if (ascii(b, at + 4, 4) === 'eXIf') return stripPrefix(b.subarray(at + 8, at + 8 + size));
      at += size + 12;
    }
  } else if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') {
    for (let at = 12; at < b.length;) {
      bound(b, at, 8);
      const size = v.getUint32(at + 4, true);
      bound(b, at, 8 + size + (size % 2));
      if (ascii(b, at, 4) === 'EXIF') return stripPrefix(b.subarray(at + 8, at + 8 + size));
      at += 8 + size + (size % 2);
    }
  }
  return undefined;
}
/** Retain original TIFF offsets (including GPS and vendor tags). Append replacement directories.
 * Orientation/dimensions describe rendered pixels; old thumbnail is no longer referenced. */
export function normalizeExif(
  tiff: Uint8Array,
  width: number,
  height: number,
  colorSpace: WorkingColorSpace | 'rec2100-pq' = 'srgb',
): Uint8Array {
  bound(tiff, 0, 8);
  const endian = ascii(tiff, 0, 2);
  if (endian !== 'II' && endian !== 'MM') throw fail();
  const le = endian === 'II',
    v = view(tiff);
  if (v.getUint16(2, le) !== 42) throw fail();
  function entries(at: number): Map<number, Uint8Array> {
    bound(tiff, at, 2);
    const n = v.getUint16(at, le);
    // EXIF sub-IFDs from valid encoders may omit a next-IFD pointer.
    bound(tiff, at + 2, n * 12);
    const result = new Map<number, Uint8Array>();
    for (let i = 0; i < n; i++) {
      const pos = at + 2 + i * 12;
      result.set(v.getUint16(pos, le), tiff.slice(pos, pos + 12));
    }
    return result;
  }
  function scalar(tag: number, value: number, type = 4) {
    const out = new Uint8Array(12),
      d = view(out);
    d.setUint16(0, tag, le);
    d.setUint16(2, type, le);
    d.setUint32(4, 1, le);
    if (type === 3) d.setUint16(8, value, le);
    else d.setUint32(8, value, le);
    return out;
  }
  const root = entries(v.getUint32(4, le));
  const pointer = root.get(0x8769);
  const exif = pointer ? entries(view(pointer).getUint32(8, le)) : new Map<number, Uint8Array>();
  root.set(0x112, scalar(0x112, 1, 3));
  root.set(0x100, scalar(0x100, width));
  root.set(0x101, scalar(0x101, height));
  exif.set(0xa002, scalar(0xa002, width));
  exif.set(0xa003, scalar(0xa003, height));
  exif.set(0xa001, scalar(0xa001, colorSpace === 'srgb' ? 1 : 65535, 3));
  // Source interoperability declarations may name sRGB/Adobe RGB after conversion.
  exif.delete(0xa005);
  root.delete(0x8773);
  const base = tiff.length + (tiff.length % 2);
  const subAt = base;
  const rootAt = subAt + 2 + exif.size * 12 + 4;
  root.set(0x8769, scalar(0x8769, subAt));
  const out = new Uint8Array(rootAt + 2 + root.size * 12 + 4);
  out.set(tiff);
  const d = view(out);
  d.setUint32(4, rootAt, le);
  function write(at: number, fields: Map<number, Uint8Array>) {
    d.setUint16(at, fields.size, le);
    let pos = at + 2;
    for (const [, entry] of [...fields].sort((a, b) => a[0] - b[0])) {
      out.set(entry, pos);
      pos += 12;
    }
    d.setUint32(pos, 0, le);
  }
  write(subAt, exif);
  write(rootAt, root);
  return out;
}
export function crc32(b: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of b) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(kind: string, data: Uint8Array) {
  const out = new Uint8Array(data.length + 12),
    v = view(out);
  v.setUint32(0, data.length);
  out.set(bytes(kind), 4);
  out.set(data, 8);
  v.setUint32(out.length - 4, crc32(out.subarray(4, out.length - 4)));
  return out;
}
function riffChunk(kind: string, data: Uint8Array) {
  const out = new Uint8Array(8 + data.length + (data.length % 2));
  out.set(bytes(kind));
  view(out).setUint32(4, data.length, true);
  out.set(data, 8);
  return out;
}
/** The encoded argument is a fresh Canvas export; it has no source EXIF. */
export function injectExif(
  encoded: Uint8Array,
  tiff: Uint8Array,
  mime: string,
  width: number,
  height: number,
): Uint8Array {
  if (mime === 'image/jpeg') {
    const payload = join(bytes('Exif\0\0'), tiff);
    if (payload.length + 2 > 65535) throw fail();
    if (encoded[0] !== 255 || encoded[1] !== 216) throw fail();
    const header = new Uint8Array([255, 225, 0, 0]);
    view(header).setUint16(2, payload.length + 2);
    return join(encoded.subarray(0, 2), header, payload, encoded.subarray(2));
  }
  if (mime === 'image/png') {
    if (ascii(encoded, 1, 3) !== 'PNG') throw fail();
    bound(encoded, 8, 25);
    const end = 8 + view(encoded).getUint32(8) + 12;
    bound(encoded, 0, end);
    return join(encoded.subarray(0, end), pngChunk('eXIf', tiff), encoded.subarray(end));
  }
  if (mime === 'image/webp') {
    if (ascii(encoded, 0, 4) !== 'RIFF' || ascii(encoded, 8, 4) !== 'WEBP') throw fail();
    const chunks: Uint8Array[] = [];
    let extended = false,
      alpha = false;
    for (let at = 12; at < encoded.length;) {
      bound(encoded, at, 8);
      const size = view(encoded).getUint32(at + 4, true),
        end = at + 8 + size + (size % 2);
      bound(encoded, at, end - at);
      const type = ascii(encoded, at, 4),
        chunk = encoded.slice(at, end);
      if (type === 'VP8X') {
        bound(chunk, 8, 10);
        chunk[8] |= 8;
        extended = true;
      }
      if (type === 'ALPH' || (type === 'VP8L' && size >= 5 && chunk[12] & 16)) alpha = true;
      if (type !== 'EXIF') chunks.push(chunk);
      at = end;
    }
    if (!extended) {
      const payload = new Uint8Array(10);
      payload[0] = 8 | (alpha ? 16 : 0);
      for (let i = 0; i < 3; i++) {
        payload[4 + i] = ((width - 1) >>> (8 * i)) & 255;
        payload[7 + i] = ((height - 1) >>> (8 * i)) & 255;
      }
      chunks.unshift(riffChunk('VP8X', payload));
    }
    chunks.push(riffChunk('EXIF', tiff));
    const out = join(encoded.subarray(0, 12), ...chunks);
    view(out).setUint32(4, out.length - 8, true);
    return out;
  }
  throw fail();
}
export async function preserveExif(
  blob: Blob,
  original: string,
  width: number,
  height: number,
  colorSpace: WorkingColorSpace | 'rec2100-pq' = 'srgb',
): Promise<Blob> {
  const source = dataURLBytes(original);
  const tiff = extractExif(source);
  if (!tiff) return blob;
  const result = injectExif(
    new Uint8Array(await blob.arrayBuffer()),
    normalizeExif(tiff, width, height, colorSpace),
    blob.type,
    width,
    height,
  );
  return new Blob([new Uint8Array(result).buffer], { type: blob.type });
}
