import { dataURLBytes } from './image-bytes.ts';
import { decodePrecisionPNG, encodePrecisionPNG, type FloatFrame } from './precision-codec';
import { linear } from './precision-math';
import { renderFloat } from './precision-engine';
import { outputSize } from './engine';
import { liquifyData } from './liquify';
import type { NativeGeometryRequest } from '../electron/native-gpu-types';
import type { Adjustments } from './engine';
const workerScope = self as unknown as {
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};
let cachedKey = '',
  cached: FloatFrame | undefined;
let gpuKey = '',
  gpuFailed = false;
let gpuPending:
  { resolve: (data: Float32Array) => void; reject: (error: Error) => void } | undefined;
function requestGPU(request: NativeGeometryRequest): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    gpuPending = { resolve, reject };
    workerScope.postMessage({ kind: 'native-geometry', request });
  });
}
self.onmessage = async (
  event: MessageEvent<{
    id: number;
    key: string;
    source?: { src?: string; data?: Uint8ClampedArray; width: number; height: number };
    a: Adjustments;
    maxSide: number;
    encode?: 'png16' | 'hdr-png';
    output?: 'srgb' | 'display-p3';
    nativeGPU?: boolean;
    kind?: string;
    data?: Float32Array;
    error?: string;
  }>,
) => {
  const request = event.data;
  if (request.kind === 'native-geometry-result') {
    const pending = gpuPending;
    gpuPending = undefined;
    if (request.error) pending?.reject(new Error(request.error));
    else if (request.data) pending?.resolve(request.data);
    else pending?.reject(new Error('Windows GPU 응답이 없습니다.'));
    return;
  }
  try {
    if (request.source) {
      cached = undefined;
      cachedKey = '';
      gpuKey = '';
      gpuFailed = false;
      const source = request.source;
      if (source.src) {
        const bytes = dataURLBytes(source.src);
        cached = decodePrecisionPNG(bytes);
      } else {
        const input = source.data!;
        const data = new Float32Array(input.length);
        for (let i = 0; i < input.length; i++)
          data[i] = i % 4 === 3 ? input[i] / 255 : linear(input[i] / 255);
        cached = {
          width: source.width,
          height: source.height,
          data,
          colorSpace: 'display-p3',
          hdr: false,
        };
      }
      cachedKey = request.key;
    }
    if (!cached || cachedKey !== request.key) throw Error('고정밀 원본을 다시 불러와 주세요.');
    let geometry: Float32Array | undefined;
    if (request.nativeGPU && request.a.liquify && !gpuFailed) {
      const [cw, ch] = outputSize(cached.width, cached.height, request.a);
      const scale = Math.min(1, request.maxSide / Math.max(cw, ch));
      try {
        geometry = await requestGPU({
          channel: 'precision',
          key: cachedKey,
          source: gpuKey === cachedKey ? undefined : cached.data,
          width: cached.width,
          height: cached.height,
          outputWidth: Math.max(1, Math.round(cw * scale)),
          outputHeight: Math.max(1, Math.round(ch * scale)),
          cropWidth: cw,
          cropHeight: ch,
          rotation: request.a.rotation,
          flip: request.a.flip,
          map: liquifyData(request.a.liquify)!,
        });
        gpuKey = cachedKey;
      } catch (error) {
        gpuFailed = true;
        console.warn('Windows Direct3D 11 unavailable; using CPU geometry.', error);
      }
    }
    const frame = renderFloat(cached, request.a, request.maxSide, geometry);
    if (request.a.liquify) frame.geometryBackend = geometry ? 'direct3d11' : 'cpu';
    if (request.encode) {
      const data = encodePrecisionPNG(
        frame,
        request.encode === 'hdr-png' ? 'rec2100-pq' : request.output!,
        request.a.hdrPeak,
      );
      workerScope.postMessage(
        { id: request.id, png: data, width: frame.width, height: frame.height },
        [data.buffer as ArrayBuffer],
      );
    } else workerScope.postMessage({ id: request.id, frame }, [frame.data.buffer as ArrayBuffer]);
  } catch (error) {
    workerScope.postMessage({ id: request.id, error: (error as Error).message });
  }
};
