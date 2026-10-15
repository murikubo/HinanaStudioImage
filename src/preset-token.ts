import { exportPreset, importPreset, type UserPreset } from './preset-library.ts';
const MAX_TOKEN = 1_500_000,
  MAX_JSON = 24_000_000;
async function fingerprint(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(hash).slice(0, 8)].map((v) => v.toString(16).padStart(2, '0')).join('');
}
export async function createPresetToken(preset: UserPreset): Promise<string> {
  const text = exportPreset(preset);
  if (new Blob([text]).size > MAX_JSON) throw Error('큰 프리셋은 파일 내보내기를 사용해 주세요.');
  const bytes = new Uint8Array(
    await new Response(
      new Blob([text]).stream().pipeThrough(new CompressionStream('gzip')),
    ).arrayBuffer(),
  );
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  const payload = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const token = `HINANA1.${payload}.${await fingerprint(bytes)}`;
  if (token.length > MAX_TOKEN) throw Error('LUT가 큰 프리셋은 파일 내보내기를 사용해 주세요.');
  return token;
}
export async function readPresetToken(text: string): Promise<UserPreset> {
  const token = text.trim();
  if (token.length > MAX_TOKEN) throw Error('토큰이 너무 큽니다. 프리셋 파일을 사용해 주세요.');
  const match = /^HINANA1\.([A-Za-z0-9_-]+)\.([a-f0-9]{16})$/.exec(token);
  if (!match) throw Error('Hinana 공유 토큰 형식이 올바르지 않습니다.');
  const bytes = Uint8Array.from(atob(match[1].replace(/-/g, '+').replace(/_/g, '/')), (c) =>
    c.charCodeAt(0),
  );
  if ((await fingerprint(bytes)) !== match[2])
    throw Error('공유 토큰이 손상되었습니다. 전체를 다시 복사해 주세요.');
  const reader = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'))
    .getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_JSON) {
        await reader.cancel();
        throw Error('토큰의 프리셋 데이터가 너무 큽니다.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return importPreset(new TextDecoder('utf-8', { fatal: true }).decode(out), 'shared.hinanapreset');
}
