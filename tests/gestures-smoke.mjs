import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const browser = await chromium.launch({ channel: 'chromium' });
const page = await browser.newPage({
  viewport: { width: 440, height: 956 },
  isMobile: true,
  hasTouch: true,
  acceptDownloads: true,
});
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const session = await page.context().newCDPSession(page);
const touch = (type, points) =>
  session.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: points.map((p, id) => ({ x: p.x, y: p.y, id, radiusX: 5, radiusY: 5 })),
  });
async function pinch(spread) {
  const box = await page.locator('.canvas-area').boundingBox();
  const y = box.y + box.height / 2,
    x = box.x + box.width / 2;
  const before = await page.locator('.canvas-holder canvas').evaluate((c) => c.width);
  await touch('touchStart', [{ x: x - 60, y }]);
  await touch('touchStart', [
    { x: x - 60, y },
    { x: x + 60, y },
  ]);
  for (let i = 1; i <= 5; i++) {
    const gap = 60 + ((spread - 60) * i) / 5;
    await touch('touchMove', [
      { x: x - gap, y },
      { x: x + gap, y },
    ]);
  }
  assert.equal(
    await page.locator('.canvas-holder canvas').evaluate((c) => c.width),
    before,
    'Pinch must reuse the current pixel buffer until release',
  );
  await touch('touchEnd', []);
  await page.waitForTimeout(400);
}
try {
  await page.goto('http://127.0.0.1:5173');
  await page.locator('input[multiple]').setInputFiles('public/samples/alpine.jpg');
  await page.locator('.canvas-holder canvas[aria-busy="false"]').waitFor();
  await page
    .getByLabel('모바일 작업 도구')
    .getByRole('button', { name: '편집', exact: true })
    .click();
  await pinch(100);
  const zoom = Number(await page.getByLabel('미리보기 배율', { exact: true }).inputValue());
  assert.ok(zoom > 19 && zoom < 50, 'Fit pinch should create a continuous custom zoom');
  assert.equal(
    await page.locator('.canvas-holder canvas').evaluate((c) => c.width),
    Math.floor((2200 * zoom) / 100),
  );
  assert.equal(
    await page.evaluate(() => window.visualViewport.scale),
    1,
    'App chrome must not zoom',
  );
  await pinch(20);
  assert.equal(await page.getByLabel('미리보기 배율', { exact: true }).inputValue(), '0');
  await page.getByLabel('미리보기 배율', { exact: true }).tap();
  await page.getByRole('listbox').getByRole('option', { name: '50%', exact: true }).tap();
  await page.waitForFunction(() => document.querySelector('.canvas-holder canvas').width === 1100);
  const area = await page.locator('.canvas-area').boundingBox(),
    y = area.y + area.height / 2;
  await touch('touchStart', [{ x: 330, y }]);
  await touch('touchMove', [{ x: 160, y }]);
  await touch('touchEnd', []);
  assert.ok(
    await page.locator('.canvas-area').evaluate((e) => e.scrollLeft > 100),
    'One finger should pan the zoomed photo',
  );
  await page.getByRole('button', { name: '◉ 마스크', exact: true }).click();
  if (!(await page.getByRole('button', { name: '브러시 마스크', exact: true }).count()))
    await page.getByRole('button', { name: '새 마스크 만들기', exact: true }).click();
  await page.getByRole('button', { name: '브러시 마스크', exact: true }).click();
  await pinch(80);
  const downloaded = page.waitForEvent('download');
  await page.getByTitle('프로젝트 저장 (⌘/Ctrl S)').click();
  const project = JSON.parse(await fs.readFile(await (await downloaded).path(), 'utf8'));
  assert.equal(
    project.photos[0].adjustments.masks[0].points.length,
    0,
    'Pinch must not paint a brush stroke',
  );
  assert.deepEqual(errors, []);
  console.log(
    'PASS trusted touch: continuous pinch zoom, fit, one-finger pan, bounded rendering, no page zoom or accidental mask strokes',
  );
} finally {
  await browser.close();
}
