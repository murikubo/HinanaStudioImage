import { Capacitor } from '@capacitor/core';
import { download } from './engine.ts';

export const nativeMobile = Capacitor.isNativePlatform();

// Exports are handed to the OS share sheet, where the user chooses Files, Photos or another app.
// Keep the cache file until the OS recipient has finished reading it.
export async function saveFile(blob: Blob, name: string) {
  if (!nativeMobile) {
    download(blob, name);
    return;
  }
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([
    import('@capacitor/filesystem'),
    import('@capacitor/share'),
  ]);
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(Error('내보낼 파일을 읽지 못했습니다.'));
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.readAsDataURL(blob);
  });
  const safeName = name.replace(/[\\/\u0000-\u001f]/g, '_');
  // Each export has its own folder so repeated names cannot overwrite a share in progress.
  const path = `exports/${crypto.randomUUID()}/${safeName}`;
  await Filesystem.writeFile({ directory: Directory.Cache, path, data, recursive: true });
  const { uri } = await Filesystem.getUri({ directory: Directory.Cache, path });
  await Share.share({ title: name, files: [uri], dialogTitle: '저장 또는 공유' });
}
