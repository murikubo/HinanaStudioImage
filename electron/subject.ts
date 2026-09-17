import {
  app,
  ipcMain,
  utilityProcess,
  type UtilityProcess,
  type IpcMainInvokeEvent,
} from 'electron';
import path from 'node:path';
let worker: UtilityProcess | undefined;
let pending:
  | {
      id: number;
      resolve: (v: unknown) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  | undefined;
let serial = 0;
let idle: ReturnType<typeof setTimeout> | undefined;
function stop(message = '피사체 선택이 취소되었습니다.') {
  const old = worker;
  worker = undefined;
  if (idle) clearTimeout(idle);
  if (pending) {
    clearTimeout(pending.timer);
    pending.reject(Error(message));
    pending = undefined;
  }
  old?.kill();
}
function trusted(e: IpcMainInvokeEvent) {
  if (!e.senderFrame || e.senderFrame !== e.sender.mainFrame)
    throw Error('Invalid subject selection sender');
  const url = e.senderFrame.url;
  if (!url.startsWith('file://') && !(!app.isPackaged && url.startsWith('http://localhost:5173/')))
    throw Error('Invalid origin');
}
export function registerSubjectSelector() {
  ipcMain.handle('subject:cancel', (e) => {
    trusted(e);
    stop();
  });
  ipcMain.handle('subject:select', async (e, input) => {
    trusted(e);
    const { rgba, width, height, points } = input || {};
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 1 ||
      height < 1 ||
      Math.max(width, height) !== 1024 ||
      !(rgba instanceof Uint8Array || rgba instanceof Uint8ClampedArray) ||
      rgba.length !== width * height * 4 ||
      !Array.isArray(points) ||
      !points.length ||
      points.length > 32 ||
      points[0]?.exclude ||
      points.some(
        (p) =>
          !p ||
          !Number.isFinite(p.x) ||
          !Number.isFinite(p.y) ||
          p.x < 0 ||
          p.x > 1 ||
          p.y < 0 ||
          p.y > 1 ||
          typeof p.exclude !== 'boolean',
      )
    )
      throw Error('피사체 선택 입력이 올바르지 않습니다.');
    if (pending) throw Error('피사체 선택이 이미 진행 중입니다.');
    if (idle) clearTimeout(idle);
    if (!worker) {
      const models = app.isPackaged
        ? path.join(process.resourcesPath, 'models/slimsam')
        : path.join(__dirname, '../models/slimsam');
      const current = utilityProcess.fork(path.join(__dirname, 'subject-worker.mjs'), [models], {
        serviceName: 'Hinana Subject Selection',
        stdio: 'pipe',
      });
      worker = current;
      current.on('message', (message) => {
        if (worker !== current || !pending || pending.id !== message.id) return;
        const job = pending;
        pending = undefined;
        clearTimeout(job.timer);
        if (message.error) job.reject(Error('피사체 인식에 실패했습니다. 다시 시도해 주세요.'));
        else job.resolve(message.raster);
        idle = setTimeout(() => stop(), 120000);
      });
      current.on('error', () => {
        if (worker === current) stop('피사체 인식 엔진을 시작하지 못했습니다.');
      });
      current.on('exit', () => {
        if (worker === current) stop('피사체 인식 엔진이 종료되었습니다.');
      });
    }
    return new Promise((resolve, reject) => {
      const id = ++serial;
      pending = {
        id,
        resolve,
        reject,
        timer: setTimeout(() => stop('피사체 인식 시간이 초과되었습니다.'), 120000),
      };
      worker!.postMessage({ id, rgba, width, height, points });
    });
  });
  app.on('before-quit', () => stop());
}
