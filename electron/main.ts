import { registerRawDecoder } from './raw';
import { app, BrowserWindow, Menu, shell, nativeTheme } from 'electron';
import path from 'node:path';
// Limit the opt-in to the Canvas HDR presentation API; no broad experimental flags.
app.commandLine.appendSwitch('enable-blink-features', 'CanvasHDR');
function createWindow() {
  const win = new BrowserWindow({
    width: 1540,
    height: 980,
    minWidth: 1000,
    minHeight: 700,
    backgroundColor: '#151719',
    title: 'Hinana Studio Image',
    titleBarStyle: 'hidden',
    autoHideMenuBar: process.platform !== 'darwin',
    icon: path.join(__dirname, '../dist/app-icon.png'),
    ...(process.platform === 'darwin'
      ? { trafficLightPosition: { x: 17, y: 24 } }
      : { titleBarOverlay: { color: '#1b1d1f', symbolColor: '#d7d9d9', height: 63 } }),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault();
  });
  if (!app.isPackaged && process.env.HINANA_DEV_SERVER_URL)
    void win.loadURL(process.env.HINANA_DEV_SERVER_URL);
  else void win.loadFile(path.join(__dirname, '../dist/index.html'));
}
app.whenReady().then(() => {
  nativeTheme.themeSource = 'dark';
  registerRawDecoder();
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === 'darwin'
        ? [
            {
              label: 'Hinana Studio Image',
              submenu: [
                {
                  id: 'app-about',
                  label: 'Hinana Studio Image 정보',
                  click: () => {
                    const win =
                      BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
                    win?.webContents.send('editor:menu', 'about');
                  },
                },
                { type: 'separator' as const },
                { role: 'hide' as const },
                { role: 'quit' as const },
              ],
            },
          ]
        : []),
      {
        label: '파일',
        submenu: [
          {
            id: 'project-open',
            label: '프로젝트 열기…',
            accelerator: 'CmdOrCtrl+Shift+O',
            click: (_item, win) => {
              if (win instanceof BrowserWindow) win.webContents.send('editor:menu', 'project-open');
            },
          },
          {
            id: 'project-save',
            label: '프로젝트 저장…',
            accelerator: 'CmdOrCtrl+S',
            click: (_item, win) => {
              if (win instanceof BrowserWindow) win.webContents.send('editor:menu', 'project-save');
            },
          },
        ],
      },
      {
        label: '편집',
        submenu: [
          {
            id: 'photo-undo',
            label: '실행 취소',
            accelerator: 'CmdOrCtrl+Z',
            click: (_item, window) =>
              window instanceof BrowserWindow && window.webContents.send('editor:menu', 'undo'),
          },
          {
            id: 'photo-redo',
            label: '다시 실행',
            accelerator: 'CmdOrCtrl+Shift+Z',
            click: (_item, window) =>
              window instanceof BrowserWindow && window.webContents.send('editor:menu', 'redo'),
          },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' },
        ],
      },
      ...(process.platform !== 'darwin'
        ? [
            {
              label: '도움말',
              submenu: [
                {
                  id: 'app-about',
                  label: 'Hinana Studio Image 정보',
                  click: () =>
                    (
                      BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
                    )?.webContents.send('editor:menu', 'about'),
                },
              ],
            },
          ]
        : []),
      {
        label: '보기',
        submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { role: 'togglefullscreen' }],
      },
    ]),
  );
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
