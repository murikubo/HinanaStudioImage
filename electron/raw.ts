import { app, ipcMain } from 'electron';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import { Worker } from 'node:worker_threads';
import path from 'node:path';
const execute = promisify(execFile);
const rawPattern = /\.(dng|cr2|cr3|nef|nrw|arw|srf|sr2|raf|orf|rw2|pef|rwl|3fr|fff|iiq|srw|raw)$/i;
let decoding = false;
export function registerRawDecoder() {
  ipcMain.handle('raw:decode', async (_event, filePath: unknown) => {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || !rawPattern.test(filePath))
      throw new Error('올바른 RAW 파일을 선택해 주세요.');
    if (decoding) throw new Error('다른 RAW 사진을 현상 중입니다. 잠시 후 다시 시도해 주세요.');
    decoding = true;
    let temporary: string | undefined;
    try {
      const stat = await fs.stat(filePath);
      if (!stat.isFile() || stat.size <= 0 || stat.size > 120 * 1024 * 1024)
        throw new Error('RAW 파일은 120MB 이하여야 합니다.');
      const decoder = app.isPackaged
        ? path.join(process.resourcesPath, 'raw/hinana-raw')
        : path.join(app.getAppPath(), 'native/bin/hinana-raw');
      const useNative = process.platform === 'darwin' && process.env.HINANA_RAW_ENGINE !== 'wasm';
      if (useNative)
        await fs.access(decoder).catch(() => {
          throw new Error('RAW 디코더를 찾을 수 없습니다. 앱을 다시 빌드해 주세요.');
        });
      temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'hinana-raw-'));
      const output = path.join(temporary, 'decoded.png');
      try {
        if (useNative)
          await execute(decoder, [filePath, output], { timeout: 120_000, maxBuffer: 1024 * 1024 });
        else await decodePortable(filePath, output);
      } catch (error) {
        const e = error as { stderr?: string; killed?: boolean; message?: string };
        throw new Error(
          e.killed
            ? 'RAW 현상 시간이 초과되었습니다.'
            : e.stderr?.trim().slice(-500) ||
                e.message ||
                'RAW 디코딩에 실패했습니다. 카메라 지원 여부를 확인해 주세요.',
        );
      }
      const outputStat = await fs.stat(output);
      if (outputStat.size > 260 * 1024 * 1024) throw new Error('RAW 작업 이미지가 너무 큽니다.');
      const [png, original] = await Promise.all([fs.readFile(output), fs.readFile(filePath)]);
      return {
        src: `data:image/png;base64,${png.toString('base64')}`,
        original: `data:application/octet-stream;base64,${original.toString('base64')}`,
      };
    } finally {
      if (temporary) await fs.rm(temporary, { recursive: true, force: true });
      decoding = false;
    }
  });
}

function decodePortable(input: string, output: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'raw-worker.mjs'), {
      workerData: { input, output },
    });
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate().then(() => (error ? reject(error) : resolve()), reject);
    };
    const timer = setTimeout(() => finish(new Error('RAW 현상 시간이 초과되었습니다.')), 120_000);
    worker.on('message', (result) =>
      finish(result.ok ? undefined : new Error(result.error || 'RAW 현상 실패')),
    );
    worker.on('error', finish);
    worker.on('exit', (code) => {
      if (!settled) finish(new Error(`RAW 디코더가 종료되었습니다 (${code}).`));
    });
  });
}
