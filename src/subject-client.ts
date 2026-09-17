import { loadImage, defaults } from './engine';
import { paintFloat, precisionSourceInfo, requestPrecision } from './precision-client';
import type { MaskPoint } from './local-masks';
/** Recognition uses an SDR proxy only; original precision and working pixels remain untouched. */
export async function selectSubject(src: string, points: MaskPoint[], signal: AbortSignal) {
  if (!window.hinana) throw Error('피사체 선택은 데스크톱 앱에서 사용할 수 있습니다.');
  const image = await loadImage(src);
  signal.throwIfAborted();
  const canvas = document.createElement('canvas');
  const info = precisionSourceInfo(src);
  let source: CanvasImageSource = image;
  if (info.depth === 16 || info.hdr) {
    const result = await requestPrecision(
      src,
      image,
      { ...defaults, precision: 'float' },
      1024,
      undefined,
      'srgb',
      signal,
    );
    const proxy = document.createElement('canvas');
    paintFloat(result.frame, proxy, 'srgb', false, defaults.hdrPeak);
    source = proxy;
  }
  signal.throwIfAborted();
  const scale = 1024 / Math.max(image.naturalWidth, image.naturalHeight);
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const ctx = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const cancel = () => {
    void window.hinana?.cancelSubject();
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    return await window.hinana.selectSubject({
      rgba,
      width: canvas.width,
      height: canvas.height,
      points: points.map((p) => ({ x: p.x, y: p.y, exclude: !!p.exclude })),
    });
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}
