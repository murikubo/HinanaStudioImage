import { validatePortrait, type PortraitLandmarks } from './portrait-ai';
let worker: Worker | undefined,
  serial = 0;
let queue: Promise<unknown> = Promise.resolve();
const cached = new WeakMap<HTMLImageElement, Promise<PortraitLandmarks>>();
export function detectPortrait(image: HTMLImageElement): Promise<PortraitLandmarks> {
  const old = cached.get(image);
  if (old) return old;
  const run = queue
    .catch(() => {})
    .then(
      () =>
        new Promise<PortraitLandmarks>((resolve, reject) => {
          worker ??= new Worker(new URL('./portrait.worker.ts', import.meta.url));
          const target = worker,
            id = ++serial;
          const timer = setTimeout(() => {
            target.terminate();
            if (worker === target) worker = undefined;
            reject(Error('인물 인식 시간이 초과되었습니다.'));
          }, 90000);
          target.onerror = () => {
            clearTimeout(timer);
            target.terminate();
            if (worker === target) worker = undefined;
            reject(Error('인물 인식 모듈을 실행하지 못했습니다.'));
          };
          target.onmessage = (e) => {
            if (e.data.id !== id) return;
            clearTimeout(timer);
            if (e.data.error) {
              target.terminate();
              if (worker === target) worker = undefined;
              reject(Error(e.data.error));
            } else {
              try {
                resolve(validatePortrait(e.data.result)!);
              } catch (error) {
                reject(error);
              }
            }
          };
          const scale = Math.min(1, 1280 / Math.max(image.naturalWidth, image.naturalHeight));
          const c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(image.naturalWidth * scale));
          c.height = Math.max(1, Math.round(image.naturalHeight * scale));
          const ctx = c.getContext('2d')!;
          ctx.drawImage(image, 0, 0, c.width, c.height);
          const rgba = ctx.getImageData(0, 0, c.width, c.height).data;
          const base = window.hinana
            ? 'hinana-asset://portrait/'
            : new URL('./portrait/', document.baseURI).href;
          target.postMessage({ id, base, rgba, width: c.width, height: c.height }, [rgba.buffer]);
          c.width = c.height = 0;
        }),
    );
  queue = run;
  cached.set(image, run);
  void run.catch(() => cached.delete(image));
  return run;
}
