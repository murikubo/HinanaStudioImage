import { adjustPixels, outputSize, renderPhoto, type Adjustments } from './engine';
import { applyLocalMasks } from './local-masks';
import { colorContext } from './color-space';
import { liquifyData } from './liquify';

let cachedImage: HTMLImageElement | undefined,
  cachedSpace = '',
  serial = 0,
  failed = false;
// Serialize previews and exports so their source-cache uploads cannot overtake one another.
let queue: Promise<unknown> = Promise.resolve();
export function renderPhotoWindows(
  image: HTMLImageElement,
  canvas: HTMLCanvasElement,
  a: Adjustments,
  maxSide = 1600,
  signal?: AbortSignal,
): Promise<ImageData> {
  const result = queue.then(async () => {
    if (signal?.aborted) throw new DOMException('오래된 미리보기', 'AbortError');
    if (cachedImage !== image || cachedSpace !== a.colorSpace) failed = false;
    const bridge = window.hinana;
    if (!a.liquify || bridge?.platform !== 'win32' || failed) {
      canvas.dataset.liquifyBackend = a.liquify ? 'webgl2' : 'none';
      return renderPhoto(image, canvas, a, maxSide);
    }
    try {
      const [cw, ch] = outputSize(image.naturalWidth, image.naturalHeight, a);
      const scale = Math.min(1, maxSide / Math.max(cw, ch));
      const width = Math.max(1, Math.round(cw * scale)),
        height = Math.max(1, Math.round(ch * scale));
      let source: Float32Array | undefined;
      if (cachedImage !== image || cachedSpace !== a.colorSpace) {
        const stage = document.createElement('canvas');
        stage.width = image.naturalWidth;
        stage.height = image.naturalHeight;
        if (stage.width * stage.height > 32_000_000)
          throw Error('Windows GPU는 32MP 이하를 지원합니다.');
        const ctx = colorContext(stage, a.colorSpace);
        ctx.drawImage(image, 0, 0);
        const data = ctx.getImageData(0, 0, stage.width, stage.height, {
          colorSpace: a.colorSpace,
        }).data;
        source = Float32Array.from(data, (v) => v / 255);
        stage.width = stage.height = 0;
        serial++;
      }
      const data = await bridge.nativeGeometry({
        channel: 'legacy',
        key: String(serial),
        source,
        width: image.naturalWidth,
        height: image.naturalHeight,
        outputWidth: width,
        outputHeight: height,
        cropWidth: cw,
        cropHeight: ch,
        rotation: a.rotation,
        flip: a.flip,
        map: liquifyData(a.liquify)!,
      });
      cachedImage = image;
      cachedSpace = a.colorSpace;
      if (signal?.aborted) throw new DOMException('오래된 미리보기', 'AbortError');
      canvas.width = width;
      canvas.height = height;
      const ctx = colorContext(canvas, a.colorSpace);
      const pixels = ctx.createImageData(width, height, { colorSpace: a.colorSpace });
      for (let i = 0; i < data.length; i++) pixels.data[i] = data[i] * 255;
      adjustPixels(pixels.data, width, height, a);
      applyLocalMasks(
        pixels.data,
        width,
        height,
        a.masks || [],
        {
          width: image.naturalWidth,
          height: image.naturalHeight,
          cropWidth: cw,
          cropHeight: ch,
          rotation: a.rotation,
          flip: a.flip,
        },
        a.colorSpace,
        false,
      );
      ctx.putImageData(pixels, 0, 0);
      canvas.dataset.liquifyBackend = 'direct3d11';
      return pixels;
    } catch (error) {
      if ((error as Error).name === 'AbortError') throw error;
      cachedImage = image;
      cachedSpace = a.colorSpace;
      failed = true;
      console.warn('Windows Direct3D 11 unavailable; using WebGL.', error);
      canvas.dataset.liquifyBackend = 'webgl2';
      return renderPhoto(image, canvas, a, maxSide);
    }
  });
  queue = result.catch(() => {});
  return result;
}
