import type { Adjustments } from './engine';
import { colorContext, type WorkingColorSpace } from './color-space';
import { pngInfo, type FloatFrame } from './precision-codec';
import { P3_SRGB, SRGB_P3, transform, encoded, sdrMap, SDR_WHITE } from './precision-math';
type Result = { frame: FloatFrame; png: Uint8Array; width: number; height: number };
let worker: Worker | undefined,
  key = '',
  serial = 0,
  sourceSerial = 0;
const pending = new Map<
  number,
  { resolve: (r: Result) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
>();
function reset(error: Error) {
  worker?.terminate();
  worker = undefined;
  key = '';
  for (const job of pending.values()) {
    clearTimeout(job.timer);
    job.reject(error);
  }
  pending.clear();
}
function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./precision.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const job = pending.get(e.data.id);
      if (!job) return;
      pending.delete(e.data.id);
      clearTimeout(job.timer);
      if (e.data.error) {
        key = '';
        job.reject(new Error(e.data.error));
      } else job.resolve(e.data);
    };
    worker.onerror = () => reset(new Error('고정밀 처리 작업이 중단되었습니다.'));
  }
  return worker;
}
export function precisionSourceInfo(src: string) {
  if (!src.startsWith('data:image/png')) return { depth: 8, hdr: false };
  const binary = atob(src.slice(src.indexOf(',') + 1));
  return pngInfo(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}
function executePrecision(
  src: string,
  image: HTMLImageElement,
  a: Adjustments,
  maxSide: number,
  encode?: 'png16' | 'hdr-png',
  output?: WorkingColorSpace,
): Promise<Result> {
  const w = getWorker(),
    id = ++serial;
  let source: { src?: string; data?: Uint8ClampedArray; width: number; height: number } | undefined;
  const transfers: Transferable[] = [];
  if (key !== src) {
    const info = precisionSourceInfo(src);
    if (image.naturalWidth * image.naturalHeight > 32_000_000)
      return Promise.reject(new Error('고정밀 편집은 32MP 이하를 지원합니다.'));
    if (info.depth === 16 || info.hdr)
      source = { src, width: image.naturalWidth, height: image.naturalHeight };
    else {
      const c = document.createElement('canvas');
      c.width = image.naturalWidth;
      c.height = image.naturalHeight;
      const ctx = colorContext(c, 'display-p3');
      ctx.drawImage(image, 0, 0);
      const data = ctx.getImageData(0, 0, c.width, c.height, { colorSpace: 'display-p3' }).data;
      source = { data, width: c.width, height: c.height };
      transfers.push(data.buffer);
      c.width = c.height = 0;
    }
    key = src;
    sourceSerial++;
  }
  // The key is a stable identifier, not another full copy of the original data URL.
  const sourceKey = String(sourceSerial);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reset(new Error('고정밀 처리 시간이 초과되었습니다.')), 180_000);
    pending.set(id, { resolve, reject, timer });
    w.postMessage({ id, key: sourceKey, source, a, maxSide, encode, output }, transfers);
  });
}
// Serialize work and skip stale previews before allocating or decoding a source.
let renderQueue: Promise<void> = Promise.resolve();
export async function requestPrecision(
  src: string,
  image: HTMLImageElement,
  a: Adjustments,
  maxSide: number,
  encode?: 'png16' | 'hdr-png',
  output?: WorkingColorSpace,
  signal?: AbortSignal,
): Promise<Result> {
  const previous = renderQueue;
  let release!: () => void;
  renderQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    if (signal?.aborted) throw new DOMException('오래된 미리보기', 'AbortError');
    return await executePrecision(src, image, a, maxSide, encode, output);
  } finally {
    release();
  }
}
let hdrSupport: boolean | undefined;
export function hdrCanvasSupported() {
  if (hdrSupport !== undefined) return hdrSupport;
  try {
    const c = document.createElement('canvas') as HDRCanvas;
    if (
      !c.configureHighDynamicRange ||
      typeof (globalThis as unknown as { Float16Array?: unknown }).Float16Array !== 'function'
    )
      return (hdrSupport = false);
    c.configureHighDynamicRange({ mode: 'extended' });
    const ctx = c.getContext('2d', {
      colorSpace: 'display-p3',
      colorType: 'float16',
    } as CanvasRenderingContext2DSettings);
    return (hdrSupport =
      (ctx?.getContextAttributes() as { colorType?: string })?.colorType === 'float16');
  } catch {
    return (hdrSupport = false);
  }
}
type HDRCanvas = HTMLCanvasElement & {
  configureHighDynamicRange?: (options: { mode: 'extended' }) => void;
};
export function paintFloat(
  frame: FloatFrame,
  canvas: HTMLCanvasElement,
  output: WorkingColorSpace,
  hdr: boolean,
  peak: number,
): Uint8ClampedArray {
  canvas.width = frame.width;
  canvas.height = frame.height;
  const activeHDR = hdr && hdrCanvasSupported();
  if (activeHDR) (canvas as HDRCanvas).configureHighDynamicRange?.({ mode: 'extended' });
  const ctx = canvas.getContext('2d', {
    colorSpace: output,
    colorType: activeHDR ? 'float16' : 'unorm8',
    willReadFrequently: true,
  } as CanvasRenderingContext2DSettings)!;
  const matrix = output === frame.colorSpace ? undefined : output === 'srgb' ? P3_SRGB : SRGB_P3;
  const preview = new Uint8ClampedArray(frame.data.length);
  const Half = (globalThis as unknown as { Float16Array: new (length: number) => Float32Array })
    .Float16Array;
  const pixels = activeHDR ? new Half(frame.data.length) : preview;
  for (let i = 0; i < pixels.length; i += 4) {
    let [r, g, b] = matrix
      ? transform(matrix, frame.data[i], frame.data[i + 1], frame.data[i + 2])
      : [frame.data[i], frame.data[i + 1], frame.data[i + 2]];
    if (frame.hdr && !activeHDR) [r, g, b] = sdrMap(r, g, b);
    for (const [c, v] of [r, g, b].entries()) {
      const n = encoded(Math.min(activeHDR ? peak / SDR_WHITE : 1, Math.max(0, v)));
      pixels[i + c] = activeHDR ? n : n * 255;
      preview[i + c] = Math.min(1, n) * 255;
    }
    pixels[i + 3] = frame.data[i + 3] * (activeHDR ? 1 : 255);
    preview[i + 3] = frame.data[i + 3] * 255;
  }
  const ImageDataCtor = ImageData as unknown as new (
    data: Float32Array | Uint8ClampedArray,
    width: number,
    height: number,
    options: { colorSpace: WorkingColorSpace; pixelFormat?: string },
  ) => ImageData;
  ctx.putImageData(
    new ImageDataCtor(pixels, frame.width, frame.height, {
      colorSpace: output,
      ...(activeHDR ? { pixelFormat: 'rgba-float16' } : {}),
    }),
    0,
    0,
  );
  return preview;
}
