/** Avoid Uint8Array.from(string, mapper): it creates a huge intermediate JS array. */
export function dataURLBytes(url: string): Uint8Array {
  const encoded = url.slice(url.indexOf(',') + 1);
  const ctor = Uint8Array as typeof Uint8Array & { fromBase64?: (value: string) => Uint8Array };
  if (ctor.fromBase64) return ctor.fromBase64(encoded);
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
/** Read a small byte range without decoding/copying the entire large data URL. */
export function dataURLByteRange(url: string, start: number, end: number): Uint8Array {
  const offset = url.indexOf(',') + 1;
  const first = Math.floor(start / 3) * 4;
  const last = Math.ceil(end / 3) * 4;
  const binary = atob(url.slice(offset + first, offset + last));
  const skip = start % 3;
  const bytes = new Uint8Array(Math.max(0, Math.min(end - start, binary.length - skip)));
  for (let i = 0; i < bytes.length; i++) bytes[i] = binary.charCodeAt(skip + i);
  return bytes;
}
