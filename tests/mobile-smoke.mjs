import { chromium, webkit } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
for (const [name, engine] of [
  ['android', chromium],
  ['iphone', webkit],
]) {
  if (process.env.MOBILE_TEST_ENGINE && process.env.MOBILE_TEST_ENGINE !== name) continue;
  const browser = await engine.launch(name === 'android' ? { channel: 'chromium' } : {});
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    acceptDownloads: true,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  async function checkPreviewFit() {
    await page.locator('.canvas-holder canvas[aria-busy="false"]').waitFor();
    const fit = await page.evaluate(() => {
      const area = document.querySelector('.canvas-area');
      const a = area.getBoundingClientRect();
      const c = area.querySelector('canvas').getBoundingClientRect();
      const style = getComputedStyle(area);
      const width = a.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const height = a.height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      return {
        ratio: Math.max(c.width / width, c.height / height),
        inside:
          c.left >= a.left && c.top >= a.top && c.right <= a.right + 1 && c.bottom <= a.bottom + 1,
      };
    });
    assert.ok(fit.inside, 'Fit preview must stay inside the photo area');
    assert.ok(fit.ratio > 0.95, 'Fit preview must use the available width or height');
  }
  try {
    await page.goto('http://127.0.0.1:5173');
    await page.locator('input[multiple]').setInputFiles('public/samples/alpine.jpg');
    await page.locator('canvas').first().waitFor();
    await checkPreviewFit();
    const header = await page.locator('.topbar').boundingBox();
    assert.ok(header.height <= 60, 'Mobile header must fit on one row');
    const navigation = await page.getByLabel('모바일 작업 도구').boundingBox();
    assert.equal(Math.round(navigation.y + navigation.height), 844);
    await page
      .getByLabel('모바일 작업 도구')
      .getByRole('button', { name: '편집', exact: true })
      .click();
    const before = await page
      .locator('canvas')
      .first()
      .evaluate((c) => c.toDataURL());
    await page.getByLabel('노출', { exact: true }).focus();
    for (let i = 0; i < 16; i++) await page.keyboard.press('ArrowRight');
    assert.equal(await page.getByLabel('노출', { exact: true }).inputValue(), '0.8');
    await page.waitForTimeout(500);
    assert.notEqual(
      await page
        .locator('canvas')
        .first()
        .evaluate((c) => c.toDataURL()),
      before,
    );
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    // Zoom, pan, then fit repeatedly: panning must not allocate/render another frame.
    await page.evaluate(() => {
      window.__zoomNavigationMarker = 'same-page';
    });
    for (let repeat = 0; repeat < 3; repeat++) {
      await page.getByLabel('미리보기 배율', { exact: true }).tap();
      await page.getByRole('listbox').getByRole('option', { name: '50%', exact: true }).tap();
      await page.waitForFunction(
        () => document.querySelector('.canvas-holder canvas')?.width === 1100,
      );
      const canvas = page.locator('.canvas-holder canvas');
      const beforePan = await canvas.evaluate((c) => c.toDataURL());
      await page.locator('.canvas-area').evaluate((area) => {
        area.scrollLeft = 120;
        area.scrollTop = 80;
      });
      await page.waitForTimeout(100);
      assert.ok(await page.locator('.canvas-area').evaluate((area) => area.scrollLeft > 0));
      assert.equal(await canvas.evaluate((c) => c.toDataURL()), beforePan);
      await page.getByLabel('미리보기 배율', { exact: true }).tap();
      await page.getByRole('listbox').getByRole('option', { name: '맞춤', exact: true }).tap();
      await page.waitForFunction(
        () => document.querySelector('.canvas-holder canvas')?.width === 1600,
      );
      await checkPreviewFit();
      assert.equal(await page.evaluate(() => window.__zoomNavigationMarker), 'same-page');
    }
    // Touch opens our app listbox, including on WebKit, rather than the system picker.
    await page.getByLabel('편집 정밀도', { exact: true }).tap();
    await page.getByRole('listbox').waitFor();
    await page
      .getByRole('listbox')
      .getByRole('option', { name: '32비트 부동소수점', exact: true })
      .tap();
    assert.equal(await page.getByLabel('편집 정밀도', { exact: true }).inputValue(), 'float');
    await page.getByLabel('밝기 범위', { exact: true }).tap();
    await page.getByRole('listbox').getByRole('option', { name: 'HDR', exact: true }).tap();
    await page.getByLabel('HDR 최대 밝기', { exact: true }).tap();
    await page.getByRole('listbox').getByRole('option', { name: '2000 nit', exact: true }).tap();
    assert.equal(await page.getByLabel('HDR 최대 밝기', { exact: true }).inputValue(), '2000');
    await page.getByLabel('HDR 최대 밝기', { exact: true }).focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Enter');
    assert.equal(await page.getByLabel('HDR 최대 밝기', { exact: true }).inputValue(), '1000');
    await page.getByLabel('HDR 최대 밝기', { exact: true }).tap();
    const box = await page.getByRole('listbox').boundingBox();
    assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= 390 && box.y + box.height <= 844);
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('listbox').count(), 0);
    // Compare SDR proof pixels; WebGPU presentation is tested separately on Electron.
    await page.getByLabel('SDR 밝기 변환 미리보기', { exact: true }).check();
    await page.locator('canvas[aria-busy="false"]').first().waitFor();
    const sdrPreview = await page
      .locator('canvas')
      .first()
      .evaluate((c) => c.toDataURL());
    await page.getByLabel('HDR 밝은 영역 확장', { exact: true }).evaluate((input) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '75');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.getByLabel('HDR 밝은 영역 확장', { exact: true }).dispatchEvent('pointerup');
    await page.waitForFunction(
      (before) => document.querySelector('canvas')?.toDataURL() !== before,
      sdrPreview,
      { timeout: 30000 },
    );
    await page
      .getByText('SDR 변환 미리보기 사용 중 · HDR 데이터는 유지됩니다.', { exact: true })
      .waitFor();
    await page.screenshot({ path: `/tmp/hinana-mobile-${name}.png` });
    await page
      .getByLabel('모바일 작업 도구')
      .getByRole('button', { name: '프리셋', exact: true })
      .click();
    await page.locator('.preset-list button').nth(1).click();
    assert.ok(await page.locator('.left-panel').isVisible());
    await page
      .getByLabel('모바일 작업 도구')
      .getByRole('button', { name: '편집', exact: true })
      .click();
    await page.getByRole('button', { name: '◉ 마스크', exact: true }).click();
    await page.getByRole('button', { name: '선형 마스크', exact: true }).click();
    await page
      .getByLabel('모바일 작업 도구')
      .getByRole('button', { name: '사진', exact: true })
      .click();
    assert.equal(await page.locator('.photo-grid>button').count(), 1);
    await page.locator('.photo-grid>button').click();
    const downloaded = page.waitForEvent('download');
    await page.getByTitle('프로젝트 저장 (⌘/Ctrl S)').click();
    const file = await downloaded;
    assert.equal(file.suggestedFilename(), 'Hinana-Workspace.hinanaimage');
    const p = JSON.parse(await fs.readFile(await file.path(), 'utf8'));
    assert.equal(p.photos.length, 1);
    assert.equal(p.photos[0].adjustments.masks.length, 1);
    assert.equal(p.photos[0].adjustments.hdrHighlights, 75);
    await page.setViewportSize({ width: 956, height: 440 });
    await checkPreviewFit();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    assert.deepEqual(errors, []);
    console.log(
      `PASS ${name}: mobile layout, editing pixels, presets, local mask, library, project export and landscape`,
    );
  } finally {
    await browser.close();
  }
}

