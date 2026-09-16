import { _electron as electron } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import exifr from 'exifr';
import piexif from 'piexifjs';
import { injectExif, extractExif } from '../src/exif-export.ts';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hinana-p3-'));
const downloads = path.join(root, 'downloads');
await fs.mkdir(downloads);
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
  downloads,
);
const pixel = () =>
  page
    .locator('.canvas-holder canvas')
    .evaluate((c) => [
      ...c.getContext('2d').getImageData(30, 30, 1, 1, { colorSpace: 'display-p3' }).data,
    ]);
async function waitFile(name) {
  const f = path.join(downloads, name);
  for (let i = 0; i < 200; i++) {
    try {
      const b = await fs.readFile(f);
      if (b.length > 100) return b;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error('Missing download ' + name);
}
function profile(bytes, mime) {
  if (mime === 'png') {
    for (let at = 8; at < bytes.length;) {
      const n = bytes.readUInt32BE(at);
      if (bytes.toString('ascii', at + 4, at + 8) === 'iCCP') {
        const data = bytes.subarray(at + 8, at + 8 + n);
        return inflateSync(data.subarray(data.indexOf(0) + 2));
      }
      at += n + 12;
    }
  }
  if (mime === 'jpeg') {
    for (let at = 2; at < bytes.length;) {
      if (bytes[at + 1] === 0xda) break;
      const n = bytes.readUInt16BE(at + 2);
      if (bytes[at + 1] === 0xe2 && bytes.toString('ascii', at + 4, at + 16) === 'ICC_PROFILE\0')
        return bytes.subarray(at + 18, at + n + 2);
      at += n + 2;
    }
  }
  if (mime === 'webp') {
    for (let at = 12; at < bytes.length;) {
      const n = bytes.readUInt32LE(at + 4);
      if (bytes.toString('ascii', at, at + 4) === 'ICCP') return bytes.subarray(at + 8, at + 8 + n);
      at += 8 + n + (n % 2);
    }
  }
  throw Error('No ICC profile in ' + mime);
}
async function decodePixel(bytes, mime) {
  return page.evaluate(
    async ({ src }) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d', { colorSpace: 'display-p3' });
      ctx.drawImage(img, 0, 0);
      return [...ctx.getImageData(30, 30, 1, 1, { colorSpace: 'display-p3' }).data];
    },
    { src: `data:image/${mime};base64,${bytes.toString('base64')}` },
  );
}
try {
  await page.waitForSelector('.welcome');
  const fixture = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 320;
    c.height = 160;
    const x = c.getContext('2d', { colorSpace: 'display-p3' });
    x.fillStyle = 'color(display-p3 1 .3 0)';
    x.fillRect(0, 0, 160, 160);
    x.fillStyle = 'color(display-p3 0 1 .2)';
    x.fillRect(160, 0, 160, 160);
    return c.toDataURL();
  });
  const tiff = Buffer.from(
    piexif
      .dump({ '0th': { 272: 'Wide Gamut Camera' }, Exif: { 40961: 65535, 34855: 200 } })
      .slice(6),
    'binary',
  );
  const file = path.join(root, 'wide.png');
  await fs.writeFile(
    file,
    injectExif(Buffer.from(fixture.split(',')[1], 'base64'), tiff, 'image/png', 320, 160),
  );
  await page.locator('input[multiple]').setInputFiles(file);
  await page.waitForFunction(() => document.querySelector('.canvas-holder canvas')?.width === 320);
  assert.equal(await page.getByLabel('작업 색공간', { exact: true }).inputValue(), 'display-p3');
  assert.deepEqual(await pixel(), [255, 77, 0, 255]);
  await page.getByLabel('sRGB 변환 미리보기', { exact: true }).check();
  await page.waitForTimeout(150);
  assert.notDeepEqual(await pixel(), [255, 77, 0, 255]);
  await page.getByLabel('sRGB 변환 미리보기', { exact: true }).uncheck();
  await page.waitForTimeout(150);
  assert.deepEqual(await pixel(), [255, 77, 0, 255]);
  await page.getByLabel('작업 색공간', { exact: true }).selectOption('srgb');
  await page.waitForTimeout(150);
  assert.notDeepEqual(await pixel(), [255, 77, 0, 255]);
  await page.getByTitle('실행 취소 (⌘/Ctrl Z)').click();
  await page.waitForTimeout(150);
  assert.equal(await page.getByLabel('작업 색공간', { exact: true }).inputValue(), 'display-p3');
  assert.deepEqual(await pixel(), [255, 77, 0, 255]);
  await page.getByRole('button', { name: '색상·톤', exact: true }).click();
  await page.getByLabel('빨강 채도', { exact: true }).fill('-25');
  await page.getByLabel('빨강 채도', { exact: true }).press('ArrowRight');
  await page.waitForTimeout(150);
  const edited = await pixel();
  assert.notDeepEqual(edited, [255, 77, 0, 255]);
  await page.getByTitle('실행 취소 (⌘/Ctrl Z)').click();
  await page.waitForTimeout(150);
  assert.deepEqual(await pixel(), [255, 77, 0, 255]);
  await page.screenshot({ path: 'docs/display-p3.png' });
  const p3ICC = await fs.readFile('public/profiles/display-p3.icc');
  for (const mime of ['png', 'jpeg', 'webp']) {
    await page.getByRole('button', { name: '내보내기', exact: true }).click();
    await page.getByLabel('파일 형식', { exact: true }).selectOption(mime);
    await page.getByLabel('출력 색공간', { exact: true }).selectOption('display-p3');
    if (mime !== 'png') await page.getByRole('dialog').locator('input[type=range]').fill('100');
    await page.getByRole('button', { name: '이미지 저장', exact: true }).click();
    const bytes = await waitFile('wide-edited.' + (mime === 'jpeg' ? 'jpg' : mime));
    assert.deepEqual(profile(bytes, mime), p3ICC);
    const decoded = await decodePixel(bytes, mime);
    decoded.forEach((v, i) =>
      assert.ok(
        Math.abs(v - [255, 77, 0, 255][i]) <= (mime === 'png' ? 0 : 5),
        `${mime}: ${decoded}`,
      ),
    );
    const tags = await exifr.parse(extractExif(bytes), { translateValues: false });
    assert.equal(tags.Model, 'Wide Gamut Camera');
    assert.equal(tags.ColorSpace, 65535);
  }
  await fs.rm(path.join(downloads, 'wide-edited.png'));
  await page.getByRole('button', { name: '내보내기', exact: true }).click();
  await page.getByLabel('파일 형식', { exact: true }).selectOption('png');
  await page.getByLabel('출력 색공간', { exact: true }).selectOption('srgb');
  await page.getByLabel('EXIF 메타데이터 보존').uncheck();
  await page.getByRole('button', { name: '이미지 저장', exact: true }).click();
  const srgb = await waitFile('wide-edited.png');
  assert.deepEqual(profile(srgb, 'png'), await fs.readFile('public/profiles/srgb.icc'));
  assert.notDeepEqual(await decodePixel(srgb, 'png'), [255, 77, 0, 255]);
  assert.equal(extractExif(srgb), undefined);
  await page.getByTitle('프로젝트 저장 (⌘/Ctrl S)').click();
  const project = JSON.parse((await waitFile('Hinana-Workspace.hinanaimage')).toString());
  assert.equal(project.photos[0].adjustments.colorSpace, 'display-p3');
  await page.reload();
  await page.waitForFunction(() => document.querySelector('.canvas-holder canvas')?.width === 320);
  assert.deepEqual(await pixel(), [255, 77, 0, 255]);
  page.on('dialog', (d) => d.accept());
  await page
    .getByTestId('project-file-input')
    .setInputFiles(path.join(downloads, 'Hinana-Workspace.hinanaimage'));
  await page.waitForTimeout(300);
  assert.equal(await page.getByLabel('작업 색공간', { exact: true }).inputValue(), 'display-p3');
  delete project.photos[0].adjustments.colorSpace;
  for (const a of project.photos[0].history) delete a.colorSpace;
  const legacy = path.join(root, 'legacy.hinanaimage');
  await fs.writeFile(legacy, JSON.stringify(project));
  await page.getByTestId('project-file-input').setInputFiles(legacy);
  await page.waitForTimeout(300);
  assert.equal(await page.getByLabel('작업 색공간', { exact: true }).inputValue(), 'srgb');
  assert.deepEqual(errors, []);
  console.log(
    'PASS: wide-gamut import/edit/undo, sRGB proof and conversion, P3 JPEG/PNG/WebP ICC + EXIF, EXIF opt-out keeps ICC, project save/reopen/autosave and legacy sRGB',
  );
} finally {
  await app.close();
  await fs.rm(root, { recursive: true, force: true });
}
