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
