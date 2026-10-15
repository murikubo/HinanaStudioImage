import { _electron as electron } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { encode } from 'fast-png';

const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'hinana-presets-'));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.env.HINANA_TEST_APP;
const app = await electron.launch({
  ...(executablePath ? { executablePath } : {}),
  args: [...(executablePath ? [] : ['.']), `--user-data-dir=${profile}`],
  env,
});
const page = await app.firstWindow();
page.setDefaultTimeout(20000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const library = page.getByRole('region', { name: '사용자 프리셋 보관함' });
const photoInput = page.locator('input[multiple][accept^="image/"]');
const canvas = page.getByLabel('보정 사진 미리보기');
async function settled() {
  await page.waitForFunction(
    () => document.querySelector('.canvas-holder canvas')?.getAttribute('aria-busy') === 'false',
  );
}
async function manage() {
  await library.locator('.preset-manage').evaluate((d) => {
    d.open = true;
  });
}
async function waitValue(label, value) {
  await page.waitForFunction(
    ({ label, value }) => document.querySelector(`input[aria-label="${label}"]`)?.value === value,
    { label, value },
  );
  await settled();
}
async function download(button, filename) {
  const file = path.join(profile, filename);
  await app.evaluate(
    ({ session }, file) =>
      session.defaultSession.once('will-download', (_e, item) => item.setSavePath(file)),
    file,
  );
  await button.click();
  for (let i = 0; i < 150; i++) {
    try {
      const text = await fs.readFile(file, 'utf8');
      if (text.length > 10) return text;
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    await page.waitForTimeout(100);
  }
  throw Error('Download timed out');
}
try {
  await page.waitForSelector('.welcome');
  const data = new Uint8Array(160 * 120 * 4);
  for (let y = 0; y < 120; y++)
    for (let x = 0; x < 160; x++) {
      const n = (x * 13 + y * 7) % 17;
      data.set(
        x < 100 ? [200 + n, 150 + n, 125 + n, 255] : [20 + n, 50 + n, 180 + n, 255],
        (y * 160 + x) * 4,
      );
    }
  const fixture = path.join(profile, 'portrait.png');
  await fs.writeFile(fixture, encode({ width: 160, height: 120, channels: 4, depth: 8, data }));
  await photoInput.setInputFiles(fixture);
  await settled();
  const original = await canvas.evaluate((c) => c.toDataURL());
  await library.getByRole('button', { name: /^내추럴 인물/ }).click();
  await waitValue('피부 부드럽게', '22');
  await waitValue('피부 톤 균일화', '20');
  const portrait = await canvas.evaluate((c) => c.toDataURL());
  assert.notEqual(portrait, original);
  await page.getByTitle('실행 취소 (⌘/Ctrl Z)').click();
  await waitValue('피부 부드럽게', '0');
  assert.equal(await canvas.evaluate((c) => c.toDataURL()), original);
  await page.getByTitle('다시 실행 (⌘/Ctrl Shift Z)').click();
  await waitValue('피부 부드럽게', '22');
  await manage();
  await library.getByLabel('프리셋 이름', { exact: true }).fill('나의 인물');
  await library.getByLabel('저장할 보정', { exact: true }).selectOption('combined');
  await library
    .getByRole('button', { name: '현재 보정을 새 프리셋으로 저장', exact: true })
    .click();
  await library.getByRole('button', { name: /^나의 인물/ }).waitFor();
  const saved = JSON.parse(
    await download(
      library.getByRole('button', { name: '선택 프리셋 파일 내보내기', exact: true }),
      'portrait.hinanapreset',
    ),
  );
  assert.equal(saved.format, 'hinana-preset');
  assert.equal(saved.preset.values.skinSmooth, 22);
  assert.ok(!('rotation' in saved.preset.values));
  await page.waitForFunction(() =>
    document.querySelector('.save-status')?.textContent.includes('이 기기에 저장됨'),
  );
  await page.reload();
  await settled();
  await library.getByRole('button', { name: /^나의 인물/ }).waitFor();
  await manage();
  await library.getByRole('button', { name: /^나의 인물/ }).click();
  await library.getByLabel('프리셋 이름', { exact: true }).fill('인물 재사용');
  await library.getByRole('button', { name: '이름 변경', exact: true }).click();
  await library.getByRole('button', { name: /^인물 재사용/ }).waitFor();
  await page.getByRole('button', { name: '모든 보정 초기화', exact: true }).click();
  await waitValue('피부 부드럽게', '0');
  await photoInput.setInputFiles(fixture);
  await waitValue('피부 부드럽게', '0');
  await library.getByRole('button', { name: /^인물 재사용/ }).click();
  await waitValue('피부 부드럽게', '22');
  await library
    .getByRole('button', { name: '현재 인물 + 색감 보정을 다른 사진에 동기화', exact: true })
    .click();
  await page.getByTitle('이전 사진', { exact: true }).click();
  await waitValue('피부 부드럽게', '22');
  await page.getByTitle('실행 취소 (⌘/Ctrl Z)').click();
  await waitValue('피부 부드럽게', '0');
  // XMP name/namespace parsing, warnings, application and export.
  const xmp = path.join(profile, 'color.xmp');
  await fs.writeFile(
    xmp,
    `<x:xmpmeta xmlns:x="adobe:ns:meta/" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:RDF><rdf:Description xmlns:c="http://ns.adobe.com/camera-raw-settings/1.0/" c:Exposure2012="0.5" c:Contrast2012="17" c:CameraProfile="Custom"><c:Name><rdf:Alt><rdf:li xml:lang="x-default">공통 색감</rdf:li></rdf:Alt></c:Name></rdf:Description></rdf:RDF></x:xmpmeta>`,
  );
  await library.getByLabel('프리셋 파일', { exact: true }).setInputFiles(xmp);
  await library.getByRole('button', { name: /^공통 색감/ }).waitFor();
  assert.match(await library.locator('.preset-notice').textContent(), /CameraProfile/);
  await library.getByRole('button', { name: /^공통 색감/ }).click();
  await waitValue('노출', '0.5');
  await waitValue('대비', '17');
  const exportedXmp = await download(
    library.getByRole('button', { name: '색감 XMP로 내보내기', exact: true }),
    'color-export.xmp',
  );
  assert.match(exportedXmp, /crs:Exposure2012="0.5"/);
  assert.ok(!exportedXmp.includes('skinSmooth'));
  const cube = path.join(profile, 'invert.cube');
  const rows = [];
  for (let b = 0; b < 2; b++)
    for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) rows.push(`${1 - r} ${1 - g} ${1 - b}`);
  await fs.writeFile(cube, `TITLE "반전 LUT"\nLUT_3D_SIZE 2\n${rows.join('\n')}`);
  const beforeLut = await canvas.evaluate((c) => c.toDataURL());
  await library.getByLabel('프리셋 파일', { exact: true }).setInputFiles(cube);
  await library.getByRole('button', { name: /^반전 LUT/ }).click();
  await settled();
  await page.waitForFunction(
    (before) => document.querySelector('.canvas-holder canvas').toDataURL() !== before,
    beforeLut,
  );
  await page.getByTitle('실행 취소 (⌘/Ctrl Z)').click();
  await settled();
  assert.equal(await canvas.evaluate((c) => c.toDataURL()), beforeLut);
  await page.getByTitle('다시 실행 (⌘/Ctrl Shift Z)').click();
  await settled();
  const lutFile = JSON.parse(
    await download(
      library.getByRole('button', { name: '선택 프리셋 파일 내보내기', exact: true }),
      'lut.hinanapreset',
    ),
  );
  assert.equal(lutFile.preset.values.colorLut.size, 2);
  const lutExportPath = path.join(profile, 'lut.hinanapreset');
  await library.getByLabel('프리셋 파일', { exact: true }).setInputFiles(lutExportPath);
  await page.waitForFunction(
    () => document.querySelectorAll('.user-preset-list button').length === 7,
  );
  const bad = path.join(profile, 'bad.xmp');
  await fs.writeFile(bad, '<!DOCTYPE foo><foo/>');
  await library.getByLabel('프리셋 파일', { exact: true }).setInputFiles(bad);
  await page.waitForFunction(() =>
    document.querySelector('.preset-feedback')?.textContent.includes('가져오기 실패'),
  );
  assert.equal(await library.locator('.user-preset-list button').count(), 7);
  await page.waitForFunction(() =>
    document.querySelector('.save-status')?.textContent.includes('이 기기에 저장됨'),
  );
  const project = JSON.parse(
    await download(page.getByTitle('프로젝트 저장 (⌘/Ctrl S)'), 'project.hinanaimage'),
  );
  assert.equal(project.version, 8);
  assert.equal(project.photos[0].adjustments.colorLut.size, 2);
  await page.reload();
  await settled();
  await manage();
  assert.equal(await library.locator('.user-preset-list button').count(), 7);
  await library.locator('.preset-manage summary').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'release/preset-library.png' });
  assert.deepEqual(errors, []);
  console.log(
    'PASS: portrait edits, undo/redo, saved preset reload/rename/reuse, scoped sync, XMP parsing/apply/export, CUBE apply/undo/export/import, invalid file rejection, LUT project v8 and persistence.',
  );
} catch (error) {
  console.error('Renderer errors:', errors);
  console.error('UI:', (await page.locator('body').innerText()).slice(-1800));
  await page.screenshot({ path: 'release/presets-failure.png' });
  throw error;
} finally {
  await app.close();
  await fs.rm(profile, { recursive: true, force: true });
}
