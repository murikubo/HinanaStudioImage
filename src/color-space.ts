export type WorkingColorSpace = 'srgb' | 'display-p3';
export const colorSpaceName = (space: WorkingColorSpace) =>
  space === 'display-p3' ? 'Display P3' : 'sRGB';
export function supportsDisplayP3(): boolean {
  try {
    return (
      document
        .createElement('canvas')
        .getContext('2d', { colorSpace: 'display-p3' })
        ?.getContextAttributes().colorSpace === 'display-p3'
    );
  } catch {
    return false;
  }
}
export function colorContext(canvas: HTMLCanvasElement, space: WorkingColorSpace) {
  const context = canvas.getContext('2d', { colorSpace: space, willReadFrequently: true });
  if (!context || context.getContextAttributes().colorSpace !== space)
    throw new Error(
      `${colorSpaceName(space)} 작업 공간을 생성할 수 없습니다. 앱을 업데이트해 주세요.`,
    );
  return context;
}
export function convertCanvas(
  source: HTMLCanvasElement,
  space: WorkingColorSpace,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  colorContext(canvas, space).drawImage(source, 0, 0);
  return canvas;
}
// Display P3 and sRGB share the transfer curve. Matrices are D65, derived from
// W3C CSS Color 4 primaries. Only selection/proofing uses this conversion;
// editing keeps the full P3 pixel buffer.
const linear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const encoded = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
const lut = Array.from({ length: 256 }, (_, i) => linear(i / 255));
export function p3ToSRGB(r: number, g: number, b: number): [number, number, number] {
  const x = lut[Math.round(r)],
    y = lut[Math.round(g)],
    z = lut[Math.round(b)];
  return [
    encoded(1.224940176 * x - 0.224940176 * y),
    encoded(-0.042056955 * x + 1.042056955 * y),
    encoded(-0.019637555 * x - 0.078636046 * y + 1.098273601 * z),
  ].map((v) => v * 255) as [number, number, number];
}
