import { decodePrecisionPNG, encodePrecisionPNG, type FloatFrame } from './precision-codec';
import { linear } from './precision-math';
import { renderFloat } from './precision-engine';
import type { Adjustments } from './engine';
const workerScope = self as unknown as {
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};
let cachedKey = '',
  cached: FloatFrame | undefined;
self.onmessage = (
  event: MessageEvent<{
    id: number;
    key: string;
    source?: { src?: string; data?: Uint8ClampedArray; width: number; height: number };
    a: Adjustments;
    maxSide: number;
    encode?: 'png16' | 'hdr-png';
    output?: 'srgb' | 'display-p3';
  }>,
) => {
  const request = event.data;
  try {
    if (request.source) {
      cached = undefined;
      cachedKey = '';
      const source = request.source;
      if (source.src) {
        const s = atob(source.src.slice(source.src.indexOf(',') + 1));
        const bytes = Uint8Array.from(s, (c) => c.charCodeAt(0));
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
    const frame = renderFloat(cached, request.a, request.maxSide);
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
