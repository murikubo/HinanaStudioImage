import { _electron as electron } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { decode } from 'fast-png';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hinana-liquify-')),
  env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.env.HINANA_TEST_APP;
const app = await electron.launch({
  ...(executablePath ? { executablePath } : {}),
  args: [...(executablePath ? [] : ['.']), `--user-data-dir=${root}`],
  env,
});
const page = await app.firstWindow();
page.setDefaultTimeout(30000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await app.evaluate(
  ({ session }, folder) =>
    session.defaultSession.on('will-download', (_e, item) =>
      item.setSavePath(folder + '/' + item.getFilename()),
    ),
  root,
);
const idle = () =>
  page.waitForFunction(
    () => document.querySelector('.canvas-holder canvas')?.getAttribute('aria-busy') === 'false',
  );
const pixels = () =>
  page
    .locator('.canvas-holder canvas')
    .evaluate((c) => Array.from(c.getContext('2d').getImageData(0, 0, c.width, c.height).data));
async function waitFile(name) {
  for (let i = 0; i < 200; i++) {
    try {
      return await fs.readFile(path.join(root, name));
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error('Missing ' + name);
}
try {
  await page.waitForSelector('.welcome');
  const fixture = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const ctx = c.getContext('2d'),
      data = ctx.createImageData(256, 256);
    for (let y = 0; y < 256; y++)
      for (let x = 0; x < 256; x++) {
        const p = (y * 256 + x) * 4;
        data.data[p] = x;
        data.data[p + 1] = y;
        data.data[p + 2] = 128;
        data.data[p + 3] = 255;
      }
    ctx.putImageData(data, 0, 0);
    return c.toDataURL();
  });
  const file = path.join(root, 'warp.png');
  await fs.writeFile(file, Buffer.from(fixture.split(',')[1], 'base64'));
  await page.locator('input[multiple]').setInputFiles(file);
  await idle();
  const before = await pixels();
  await page.getByRole('button', { name: '리퀴파이', exact: true }).click();
  const box = await page.getByLabel('리퀴파이 브러시', { exact: true }).boundingBox();
  await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.4, { steps: 12 });
  await page.mouse.up();
  await idle();
  const edited = await pixels(),
    at = (102 * 256 + 115) * 4;
  assert.ok(edited[at] < before[at] - 2, 'horizontal GPU warp');
  assert.ok(edited[at + 1] < before[at + 1] - 2, 'vertical GPU warp');
  assert.equal(edited[(230 * 256 + 230) * 4], before[(230 * 256 + 230) * 4]);
  await page.getByTitle('실행 취소 (⌘/Ctrl Z)').click();
  await idle();
  assert.deepEqual(await pixels(), before);
  await page.getByTitle('다시 실행 (⌘/Ctrl Shift Z)').click();
  await idle();
  assert.deepEqual(await pixels(), edited);
  await page.getByTitle('프로젝트 저장 (⌘/Ctrl S)').click();
  const project = JSON.parse(await waitFile('Hinana-Workspace.hinanaimage'));
  assert.equal(project.version, 6);
  assert.equal(project.photos[0].adjustments.liquify.width, 129);
  await page.getByRole('button', { name: '내보내기', exact: true }).click();
  await page.getByLabel('파일 형식', { exact: true }).selectOption('png');
  await page.getByRole('button', { name: '이미지 저장', exact: true }).click();
  const exported = decode(await waitFile('warp-edited.png'));
  assert.ok(Math.abs(exported.data[at] - edited[at]) <= 1);
  await page.waitForFunction(() =>
    document.querySelector('.save-status')?.textContent.includes('이 기기에 저장됨'),
  );
  await page.reload();
  await idle();
  assert.deepEqual(await pixels(), edited);
  await page.getByRole('button', { name: '리퀴파이', exact: true }).click();
  await page.getByRole('button', { name: '변형만 초기화', exact: true }).click();
  await idle();
  assert.deepEqual(await pixels(), before);
  assert.deepEqual(errors, []);
  console.log(
    'Desktop liquify: GPU drag, local boundaries, undo/redo, v6 project, PNG export, restore and reset passed.',
  );
} finally {
  await app.close();
}
