import { chromium, webkit } from '@playwright/test';
import assert from 'node:assert/strict';

for (const engine of [chromium, webkit]) {
  const browser = await engine.launch();
  const page = await browser.newPage({
    viewport: { width: 440, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  const session = engine === chromium ? await page.context().newCDPSession(page) : null;
  if (!session) {
    // WebKit automation has no trusted multi-touch API; explicit events test geometry.
    await page.addInitScript(() => {
      Element.prototype.setPointerCapture = () => {};
    });
  }
  const touches = new Map();
  async function pointer(type, id, x, y) {
    if (session) {
      if (type === 'pointerup') touches.delete(id);
      else touches.set(id, { id, x, y, radiusX: 5, radiusY: 5 });
      await session.send('Input.dispatchTouchEvent', {
        type:
          type === 'pointerdown' ? 'touchStart' : type === 'pointermove' ? 'touchMove' : 'touchEnd',
        touchPoints: [...touches.values()],
      });
    } else {
      await page.locator('.canvas-area').dispatchEvent(type, {
        pointerId: id,
        pointerType: 'touch',
        isPrimary: id === 1,
        button: 0,
        clientX: x,
        clientY: y,
      });
    }
  }
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto('http://127.0.0.1:5173');
    // Match the reported 24MP portrait dimensions, without using personal photos.
    await page.evaluate(async () => {
      const image = new Image();
      image.src = '/samples/alpine.jpg';
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = 4284;
      canvas.height = 5712;
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
      const transfer = new DataTransfer();
      transfer.items.add(new File([blob], 'portrait-24mp.jpg', { type: 'image/jpeg' }));
      const input = document.querySelector('input[multiple]');
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      canvas.width = canvas.height = 0;
      window.__samePage = true;
    });
    await page.locator('.canvas-holder canvas[aria-busy="false"]').waitFor();
    const area = page.locator('.canvas-area'),
      canvas = page.locator('.canvas-holder canvas');
    for (const zoom of [8, 6, 11, 14, 25, 50, 150, 12, 8, 6, 11]) {
      const box = await area.boundingBox();
      const x = box.x + box.width / 2,
        y = box.y + box.height / 2;
      const displayed = await canvas.boundingBox();
      const current = (displayed.width / 4284) * 100;
      await pointer('pointerdown', 1, x - 50, y);
      await pointer('pointerdown', 2, x + 50, y);
      const gap = (50 * zoom) / current;
      await pointer('pointermove', 1, x - gap, y);
      await pointer('pointermove', 2, x + gap, y);
      await pointer('pointerup', 1, x - gap, y);
      await pointer('pointerup', 2, x + gap, y);
      await page.waitForFunction(
        () => document.querySelector('.canvas-holder canvas').getAttribute('aria-busy') === 'false',
      );
      const actual = Number(await page.getByLabel('미리보기 배율', { exact: true }).inputValue());
      assert.equal(actual, zoom);
      const pixels = await canvas.evaluate((c) => ({
        width: c.width,
        height: c.height,
        alpha: c.getContext('2d').getImageData(c.width / 2, c.height / 2, 1, 1).data[3],
      }));
      assert.ok(pixels.height >= 1600, 'Pinch must retain at least fit-mode detail');
      assert.ok(pixels.width * pixels.height <= 4_000_000, '24MP preview must remain bounded');
      assert.equal(pixels.alpha, 255, 'A completed render must not be blank');
      if (zoom === 11)
        assert.equal(pixels.height, 1884, '11% on a 3x screen needs 1884 pixels, not 628');
      const rect = await canvas.boundingBox();
      const layout = await area.evaluate((e) => {
        const r = e.getBoundingClientRect(),
          s = getComputedStyle(e);
        return {
          left: r.left + parseFloat(s.paddingLeft),
          top: r.top + parseFloat(s.paddingTop),
          width: e.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight),
          height: e.clientHeight - parseFloat(s.paddingTop) - parseFloat(s.paddingBottom),
        };
      });
      if (rect.width < layout.width)
        assert.ok(
          Math.abs(rect.x + rect.width / 2 - layout.left - layout.width / 2) < 1,
          'Narrow zoomed photos must center horizontally',
        );
      if (rect.height < layout.height)
        assert.ok(
          Math.abs(rect.y + rect.height / 2 - layout.top - layout.height / 2) < 1,
          'Short zoomed photos must center vertically',
        );
      assert.ok(
        Math.abs(rect.width - (4284 * zoom) / 100) < 1,
        'Changing buffer size must not change the display zoom',
      );
      assert.ok(
        Math.abs(rect.width / rect.height - 0.75) < 0.001,
        'Portrait aspect ratio must remain stable',
      );
      assert.equal(await page.evaluate(() => window.__samePage), true);
    }
    await area.evaluate((e) => e.scrollTo(0, 0));
    let edge = await canvas.boundingBox();
    const bounds = await area.boundingBox();
    assert.ok(edge.y >= bounds.y, 'Top edge of an oversized photo must remain reachable');
    await area.evaluate((e) => e.scrollTo(e.scrollWidth, e.scrollHeight));
    edge = await canvas.boundingBox();
    assert.ok(
      edge.y + edge.height <= bounds.y + bounds.height,
      'Bottom edge must remain reachable',
    );
    assert.deepEqual(errors, []);
    console.log(
      `PASS ${engine.name()}: 24MP portrait at 3x pixel density, repeated pinch across 6–150%, centered spare space and reachable edges, stable geometry, nonblank bounded buffers`,
    );
  } finally {
    await browser.close();
  }
}
