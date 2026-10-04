import { chromium, webkit } from '@playwright/test';
import assert from 'node:assert/strict';

for (const engine of [chromium, webkit]) {
  const browser = await engine.launch();
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto('http://127.0.0.1:5173');
    await page.locator('input[multiple]').setInputFiles([
      {
        name: 'first.jpg',
        mimeType: 'image/jpeg',
        buffer: await (await import('node:fs/promises')).readFile('public/samples/alpine.jpg'),
      },
      {
        name: 'second.jpg',
        mimeType: 'image/jpeg',
        buffer: await (await import('node:fs/promises')).readFile('public/samples/alpine.jpg'),
      },
    ]);
    await page.locator('.canvas-holder canvas[aria-busy="false"]').waitFor();
    assert.equal(await page.locator('.brand').innerText(), 'HINANA\nStudio Image');
    assert.ok(await page.locator('.brand span').isVisible());
    await page
      .getByLabel('모바일 작업 도구')
      .getByRole('button', { name: '사진', exact: true })
      .click();
    const tiles = page.locator('.photo-grid > button');
    await tiles
      .first()
      .dispatchEvent('pointerdown', {
        pointerId: 1,
        pointerType: 'touch',
        isPrimary: true,
        button: 0,
        clientX: 50,
        clientY: 180,
      });
    await page.waitForTimeout(100);
    await tiles
      .first()
      .dispatchEvent('pointermove', {
        pointerId: 1,
        pointerType: 'touch',
        clientX: 50,
        clientY: 230,
      });
    await page.waitForTimeout(600);
    assert.equal(await page.getByRole('dialog').count(), 0, 'Scrolling must cancel a long press');
    await tiles.first().dispatchEvent('pointerup', { pointerId: 1, pointerType: 'touch' });
    await tiles
      .first()
      .dispatchEvent('pointerdown', {
        pointerId: 2,
        pointerType: 'touch',
        isPrimary: true,
        button: 0,
        clientX: 50,
        clientY: 180,
      });
    const dialog = page.getByRole('dialog', { name: '라이브러리에서 삭제' });
    await dialog.waitFor();
    assert.ok((await dialog.innerText()).includes('first.jpg'));
    await dialog.getByRole('button', { name: '취소', exact: true }).click();
    assert.equal(await tiles.count(), 2);
    await tiles.first().click({ button: 'right' });
    await dialog.getByRole('button', { name: '삭제', exact: true }).click();
    assert.equal(await tiles.count(), 1);
    assert.ok((await tiles.innerText()).includes('second.jpg'));
    await page.waitForFunction(() =>
      document.querySelector('.save-status')?.textContent.includes('이 기기에 저장됨'),
    );
    await page.reload();
    await page.locator('.canvas-holder canvas').waitFor();
    await page
      .getByLabel('모바일 작업 도구')
      .getByRole('button', { name: '사진', exact: true })
      .click();
    assert.equal(await tiles.count(), 1, 'Removal must persist after restarting');
    await tiles.first().focus();
    await page.keyboard.press('Shift+F10');
    await dialog.getByRole('button', { name: '삭제', exact: true }).click();
    assert.equal(await tiles.count(), 0);
    assert.ok(
      await page
        .getByText('아직 사진이 없습니다. 사진을 추가해 보세요.', { exact: true })
        .isVisible(),
    );
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        'Header must fit',
      );
      const brand = await page.locator('.brand').boundingBox();
      const actions = await page.locator('.top-actions').boundingBox();
      assert.ok(brand.x + brand.width <= actions.x, 'Full program name must not overlap actions');
    }
    assert.deepEqual(errors, []);
    console.log(
      `PASS ${engine.name()}: long press, scroll cancellation, cancel, target deletion, persistence, last-photo removal, full mobile brand`,
    );
  } finally {
    await browser.close();
  }
}
