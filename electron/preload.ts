import { contextBridge, ipcRenderer, webUtils } from 'electron';
contextBridge.exposeInMainWorld('hinana', {
  platform: process.platform,
  redevelopRaw(source: string, name: string) {
    return ipcRenderer.invoke('raw:redevelop', source, name);
  },
  decodeRaw(file: File) {
    const path = webUtils.getPathForFile(file);
    if (!path) return Promise.reject(new Error('디스크에서 RAW 파일을 직접 선택해 주세요.'));
    return ipcRenderer.invoke('raw:decode', path);
  },
  onMenuAction(
    callback: (action: 'undo' | 'redo' | 'about' | 'project-open' | 'project-save') => void,
  ) {
    const listener = (_event: Electron.IpcRendererEvent, action: string) => {
      if (
        action === 'undo' ||
        action === 'redo' ||
        action === 'about' ||
        action === 'project-open' ||
        action === 'project-save'
      )
        callback(action);
    };
    ipcRenderer.on('editor:menu', listener);
    return () => ipcRenderer.removeListener('editor:menu', listener);
  },
});
