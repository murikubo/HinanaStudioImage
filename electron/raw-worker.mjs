// Dedicated worker: decoding never blocks Electron's main process.
import { parentPort, workerData } from 'node:worker_threads';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { LibRaw } from '@colorhythm/libraw-wasm';
import { PNG } from 'pngjs';
import { rawExif, attachPngExif, attachPngICC } from './raw-exif.mjs';
const require = createRequire(import.meta.url);
let decoder;
try {
  const wasm = await fs.readFile(require.resolve('@colorhythm/libraw-wasm/libraw.wasm'));
  await LibRaw.initialize(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength));
  decoder = new LibRaw();
  await decoder.waitUntilReady();
  const input = await fs.readFile(workerData.input);
  decoder.open(input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength));
  if (decoder.getRawWidth() * decoder.getRawHeight() > 65_000_000)
    throw new Error('RAW 센서 크기가 지원 한도를 초과합니다.');
  if (decoder.getActiveWidth() * decoder.getActiveHeight() > 60_000_000)
    throw new Error('RAW 사진은 60MP 이하만 지원합니다.');
  decoder.setHalfSize(0);
  decoder.setUseCameraWb(1);
  decoder.setOutputColor(7); // LibRaw P3-D65 primaries; gamma below is Display P3, not cinema DCI-P3.
  decoder.setOutputBps(8);
  decoder.setGamma(0, 1 / 2.4);
  decoder.setGamma(1, 12.92);
  decoder.unpack();
  decoder.dcrawProcess();
  const image = decoder.dcrawMakeMemImage();
  if (
    image.bits !== 8 ||
    image.colors !== 3 ||
    image.type_ !== 'LIBRAW_IMAGE_BITMAP' ||
    image.width * image.height > 60_000_000
  )
    throw new Error('지원하지 않는 RAW 현상 결과입니다.');
  const png = new PNG({ width: image.width, height: image.height });
  const pixels = image.data;
  for (let p = 0, s = 0; p < png.data.length; p += 4, s += 3) {
    png.data[p] = pixels[s];
    png.data[p + 1] = pixels[s + 1];
    png.data[p + 2] = pixels[s + 2];
    png.data[p + 3] = 255;
  }
  const exif = await rawExif(input, decoder, image.width, image.height, 'display-p3');
  const profile = await fs.readFile(new URL('../dist/profiles/display-p3.icc', import.meta.url));
  await fs.writeFile(
    workerData.output,
    attachPngICC(attachPngExif(PNG.sync.write(png), exif), profile),
  );
  parentPort.postMessage({ ok: true });
} catch (error) {
  parentPort.postMessage({ error: `RAW 현상 실패: ${error.message}` });
} finally {
  decoder?.dispose();
}