// Verify the native bridge contract without pretending to exercise an OS share sheet.
if (!process.env.MOBILE_TEST_ENGINE || process.env.MOBILE_TEST_ENGINE === 'native') {
  const browser = await chromium.launch({ channel: 'chromium' });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.addInitScript(() => {
    window.androidBridge = {};
    window.__nativeCalls = [];
    window.Capacitor = {
      PluginHeaders: [
        {
          name: 'Filesystem',
          methods: [
            { name: 'writeFile', rtype: 'promise' },
            { name: 'getUri', rtype: 'promise' },
          ],
        },
        { name: 'Share', methods: [{ name: 'share', rtype: 'promise' }] },
      ],
      nativePromise: async (plugin, method, options) => {
        window.__nativeCalls.push({ plugin, method, options });
        if (window.__failExport && method === 'writeFile') throw Error('Storage full');
        if (method === 'getUri') return { uri: 'file:///cache/' + options.path };
        return {};
      },
    };
  });
  try {
    await page.goto('http://127.0.0.1:5173');
    await page.locator('input[multiple]').setInputFiles('public/samples/alpine.jpg');
    await page.locator('canvas').first().waitFor();
    await page.getByTitle('프로젝트 저장 (⌘/Ctrl S)').click();
    await page.getByText('프로젝트 저장·공유 창을 열었습니다.', { exact: true }).waitFor();
    const calls = await page.evaluate(() => window.__nativeCalls);
    const write = calls.find((c) => c.method === 'writeFile');
    const project = JSON.parse(Buffer.from(write.options.data, 'base64').toString('utf8'));
    assert.equal(project.photos.length, 1);
    assert.ok(project.photos[0].src.startsWith('data:image/jpeg;base64,'));
    assert.equal(write.options.directory, 'CACHE');
    assert.ok(write.options.path.endsWith('/Hinana-Workspace.hinanaimage'));
    assert.equal(
      calls.find((c) => c.method === 'share').options.files[0],
      'file:///cache/' + write.options.path,
    );
    await page.evaluate(() => {
      window.__failExport = true;
    });
    await page.getByTitle('프로젝트 저장 (⌘/Ctrl S)').click();
    await page.getByText('프로젝트를 저장하지 못했습니다.', { exact: true }).waitFor();
    assert.equal(
      (await page.evaluate(() => window.__nativeCalls)).filter((c) => c.method === 'share').length,
      1,
    );
    console.log(
      'PASS native bridge contract: intact project bytes, cache URI handoff and storage failure handling (mock plugins)',
    );
  } finally {
    await browser.close();
  }
}
