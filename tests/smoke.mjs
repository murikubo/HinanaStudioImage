import exifr from 'exifr';
import { withExif } from './exif-fixture.mjs';
import { _electron as electron } from '@playwright/test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'hinana-smoke-'));
const downloadRoot = path.join(profile, 'downloads');
await fs.mkdir(downloadRoot);
const executablePath = process.env.HINANA_TEST_APP;
const app = await electron.launch({
  ...(executablePath ? { executablePath } : {}),
  args: [...(executablePath ? [] : ['.']), `--user-data-dir=${profile}`],
  env,
});
await app.evaluate(
  ({ session }, downloadRoot) =>
    session.defaultSession.on('will-download', (_event, item) =>
      item.setSavePath(downloadRoot + '/' + item.getFilename()),
    ),
  downloadRoot,
);
const page = await app.firstWindow();
page.setDefaultTimeout(15000);
const errors = [];
const awaitFile = async (file) => {
  for (let i = 0; i < 150; i++) {
    try {
      const stat = await fs.stat(file);
      if (stat.size > 100) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('File download timed out: ' + file);
};
page.on('pageerror', (e) => errors.push(e.message));
try {
  await page.waitForSelector('.welcome');
  assert.ok(
    await page
      .locator('.header-app-icon')
      .evaluate((img) => img.complete && img.naturalWidth > 1000),
  );
  assert.equal(
    await page.locator('.desktop-darwin').count(),
    process.platform === 'darwin' ? 1 : 0,
  );
  await page.getByRole('button', { name: '프로그램 정보', exact: true }).click();
  await page.getByRole('dialog').getByText('비나래', { exact: true }).waitFor();
  await page.getByRole('dialog').getByText('Ver. 0.11.1', { exact: true }).waitFor();
  assert.ok(
    await page.locator('.about-icon').evaluate((img) => img.complete && img.naturalWidth > 1000),
  );
  await page.screenshot({ path: 'docs/about.png' });
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog').count(), 0);
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('app-about').click());
  await page.getByRole('dialog').getByText('비나래', { exact: true }).waitFor();
  await page.getByRole('button', { name: '프로그램 정보 닫기', exact: true }).click();
  await page.screenshot({ path: 'docs/welcome.png' });
  await page.getByRole('button', { name: '샘플 사진으로 둘러보기' }).click();
  await page.waitForSelector('canvas');
  await page.waitForFunction(() => document.querySelector('canvas')?.width > 300);
  const original = await page.locator('canvas').evaluate((c) => c.toDataURL());
  await page.getByRole('button', { name: '골든 아워 따뜻하게 머무는 빛' }).click();
  await page.waitForFunction(
    (original) => document.querySelector('canvas').toDataURL() !== original,
    original,
  );
  const edited = await page.locator('canvas').evaluate((c) => c.toDataURL());
  assert.notEqual(original, edited);
  await page.getByTitle('실행 취소 (⌘/Ctrl Z)').click();
  await page.waitForFunction(
    (original) => document.querySelector('canvas').toDataURL() === original,
    original,
  );
  await page.getByTitle('다시 실행 (⌘/Ctrl Shift Z)').click();
  await page.waitForFunction(
    (edited) => document.querySelector('canvas').toDataURL() === edited,
    edited,
  );
  await app.evaluate(({ Menu, BrowserWindow }) =>
    Menu.getApplicationMenu()
      .getMenuItemById('photo-undo')
      .click(undefined, BrowserWindow.getAllWindows()[0]),
  );
  await page.waitForFunction(
    (original) => document.querySelector('canvas').toDataURL() === original,
    original,
  );
  await app.evaluate(({ Menu, BrowserWindow }) =>
    Menu.getApplicationMenu()
      .getMenuItemById('photo-redo')
      .click(undefined, BrowserWindow.getAllWindows()[0]),
  );
  await page.waitForFunction(
    (edited) => document.querySelector('canvas').toDataURL() === edited,
    edited,
  );
  await page.getByTitle('원본 비교 (\\)').click();
  await page.waitForFunction(
    (original) => document.querySelector('canvas').toDataURL() === original,
    original,
  );
  await page.getByTitle('원본 비교 (\\)').click();
  await page.getByTitle('가운데 기준 비율 자르기').click();
  await page.getByRole('button', { name: '1:1', exact: true }).click();
  await page.waitForFunction(() => {
    const c = document.querySelector('canvas');
    return c.width === c.height;
  });
  await page.getByRole('button', { name: '원본', exact: true }).click();
  await page.getByTitle('자르기 닫기').click();
  await page.getByTitle('5점 별표').click();
  await page.screenshot({ path: 'docs/editor.png' });
  await page.getByRole('button', { name: '내보내기', exact: true }).click();
  const exportPath = path.join(downloadRoot, 'Alpine — 산의 초상-edited.jpg');
  await fs.rm(exportPath, { force: true });
  await page.getByRole('button', { name: '이미지 저장', exact: true }).click();
  await awaitFile(exportPath);
  assert.ok((await fs.stat(exportPath)).size > 100000);
  await fs.rm(path.join(downloadRoot, 'Hinana-Workspace.hinanaimage'), { force: true });
  await page.getByTitle('프로젝트 저장 (⌘/Ctrl S)').click();
  await awaitFile(path.join(downloadRoot, 'Hinana-Workspace.hinanaimage'));
  const project = JSON.parse(
    await fs.readFile(path.join(downloadRoot, 'Hinana-Workspace.hinanaimage'), 'utf8'),
  );
  assert.equal(project.photos[0].rating, 5);
  assert.equal(project.photos[0].adjustments.temperature, 24);
  await page.waitForFunction(() =>
    document.querySelector('.save-status').textContent.includes('이 기기에 저장됨'),
  );
  await page.reload();
  await page.waitForSelector('canvas');
  assert.equal(await page.getByLabel('색온도', { exact: true }).inputValue(), '24');
  await page.getByRole('button', { name: '라이브러리', exact: true }).click();
  await page.getByLabel('사진 검색').fill('없는사진');
  await page.getByText('조건에 맞는 사진이 없습니다.').waitFor();
  await page.getByLabel('사진 검색').fill('Alpine');
  assert.equal(await page.locator('.photo-grid>button').count(), 1);
  await page.locator('.photo-grid>button').click();
  await page.getByRole('button', { name: '모든 보정 초기화' }).click();
  assert.equal(await page.getByLabel('색온도', { exact: true }).inputValue(), '0');
  page.on('dialog', (dialog) => dialog.accept());
  for (const photo of project.photos) {
    delete photo.metadata;
    for (const key of Object.keys(photo.adjustments).filter(
      (k) => k.startsWith('skin') || k.startsWith('mixer_') || k.startsWith('curve'),
    )) {
      delete photo.adjustments[key];
      for (const state of photo.history) delete state[key];
    }
  }
  await fs.writeFile(
    path.join(downloadRoot, 'Hinana-Workspace.hinanaimage'),
    JSON.stringify(project),
  );
  const legacyPath = path.join(downloadRoot, 'Legacy-Workspace.hinana');
  await fs.copyFile(path.join(downloadRoot, 'Hinana-Workspace.hinanaimage'), legacyPath);
  const chooserPromise = page.waitForEvent('filechooser');
  await page.locator('.topbar').getByRole('button', { name: '프로젝트 열기', exact: true }).click();
  await (await chooserPromise).setFiles(legacyPath);
  await page.waitForFunction(
    () => document.querySelector('input[aria-label="색온도"]').value === '24',
  );
  await page.locator('input[multiple]').setInputFiles(path.resolve('public/samples/alpine.jpg'));
  await page.waitForFunction(() => document.querySelectorAll('.film-frame').length === 2);
  assert.equal(await page.getByLabel('색온도', { exact: true }).inputValue(), '0');
  await page.getByTitle('이전 사진', { exact: true }).click();
  assert.equal(await page.getByLabel('색온도', { exact: true }).inputValue(), '24');
  await page.getByLabel('미리보기 배율').selectOption('100');
  await page.waitForFunction(() => document.querySelector('canvas').width === 2200);
  await page.getByTitle('화면에 맞추기').click();
  await page.getByTitle('오른쪽으로 90° 회전').click();
  await page.waitForFunction(() => {
    const c = document.querySelector('canvas');
    return c.height > c.width;
  });
  await page.getByTitle('실행 취소 (⌘/Ctrl Z)').click();
  await page.waitForFunction(() =>
    document.querySelector('.save-status').textContent.includes('이 기기에 저장됨'),
  );
  await page.screenshot({ path: 'docs/editor.png' });
  // EXIF and skin retouch, using deterministic skin-colored texture rather than personal photos.
  const jpegData = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const ctx = c.getContext('2d');
    const pixels = ctx.createImageData(256, 256);
    for (let y = 0; y < 256; y++)
      for (let x = 0; x < 256; x++) {
        const n = ((x * 17 + y * 31) % 19) - 9;
        const skin = ((x - 128) / 85) ** 2 + ((y - 128) / 108) ** 2 < 1;
        pixels.data.set(
          skin ? [195 + n, 140 + n, 113 + n, 255] : [30, 60, 130, 255],
          (y * 256 + x) * 4,
        );
      }
    ctx.putImageData(pixels, 0, 0);
    return c.toDataURL('image/jpeg', 0.98).split(',')[1];
  });
  const fixturePath = path.join(downloadRoot, 'Portrait-EXIF.jpg');
  await fs.writeFile(fixturePath, withExif(Buffer.from(jpegData, 'base64')));
  await page.locator('input[multiple]').setInputFiles(fixturePath);
  await page.waitForFunction(() => document.querySelector('canvas').width === 256);
  await page.getByRole('button', { name: '정보', exact: true }).click();
  await page.getByText('Hinana Portrait Cam', { exact: true }).waitFor();
  await page.getByText('1/125 s', { exact: true }).waitFor();
  await page.getByText('f/2.8', { exact: true }).waitFor();
  await page.screenshot({ path: 'docs/exif.png' });
  await page.getByRole('button', { name: '편집', exact: true }).click();
  const skinOriginal = await page.locator('canvas').evaluate((c) => c.toDataURL());
  await page.getByLabel('피부 부드럽게', { exact: true }).press('End');
  await page.waitForFunction(
    (original) => document.querySelector('canvas').toDataURL() !== original,
    skinOriginal,
  );
  assert.equal(await page.getByLabel('피부 부드럽게', { exact: true }).inputValue(), '100');
  await page.getByTitle('실행 취소 (⌘/Ctrl Z)').click();
  await page.waitForFunction(
    (original) => document.querySelector('canvas').toDataURL() === original,
    skinOriginal,
  );
  await page.getByTitle('다시 실행 (⌘/Ctrl Shift Z)').click();
  await page.getByLabel('붉은 기 완화', { exact: true }).press('End');
  await page.getByLabel('피부 밝기', { exact: true }).press('End');
  await page.getByRole('button', { name: '골든 아워 따뜻하게 머무는 빛' }).click();
  assert.equal(await page.getByLabel('피부 부드럽게', { exact: true }).inputValue(), '100');
  await page.waitForFunction(() =>
    document.querySelector('.save-status').textContent.includes('이 기기에 저장됨'),
  );
  await page.reload();
  await page.waitForSelector('canvas');
  assert.equal(await page.getByLabel('피부 부드럽게', { exact: true }).inputValue(), '100');
  await page.waitForFunction(() => document.querySelector('canvas').width === 256);
  const retouched = await page.locator('canvas').evaluate((c) => c.toDataURL());
  await page.getByRole('button', { name: '내보내기', exact: true }).click();
  await page.getByLabel('파일 형식', { exact: true }).selectOption('png');
  await page.getByRole('button', { name: '이미지 저장', exact: true }).click();
  const retouchFile = path.join(downloadRoot, 'Portrait-EXIF-edited.png');
  await awaitFile(retouchFile);
  const resultData = 'data:image/png;base64,' + (await fs.readFile(retouchFile)).toString('base64');
  const exportedRetouch = await page.evaluate(async (src) => {
    const image = new Image();
    image.src = src;
    await image.decode();
    const c = document.createElement('canvas');
    c.width = image.width;
    c.height = image.height;
    c.getContext('2d', {
      colorSpace: document
        .querySelector('.canvas-holder canvas')
        .getContext('2d')
        .getContextAttributes().colorSpace,
    }).drawImage(image, 0, 0);
    return c.toDataURL();
  }, resultData);
  assert.equal(exportedRetouch, retouched);
  const pngTags = await exifr.parse(await fs.readFile(retouchFile), { translateValues: false });
  assert.equal(pngTags.Make, 'Hinana');
  assert.equal(pngTags.ISO, 400);
  assert.equal(pngTags.Orientation, 1);
  assert.equal(pngTags.ExifImageWidth, 256);
  // A different aspect ratio ensures EXIF dimensions follow the edited result.
  await page.getByTitle('가운데 기준 비율 자르기').click();
  await page.getByRole('button', { name: '4:5', exact: true }).click();
  await page.getByTitle('자르기 닫기').click();
  for (const mime of ['jpeg', 'webp']) {
    await page.getByRole('button', { name: '내보내기', exact: true }).click();
    await page.getByLabel('파일 형식', { exact: true }).selectOption(mime);
    assert.ok(await page.getByLabel('EXIF 메타데이터 보존', { exact: true }).isChecked());
    await page.getByRole('button', { name: '이미지 저장', exact: true }).click();
    const outputPath = path.join(
      downloadRoot,
      'Portrait-EXIF-edited.' + (mime === 'jpeg' ? 'jpg' : 'webp'),
    );
    await awaitFile(outputPath);
    const exportedBytes = await fs.readFile(outputPath);
    const decoded = await page.evaluate(
      async (src) => {
        const img = new Image();
        img.src = src;
        await img.decode();
        return [img.width, img.height];
      },
      'data:image/' + mime + ';base64,' + exportedBytes.toString('base64'),
    );
    assert.deepEqual(decoded, [205, 256]);
    await page.locator('input[multiple]').setInputFiles(outputPath);
    await page.getByRole('button', { name: '정보', exact: true }).click();
    await page.getByText('Hinana Portrait Cam', { exact: true }).waitFor();
    await page.getByText('1/125 s', { exact: true }).waitFor();
    await page.getByRole('button', { name: '편집', exact: true }).click();
    // Return to the original fixture for the next export.
    await page.locator('.film-frame').nth(2).click();
  }
  await page.getByRole('button', { name: '내보내기', exact: true }).click();
  await page.getByLabel('파일 형식', { exact: true }).selectOption('png');
  await page.getByLabel('EXIF 메타데이터 보존', { exact: true }).uncheck();
  await fs.rm(retouchFile, { force: true });
  await page.getByRole('button', { name: '이미지 저장', exact: true }).click();
  await awaitFile(retouchFile);
  const stripped = await exifr.parse(await fs.readFile(retouchFile));
  assert.ok(!stripped?.Make);

  await fs.rm(path.join(downloadRoot, 'Hinana-Workspace.hinanaimage'), { force: true });
  await page.getByTitle('프로젝트 저장 (⌘/Ctrl S)').click();
  await awaitFile(path.join(downloadRoot, 'Hinana-Workspace.hinanaimage'));
  await page.getByRole('button', { name: '모든 보정 초기화' }).click();
  const nativeChooser = page.waitForEvent('filechooser');
  await app.evaluate(({ Menu, BrowserWindow }) =>
    Menu.getApplicationMenu()
      .getMenuItemById('project-open')
      .click(undefined, BrowserWindow.getAllWindows()[0]),
  );
  await (await nativeChooser).setFiles(path.join(downloadRoot, 'Hinana-Workspace.hinanaimage'));
  await page.waitForFunction(
    () => document.querySelector('input[aria-label="피부 부드럽게"]').value === '100',
  );
  await page.getByRole('button', { name: '정보', exact: true }).click();
  await page.getByText('Hinana Portrait Cam', { exact: true }).waitFor();
  await page.getByRole('button', { name: '편집', exact: true }).click();
  await page.screenshot({ path: 'docs/skin-retouch.png' });
  await page.getByRole('button', { name: '모든 보정 초기화' }).click();
  const droppedProject = await fs.readFile(
    path.join(downloadRoot, 'Hinana-Workspace.hinanaimage'),
    'utf8',
  );
  await page.evaluate((json) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([json], 'Dropped.hinanaimage', { type: 'application/json' }));
    document
      .querySelector('.app')
      .dispatchEvent(
        new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }),
      );
  }, droppedProject);
  await page.waitForFunction(
    () => document.querySelector('input[aria-label="피부 부드럽게"]').value === '100',
  );
  // The right-side duplicate presets are replaced with real HSL and tone tools.
  assert.equal(
    await page.locator('.right-panel').getByRole('button', { name: '프리셋', exact: true }).count(),
    0,
  );
  assert.equal(await page.getByRole('button', { name: '골든 아워 따뜻하게 머무는 빛' }).count(), 1);
  await page.getByRole('button', { name: '색상·톤', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('.canvas-holder canvas')?.getAttribute('aria-busy') === 'false',
  );
  const colorBefore = await page.locator('canvas').evaluate((c) => c.toDataURL());
  await page.getByRole('button', { name: '파랑 색상 선택', exact: true }).click();
  await page.getByLabel('파랑 명도', { exact: true }).press('Home');
  await page.waitForFunction(
    (before) => document.querySelector('canvas').toDataURL() !== before,
    colorBefore,
  );
  await page.getByTitle('실행 취소 (⌘/Ctrl Z)').click();
  await page.waitForFunction(
    (before) => document.querySelector('canvas').toDataURL() === before,
    colorBefore,
  );
  await page.getByTitle('다시 실행 (⌘/Ctrl Shift Z)').click();
  await page.getByLabel('커브 중간톤', { exact: true }).press('End');
  await page.waitForFunction(() =>
    document.querySelector('.save-status').textContent.includes('이 기기에 저장됨'),
  );
  const colorEdited = await page.locator('canvas').evaluate((c) => c.toDataURL());
  await page.screenshot({ path: 'docs/color-tools.png' });
  await page.locator('.color-swatches').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'docs/color-mixer.png' });
  await page.getByTitle('원본 비교 (\\)').click();
  await page.waitForFunction(
    (edited) => document.querySelector('canvas').toDataURL() !== edited,
    colorEdited,
  );
  await page.getByTitle('원본 비교 (\\)').click();
  await page.waitForFunction(
    (edited) => document.querySelector('canvas').toDataURL() === edited,
    colorEdited,
  );
  await fs.rm(path.join(downloadRoot, 'Hinana-Workspace.hinanaimage'), { force: true });
  await page.getByTitle('프로젝트 저장 (⌘/Ctrl S)').click();
  await awaitFile(path.join(downloadRoot, 'Hinana-Workspace.hinanaimage'));
  await page.getByRole('button', { name: '모든 보정 초기화' }).click();
  await page
    .getByTestId('project-file-input')
    .setInputFiles(path.join(downloadRoot, 'Hinana-Workspace.hinanaimage'));
  await page.waitForFunction(
    () => document.querySelector('input[aria-label="커브 중간톤"]').value === '100',
  );
  assert.equal(await page.getByLabel('파랑 명도', { exact: true }).inputValue(), '-100');
  await page.waitForFunction(
    (edited) => document.querySelector('canvas').toDataURL() === edited,
    colorEdited,
  );
  await page.getByRole('button', { name: '내보내기', exact: true }).click();
  await page.getByLabel('파일 형식', { exact: true }).selectOption('png');
  await fs.rm(retouchFile, { force: true });
  await page.getByRole('button', { name: '이미지 저장', exact: true }).click();
  await awaitFile(retouchFile);
  const colorExport = await page.evaluate(
    async (src) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      c.getContext('2d', {
        colorSpace: document
          .querySelector('.canvas-holder canvas')
          .getContext('2d')
          .getContextAttributes().colorSpace,
      }).drawImage(img, 0, 0);
      return c.toDataURL();
    },
    'data:image/png;base64,' + (await fs.readFile(retouchFile)).toString('base64'),
  );
  assert.equal(colorExport, colorEdited);
  await page.waitForFunction(() =>
    document.querySelector('.save-status').textContent.includes('이 기기에 저장됨'),
  );
  await page.reload();
  await page.waitForSelector('canvas');
  await page.getByRole('button', { name: '색상·톤', exact: true }).click();
  await page.getByRole('button', { name: '파랑 색상 선택', exact: true }).click();
  assert.equal(await page.getByLabel('파랑 명도', { exact: true }).inputValue(), '-100');
  assert.equal(await page.getByLabel('커브 중간톤', { exact: true }).inputValue(), '100');
  assert.deepEqual(errors, []);
  console.log(
    'PASS: import, pixel changes, undo/redo, compare, crop, rating, full-resolution export, project save, autosave restore, search, native menus, project reopen, multiple imports, per-photo edits, actual-size zoom, rotation, EXIF, skin retouch undo/redo, retouch persistence, PNG pixel equality, EXIF export in JPEG/PNG/WebP, EXIF opt-out, about dialog, native about menu, visible project picker, legacy .hinana, native project menu, .hinanaimage save/reopen/drop, HSL and curve edits/undo/compare/project/export/restore; no renderer errors.',
  );
} finally {
  await app.close();
  await fs.rm(profile, { recursive: true, force: true });
}
