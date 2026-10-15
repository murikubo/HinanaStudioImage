import { app, ipcMain } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { NativeGPUProcess, validateGeometry } from './native-gpu-process';
import type { NativeGeometryRequest } from './native-gpu-types';

export function registerNativeGPU() {
  if (process.platform !== 'win32') return;
  const clients = new Map<number, Map<string, NativeGPUProcess>>();
  const executable = app.isPackaged
    ? path.join(process.resourcesPath, 'gpu', 'hinana-gpu.exe')
    : path.join(__dirname, '..', 'native', 'bin', 'hinana-gpu.exe');
  ipcMain.handle('gpu:geometry', (event, request: NativeGeometryRequest) => {
    const frame = event.senderFrame;
    const expected = pathToFileURL(path.join(__dirname, '..', 'dist', 'index.html')).href;
    if (
      !frame ||
      frame !== event.sender.mainFrame ||
      (frame.url !== expected &&
        !(
          !app.isPackaged &&
          process.env.HINANA_DEV_SERVER_URL &&
          new URL(frame.url).origin === new URL(process.env.HINANA_DEV_SERVER_URL).origin
        ))
    )
      throw new Error('허용되지 않은 GPU 요청입니다.');
    validateGeometry(request);
    let channels = clients.get(event.sender.id);
    if (!channels) {
      channels = new Map();
      clients.set(event.sender.id, channels);
      const id = event.sender.id;
      event.sender.once('destroyed', () => {
        for (const gpu of clients.get(id)?.values() || []) gpu.close();
        clients.delete(id);
      });
    }
    let gpu = channels.get(request.channel);
    if (!gpu) {
      gpu = new NativeGPUProcess(executable);
      channels.set(request.channel, gpu);
    }
    return gpu.render(request);
  });
  app.on('before-quit', () => {
    for (const channels of clients.values()) for (const gpu of channels.values()) gpu.close();
    clients.clear();
  });
}
