import { _electron as electron } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'hinana-layout-'));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.env.HINANA_TEST_APP;
const app = await electron.launch({
  ...(executablePath ? { executablePath } : {}),
  args: [...(executablePath ? [] : ['.']), `--user-data-dir=${profile}`],
  env,
});
try {
  const page = await app.firstWindow();
  await page.waitForSelector('.welcome');
  // On macOS this checks Windows CSS only; native Windows controls require Windows CI.
  if (process.platform !== 'win32')
    await page.locator('.app').evaluate((el) => {
      el.classList.remove('desktop-darwin', 'desktop-linux');
      el.classList.add('desktop-win32');
    });
  for (const width of [1000, 1250, 1540]) {
    await app.evaluate(
      ({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 850),
      width,
    );
    await page.waitForTimeout(150);
    const boxes = await page.evaluate(() => {
      const bounds = (selector) => {
        const r = document.querySelector(selector).getBoundingClientRect();
        return { left: r.left, right: r.right };
      };
      return {
        brand: bounds('.brand'),
        nav: bounds('.topbar nav'),
        actions: bounds('.top-actions'),
        width: innerWidth,
      };
    });
    assert.ok(boxes.brand.right <= boxes.nav.left + 1, `Brand overlaps navigation at ${width}`);
    assert.ok(boxes.nav.right <= boxes.actions.left + 1, `Navigation overlaps actions at ${width}`);
    assert.ok(boxes.actions.right <= boxes.width - 145, `Caption button space missing at ${width}`);
    if (width === 1000) await page.screenshot({ path: 'docs/windows-layout.png' });
  }
  console.log(
    `PASS: Windows header layout at 1000/1250/1540px (${process.platform === 'win32' ? 'native Windows' : 'CSS simulation only'})`,
  );
} finally {
  await app.close();
  await fs.rm(profile, { recursive: true, force: true });
}
