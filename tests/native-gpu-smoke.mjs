import { _electron as electron } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { encode, decode } from 'fast-png';

const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'hinana-gpu-smoke-'));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: path.resolve(
    process.env.HINANA_TEST_APP || 'release/win-unpacked/Hinana Studio Image.exe',
  ),
  args: [`--user-data-dir=${profile}`],
  env,
});
const page = await app.firstWindow();
page.setDefaultTimeout(30_000);
const errors = [],
  warnings = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'warning') warnings.push(m.text());
});
const canvas = () => page.getByLabel('보정 사진 미리보기');
async function backend(value) {
  await page.waitForFunction((value) => {
    const c = document.querySelector('.canvas-holder canvas');
    return c?.dataset.liquifyBackend === value && c.getAttribute('aria-busy') === 'false';
  }, value);
}
async function drag() {
  const r = await page.getByLabel('리퀴파이 브러시', { exact: true }).boundingBox();
  assert.ok(r);
  await page.mouse.move(r.x + r.width * 0.45, r.y + r.height * 0.5);
  await page.mouse.down();
  for (let i = 1; i <= 5; i++) {
    await page.mouse.move(r.x + r.width * (0.45 + i * 0.025), r.y + r.height * (0.5 + i * 0.008));
    await page.waitForTimeout(45);
  }
  await page.mouse.up();
}
async function exportPNG(format, depth) {
  await page.getByRole('button', { name: '내보내기', exact: true }).click();
  await page.getByLabel('파일 형식', { exact: true }).selectOption(format);
  const file = path.join(profile, `export-${format}.png`);
  await app.evaluate(({ session }, file) => {
    session.defaultSession.once('will-download', (_e, item) => item.setSavePath(file));
  }, file);
  await page.getByRole('button', { name: '이미지 저장', exact: true }).click();
  for (let i = 0; i < 150; i++) {
    try {
      const image = decode(await fs.readFile(file));
      assert.equal(image.width, 320);
      assert.equal(image.height, 240);
      assert.equal(image.depth, depth);
      return;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await page.waitForTimeout(100);
  }
  throw Error('Export timed out');
}
try {
  await page.waitForSelector('.welcome');
  const data = new Uint8Array(320 * 240 * 4);
  for (let y = 0; y < 240; y++)
    for (let x = 0; x < 320; x++)
      data.set([x % 256, y % 256, (x * 7 + y * 13) % 256, 255], (y * 320 + x) * 4);
  const fixture = path.join(profile, 'gpu-fixture.png');
  await fs.writeFile(fixture, encode({ width: 320, height: 240, channels: 4, depth: 8, data }));
  await page.locator('input[multiple]').setInputFiles(fixture);
  await page.waitForFunction(
    () => document.querySelector('.canvas-holder canvas')?.getAttribute('aria-busy') === 'false',
  );
  const original = await canvas().evaluate((c) => c.toDataURL());
  await page.getByRole('button', { name: '리퀴파이', exact: true }).click();
  await drag();
  await backend('direct3d11');
  const edited = await canvas().evaluate((c) => c.toDataURL());
  assert.notEqual(edited, original);
  await page.getByTitle('실행 취소 (⌘/Ctrl Z)').click();
  await backend('none');
  assert.equal(await canvas().evaluate((c) => c.toDataURL()), original);
  await page.getByTitle('다시 실행 (⌘/Ctrl Shift Z)').click();
  await backend('direct3d11');
  assert.equal(await canvas().evaluate((c) => c.toDataURL()), edited);
  await exportPNG('png16', 16);
  await page.getByRole('button', { name: '편집', exact: true }).click();
  await page.getByLabel('편집 정밀도', { exact: true }).selectOption('legacy');
  await backend('direct3d11');
  await page.getByRole('button', { name: '리퀴파이', exact: true }).click();
  await drag();
  await backend('direct3d11');
  await exportPNG('png', 8);
  assert.deepEqual(errors, []);
  assert.ok(!warnings.some((w) => w.includes('Direct3D 11 unavailable')), warnings.join('\n'));
  // Simulate a missing/lost GPU in this isolated app process only.
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('gpu:geometry');
    ipcMain.handle('gpu:geometry', () => {
      throw Error('Simulated GPU failure');
    });
  });
  await drag();
  await backend('webgl2');
  await page.getByRole('button', { name: '편집', exact: true }).click();
  await page.getByLabel('편집 정밀도', { exact: true }).selectOption('float');
  await backend('cpu');
  assert.deepEqual(errors, []);
  console.log(
    'PASS: packaged Direct3D 11 float/legacy liquify, real brush edits, undo/redo, 16/8-bit exports, CPU/WebGL fallback; no renderer errors.',
  );
} finally {
  await app.close();
  await fs.rm(profile, { recursive: true, force: true });
}
