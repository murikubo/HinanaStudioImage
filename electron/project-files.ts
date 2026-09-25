import { app, BrowserWindow, ipcMain } from 'electron';
import { open } from 'node:fs/promises';
import path from 'node:path';

// Only OS-supplied project paths enter this queue; the renderer cannot read arbitrary paths.
const pending: string[] = [];
export function queueProjectFile(file: string) {
  if (!path.isAbsolute(file) || !/\.hinanaimage$/i.test(file) || pending.length >= 8) return;
  pending.push(file);
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('project:available');
}

export function queueProjectArguments(args: string[], cwd: string) {
  for (const arg of args) {
    if (!arg.startsWith('-') && /\.hinanaimage$/i.test(arg))
      queueProjectFile(path.resolve(cwd, arg));
  }
}

export function registerProjectFiles() {
  ipcMain.handle('project:take', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || event.senderFrame !== event.sender.mainFrame) throw Error('Invalid sender');
    const url = event.senderFrame.url;
    if (
      !(app.isPackaged
        ? url.startsWith('file://')
        : url.startsWith('file://') || url.startsWith('http://localhost:5173/'))
    )
      throw Error('Invalid origin');
    const file = pending.shift();
    if (!file) return null;
    try {
      const handle = await open(file, 'r');
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > 512 * 1024 * 1024)
          throw Error('512MB 이하의 프로젝트 파일만 열 수 있습니다.');
        return { name: path.basename(file), text: await handle.readFile('utf8') };
      } finally {
        await handle.close();
      }
    } catch {
      return { error: '프로젝트 파일을 읽지 못했습니다. 파일 위치와 크기를 확인해 주세요.' };
    }
  });
}
