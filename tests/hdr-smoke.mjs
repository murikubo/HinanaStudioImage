import { _electron as electron } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { encode, decode } from 'fast-png';
import { decodePrecisionPNG, pngChunks } from '../src/precision-codec.ts';
import { injectExif, extractExif } from '../src/exif-export.ts';
import piexif from 'piexifjs';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hinana-hdr-'));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.env.HINANA_TEST_APP;
const app = await electron.launch({
  ...(executablePath ? { executablePath } : {}),
  args: [...(executablePath ? [] : ['.']), `--user-data-dir=${root}`],
  env,
});
const page = await app.firstWindow();
page.setDefaultTimeout(20000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await app.evaluate(
  ({ session }, root) =>
    session.defaultSession.on('will-download', (_e, item) =>
      item.setSavePath(root + '/' + item.getFilename()),
    ),
  root,
);
async function file(name) {
  for (let i = 0; i < 300; i++) {
    try {
      const b = await fs.readFile(path.join(root, name));
      if (b.length > 100) return b;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error('Missing ' + name);
}
async function exportFile(format) {
  await page.getByRole('button', { name: '내보내기', exact: true }).click();
  await page.getByLabel('파일 형식', { exact: true }).selectOption(format);
  await page.getByRole('button', { name: '이미지 저장', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  const bytes = await file('gradient-edited.png');
  await fs.unlink(path.join(root, 'gradient-edited.png'));
  return bytes;
}
try {
  await page.waitForSelector('.welcome');
  const capability = await page.evaluate(async () => {
    const adapter = await navigator.gpu.requestAdapter();
    const device = await adapter.requestDevice();
    const c = document.createElement('canvas');
    const x = c.getContext('webgpu');
    x.configure({ device, format: 'rgba16float', toneMapping: { mode: 'extended' } });
    const configuration = x.getConfiguration();
    x.unconfigure();
    device.destroy();
    return { format: configuration.format, mode: configuration.toneMapping.mode };
  });
  assert.deepEqual(capability, { format: 'rgba16float', mode: 'extended' });
  console.log('HDR WebGPU capability:', capability);
  const data = new Uint16Array(1024 * 128 * 4);
  for (let i = 0; i < 1024 * 128; i++) {
    const n = (i % 1024) * 64;
    data.set([n, n, n, 65535], i * 4);
  }
  const png = encode({ width: 1024, height: 128, channels: 4, depth: 16, data });
  const tiff = Buffer.from(
    piexif.dump({ '0th': { 272: 'HDR Test Camera' }, Exif: { 34855: 100 } }).slice(6),
    'binary',
  );
  const fixture = path.join(root, 'gradient.png');
  await fs.writeFile(fixture, injectExif(png, tiff, 'image/png', 1024, 128));
  await page.locator('input[multiple]').setInputFiles(fixture);
  await page.waitForFunction(() => document.querySelector('.canvas-holder canvas')?.width === 1024);
  assert.equal(await page.getByLabel('편집 정밀도', { exact: true }).inputValue(), 'float');
  const sdr = await exportFile('png16');
  assert.equal(decode(sdr).depth, 16);
  assert.ok(pngChunks(sdr).has('iCCP'));
  assert.ok(extractExif(sdr));
  assert.ok(new Set(Array.from(decode(sdr).data).filter((_, i) => i % 4 === 0)).size > 1000);
  await page.getByLabel('밝기 범위', { exact: true }).selectOption('hdr');
  await page.getByLabel('노출', { exact: true }).fill('2');
  await page.getByLabel('노출', { exact: true }).press('ArrowRight');
  const hdr = await exportFile('hdr-png');
  assert.deepEqual([...pngChunks(hdr).get('cICP')], [9, 16, 0, 1]);
  assert.ok(!pngChunks(hdr).has('iCCP'));
  assert.ok(extractExif(hdr));
  const reopened = decodePrecisionPNG(hdr);
  assert.ok(reopened.data.at(-4) > 3.9);
  await page.getByTitle('프로젝트 저장 (⌘/Ctrl S)').click();
  const project = JSON.parse(await file('Hinana-Workspace.hinanaimage'));
  assert.equal(project.version, 5);
  assert.equal(project.photos[0].adjustments.dynamicRange, 'hdr');
  assert.equal(project.photos[0].adjustments.precision, 'float');
  await page.waitForFunction(() =>
    document.querySelector('.save-status')?.textContent.includes('이 기기에 저장됨'),
  );
  await page.reload();
  await page.waitForFunction(
    () => document.querySelector('[aria-label="밝기 범위"]')?.value === 'hdr',
  );
  assert.equal(await page.getByLabel('밝기 범위', { exact: true }).inputValue(), 'hdr');
  // Force only the display capability signal to exercise our HDR canvas path.
  // This verifies pixel transport, not the physical panel's luminance.
  await page.addInitScript(() => {
    // Read the rendered swapchain before presentation; physical luminance is not mocked.
    new MutationObserver(() => {
      const canvas = document.querySelector('.canvas-holder canvas');
      if (
        !canvas ||
        canvas.dataset.hdrBackend !== 'webgpu' ||
        canvas.getAttribute('aria-busy') !== 'false' ||
        window.__hdrReading
      )
        return;
      window.__hdrReading = true;
      const context = canvas.getContext('webgpu');
      const { device, format, toneMapping } = context.getConfiguration();
      window.__hdrConfiguration = { format, mode: toneMapping.mode };
      const buffer = device.createBuffer({
        size: 256,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      const commands = device.createCommandEncoder();
      commands.copyTextureToBuffer(
        { texture: context.getCurrentTexture(), origin: [1023, 0] },
        { buffer, bytesPerRow: 256 },
        [1, 1],
      );
      device.queue.submit([commands.finish()]);
      void buffer.mapAsync(GPUMapMode.READ).then(() => {
        window.__hdrPixel = new Float16Array(buffer.getMappedRange())[0];
        buffer.unmap();
        buffer.destroy();
      });
    }).observe(document, { subtree: true, attributes: true });
    const original = window.matchMedia.bind(window);
    window.matchMedia = (query) => {
      const result = original(query);
      if (query === '(dynamic-range: high)')
        Object.defineProperty(result, 'matches', { get: () => true });
      return result;
    };
  });
  await page.reload();
  await page.waitForFunction(() => typeof window.__hdrPixel === 'number');
  const hdrPixel = await page.evaluate(() => window.__hdrPixel);
  assert.deepEqual(await page.evaluate(() => window.__hdrConfiguration), {
    format: 'rgba16float',
    mode: 'extended',
  });
  assert.ok(hdrPixel > 1.5, `HDR rendered pixel: ${hdrPixel}`);
  // A lost GPU device must recreate the canvas and keep the edited photo visible in SDR.
  await page
    .locator('.canvas-holder canvas')
    .evaluate((c) => c.getContext('webgpu').getConfiguration().device.destroy());
  await page.waitForFunction(
    () => document.querySelector('.canvas-holder canvas')?.dataset.hdrBackend === 'sdr',
  );
  await page
    .getByText('이 앱 실행 환경은 HDR 화면 표시를 지원하지 않습니다.', { exact: false })
    .waitFor();
  await page.getByLabel('SDR 밝기 변환 미리보기', { exact: true }).check();
  await page.waitForFunction(
    () => document.querySelector('.canvas-holder canvas')?.dataset.hdrBackend === 'sdr',
  );
  const hdrPath = path.join(root, 'reopened.png');
  await fs.writeFile(hdrPath, hdr);
  await page.locator('input[multiple]').setInputFiles(hdrPath);
  await page.waitForTimeout(600);
  assert.equal(await page.getByLabel('밝기 범위', { exact: true }).inputValue(), 'hdr');
  await page.screenshot({ path: path.join(root, 'hdr-editing.png') });
  assert.deepEqual(errors, []);
  console.log(
    'PASS: WebGPU rgba16float extended presentation and rendered HDR pixel, 16-bit input/output levels, ICC/EXIF, HDR PQ export/reimport and project persistence',
  );
} finally {
  await app.close();
}
