import { _electron as electron } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import exifr from 'exifr';
import { inflateSync } from 'node:zlib';
const rawPath = process.argv[2];
if (!rawPath) throw new Error('Usage: node tests/raw-smoke.mjs /absolute/path/to/photo.NEF');
const original = await fs.readFile(rawPath);
const originalTags = await exifr.parse(original);
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'hinana-raw-ui-'));
const downloads = path.join(profile, 'downloads');
await fs.mkdir(downloads);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.env.HINANA_TEST_APP;
const app = await electron.launch({
  ...(executablePath ? { executablePath } : {}),
  args: [...(executablePath ? [] : ['.']), `--user-data-dir=${profile}`],
  env,
});
const page = await app.firstWindow();
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await app.evaluate(
  ({ session }, folder) =>
    session.defaultSession.on('will-download', (_e, item) =>
      item.setSavePath(folder + '/' + item.getFilename()),
    ),
  downloads,
);
async function completed(file) {
  for (let i = 0; i < 300; i++) {
    try {
      if ((await fs.stat(file)).size > 100) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('No download: ' + file);
}
try {
  await page.waitForSelector('.welcome');
  await page.locator('input[multiple]').setInputFiles(rawPath);
  await page.waitForSelector('canvas', { timeout: 120000 });
  await page.waitForFunction(() => document.querySelector('canvas').width > 1000);
  await page.getByRole('button', { name: '정보', exact: true }).click();
  await page.getByText('RAW · 전체 해상도 현상', { exact: true }).waitFor();
  if (originalTags?.Model) await page.getByText(new RegExp(originalTags.Model)).waitFor();
  await page.screenshot({ path: 'docs/raw-import.png' });
  await page.getByRole('button', { name: '편집', exact: true }).click();
  await page.getByRole('button', { name: '골든 아워 따뜻하게 머무는 빛' }).click();
  await page.waitForFunction(() =>
    document.querySelector('.save-status').textContent.includes('이 기기에 저장됨'),
  );
  await page.getByTitle('프로젝트 저장 (⌘/Ctrl S)').click();
  const projectFile = path.join(downloads, 'Hinana-Workspace.hinanaimage');
  await completed(projectFile);
  const project = JSON.parse(await fs.readFile(projectFile, 'utf8'));
  assert.equal(project.photos.length, 1);
  assert.equal(project.photos[0].adjustments.colorSpace, 'display-p3');
  const workingPNG = Buffer.from(project.photos[0].src.split(',')[1], 'base64');
  let icc;
  for (let at = 8; at < workingPNG.length;) {
    const size = workingPNG.readUInt32BE(at);
    if (workingPNG.toString('ascii', at + 4, at + 8) === 'iCCP') {
      const data = workingPNG.subarray(at + 8, at + 8 + size);
      icc = inflateSync(data.subarray(data.indexOf(0) + 2));
    }
    at += size + 12;
  }
  assert.ok(icc, 'RAW working PNG must carry ICC');
  let redX;
  for (let i = 0; i < icc.readUInt32BE(128); i++) {
    const at = 132 + i * 12;
    if (icc.toString('ascii', at, at + 4) === 'rXYZ')
      redX = icc.readInt32BE(icc.readUInt32BE(at + 4) + 8) / 65536;
  }
  assert.ok(
    redX > 0.5 && redX < 0.53,
    'RAW profile must have P3 D50-adapted red primary, not sRGB',
  );
  assert.ok(project.photos[0].width > 2000);
  assert.deepEqual(Buffer.from(project.photos[0].rawSource.split(',')[1], 'base64'), original);
  assert.equal(project.photos[0].adjustments.temperature, 24);
  console.log('PASS: full-resolution RAW import, EXIF, original RAW retained in project');
  await page.reload();
  await page.waitForSelector('canvas');
  assert.equal(await page.getByLabel('색온도', { exact: true }).inputValue(), '24');
  await page.getByRole('button', { name: '내보내기', exact: true }).click();
  await page.getByRole('button', { name: '이미지 저장', exact: true }).click();
  const exportedPath = path.join(
    downloads,
    path.basename(rawPath).replace(/\.[^.]+$/, '') + '-edited.jpg',
  );
  await completed(exportedPath);
  const result = await exifr.parse(await fs.readFile(exportedPath), { translateValues: false });
  assert.equal(result.Model, originalTags.Model);
  assert.equal(result.ISO, originalTags.ISO);
  assert.equal(result.ExifImageWidth, project.photos[0].width);
  assert.equal(result.Orientation, 1);
  assert.equal(result.ColorSpace, 65535);
  await page.getByRole('button', { name: '모든 보정 초기화' }).click();
  page.on('dialog', (d) => d.accept());
  await page.getByTestId('project-file-input').setInputFiles(projectFile);
  await page.waitForFunction(
    () => document.querySelector('input[aria-label="색온도"]').value === '24',
  );
  await page.getByRole('button', { name: '정보', exact: true }).click();
  await page.getByText('RAW · 전체 해상도 현상', { exact: true }).waitFor();
  console.log(
    'PASS: autosave restore, RAW project reopen, JPEG export with camera EXIF and dimensions',
  );
  await page.getByRole('button', { name: '편집', exact: true }).click();
  await page.getByLabel('작업 색공간', { exact: true }).selectOption('srgb');
  await page.getByRole('button', { name: 'RAW 원본에서 P3 다시 현상', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('select[aria-label="작업 색공간"]').value === 'display-p3',
    {},
    { timeout: 120000 },
  );
  assert.equal(await page.getByLabel('색온도', { exact: true }).inputValue(), '24');
  console.log(
    'PASS: RAW source PNG has P3 ICC; redevelop from project RAW restores P3 and retains edits',
  );
  const corrupt = path.join(downloads, 'corrupt.NEF');
  await fs.writeFile(corrupt, Buffer.from('not a RAW file'));
  await page.locator('input[multiple]').setInputFiles(corrupt);
  await page.waitForFunction(
    () => document.querySelector('.toast')?.textContent.includes('1개 실패'),
    {},
    { timeout: 120000 },
  );
  assert.equal(await page.locator('.film-frame').count(), 1);
  assert.deepEqual(errors, []);
  console.log('PASS: unsupported/corrupt RAW fails cleanly without losing existing work');
} finally {
  await app.close();
  await fs.rm(profile, { recursive: true, force: true });
}
