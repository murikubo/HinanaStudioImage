import { crc32 } from './exif-export.ts';
import type { WorkingColorSpace } from './color-space.ts';
const text = (b: Uint8Array, at: number, n: number) =>
  String.fromCharCode(...b.subarray(at, at + n));
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
function check(b: Uint8Array, at: number, size: number) {
  if (at < 0 || size < 0 || at + size > b.length)
    throw new Error('색상 프로파일을 기록할 이미지가 올바르지 않습니다.');
}
function pngChunk(kind: string, data: Uint8Array) {
  const result = new Uint8Array(data.length + 12);
  view(result).setUint32(0, data.length);
  result.set(bytes(kind), 4);
  result.set(data, 8);
  view(result).setUint32(result.length - 4, crc32(result.subarray(4, result.length - 4)));
  return result;
}
function riffChunk(kind: string, data: Uint8Array) {
  const result = new Uint8Array(8 + data.length + (data.length % 2));
  result.set(bytes(kind));
  view(result).setUint32(4, data.length, true);
  result.set(data, 8);
  return result;
}
/** Tag pixels only AFTER Canvas has converted them into the requested output space. */
export async function embedICC(
  encoded: Uint8Array,
  icc: Uint8Array,
  mime: string,
  width: number,
  height: number,
): Promise<Uint8Array> {
  if (icc.length < 128 || text(icc, 36, 4) !== 'acsp' || view(icc).getUint32(0) !== icc.length)
    throw new Error('ICC 프로파일이 올바르지 않습니다.');
  if (mime === 'image/png') {
    if (text(encoded, 1, 3) !== 'PNG') throw new Error('PNG 인코딩에 실패했습니다.');
    const stream = new Blob([new Uint8Array(icc).buffer])
      .stream()
      .pipeThrough(new CompressionStream('deflate'));
    const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
    const chunks = [encoded.subarray(0, 8)];
    for (let at = 8; at < encoded.length;) {
      check(encoded, at, 12);
      const size = view(encoded).getUint32(at);
      check(encoded, at, size + 12);
      const kind = text(encoded, at + 4, 4);
      if (!['iCCP', 'sRGB', 'cICP', 'gAMA', 'cHRM'].includes(kind))
        chunks.push(encoded.subarray(at, at + size + 12));
      if (kind === 'IHDR')
        chunks.push(pngChunk('iCCP', join(bytes('ICC profile\0\0'), compressed)));
      at += size + 12;
    }
    return join(...chunks);
  }
  if (mime === 'image/jpeg') {
    if (encoded[0] !== 255 || encoded[1] !== 216) throw new Error('JPEG 인코딩에 실패했습니다.');
    const parts = [encoded.subarray(0, 2)];
    const total = Math.ceil(icc.length / 65519);
    if (total > 255) throw new Error('ICC 프로파일이 너무 큽니다.');
    for (let i = 0; i < total; i++) {
      const payload = join(
        bytes('ICC_PROFILE\0'),
        new Uint8Array([i + 1, total]),
        icc.subarray(i * 65519, (i + 1) * 65519),
      );
      const header = new Uint8Array([255, 226, 0, 0]);
      view(header).setUint16(2, payload.length + 2);
      parts.push(header, payload);
    }
    for (let at = 2; at < encoded.length;) {
      check(encoded, at, 4);
      if (encoded[at] !== 255) throw new Error('JPEG 마커가 올바르지 않습니다.');
      const marker = encoded[at + 1];
      if (marker === 0xda || marker === 0xd9) {
        parts.push(encoded.subarray(at));
        break;
      }
      const size = view(encoded).getUint16(at + 2);
      if (size < 2) throw new Error('JPEG 마커 크기가 올바르지 않습니다.');
      check(encoded, at, size + 2);
      if (!(marker === 0xe2 && text(encoded, at + 4, 12) === 'ICC_PROFILE\0'))
        parts.push(encoded.subarray(at, at + size + 2));
      at += size + 2;
    }
    return join(...parts);
  }
  if (mime === 'image/webp') {
    if (text(encoded, 0, 4) !== 'RIFF' || text(encoded, 8, 4) !== 'WEBP')
      throw new Error('WebP 인코딩에 실패했습니다.');
    const chunks: Uint8Array[] = [];
    let extended: Uint8Array | undefined;
    let alpha = false,
      exif = false,
      xmp = false;
    for (let at = 12; at < encoded.length;) {
      check(encoded, at, 8);
      const size = view(encoded).getUint32(at + 4, true),
        length = 8 + size + (size % 2);
      check(encoded, at, length);
      const type = text(encoded, at, 4),
        chunk = encoded.slice(at, at + length);
      if (type === 'VP8X') {
        check(chunk, 8, 10);
        extended = chunk;
      } else if (type !== 'ICCP') chunks.push(chunk);
      alpha ||= type === 'ALPH' || (type === 'VP8L' && size >= 5 && !!(chunk[12] & 16));
      exif ||= type === 'EXIF';
      xmp ||= type === 'XMP ';
      at += length;
    }
    if (!extended) {
      const payload = new Uint8Array(10);
      payload[0] = (alpha ? 16 : 0) | (exif ? 8 : 0) | (xmp ? 4 : 0);
      for (let i = 0; i < 3; i++) {
        payload[4 + i] = ((width - 1) >>> (8 * i)) & 255;
        payload[7 + i] = ((height - 1) >>> (8 * i)) & 255;
      }
      extended = riffChunk('VP8X', payload);
    }
    extended[8] |= 32;
    const result = join(encoded.subarray(0, 12), extended, riffChunk('ICCP', icc), ...chunks);
    view(result).setUint32(4, result.length - 8, true);
    return result;
  }
  throw new Error('지원하지 않는 출력 형식입니다.');
}
const profiles = new Map<WorkingColorSpace, Promise<Uint8Array>>();
export async function tagOutput(
  blob: Blob,
  space: WorkingColorSpace,
  width: number,
  height: number,
): Promise<Blob> {
  if (!profiles.has(space))
    profiles.set(
      space,
      fetch(`./profiles/${space === 'display-p3' ? 'display-p3' : 'srgb'}.icc`)
        .then(async (r) => {
          if (!r.ok) throw new Error('색상 프로파일을 불러오지 못했습니다.');
          return new Uint8Array(await r.arrayBuffer());
        })
        .catch((error) => {
          profiles.delete(space);
          throw error;
        }),
    );
  const encoded = await embedICC(
    new Uint8Array(await blob.arrayBuffer()),
    await profiles.get(space)!,
    blob.type,
    width,
    height,
  );
  return new Blob([new Uint8Array(encoded).buffer], { type: blob.type });
}
