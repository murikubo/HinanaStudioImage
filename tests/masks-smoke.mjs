import { _electron as electron } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { decode } from 'fast-png';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hinana-masks-')),
  env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.env.HINANA_TEST_APP;
const app = await electron.launch({
  ...(executablePath ? { executablePath } : {}),
  args: [...(executablePath ? [] : ['.']), `--user-data-dir=${root}`],
  env,
});
const page = await app.firstWindow();
page.setDefaultTimeout(25000);
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
    .evaluate((c) => [
      ...c.getContext('2d').getImageData(0, 0, c.width, c.height, { colorSpace: 'display-p3' })
        .data,
    ]);
async function waitFile(name) {
  for (let i = 0; i < 300; i++) {
    try {
      const bytes = await fs.readFile(path.join(root, name));
      if (bytes.length > 100) return bytes;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error('Missing ' + name);
}
try {
  await page.waitForSelector('.welcome');
  const fixture = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 200;
    c.height = 100;
    const x = c.getContext('2d');
    x.fillStyle = 'rgb(100 100 100)';
    x.fillRect(0, 0, 200, 100);
    return c.toDataURL();
  });
  const file = path.join(root, 'mask.png');
  await fs.writeFile(file, Buffer.from(fixture.split(',')[1], 'base64'));
  await page.locator('input[multiple]').setInputFiles(file);
  await idle();
  const before = await pixels();
  await page.getByRole('button', { name: '◉ 마스크', exact: true }).click();
  await page.getByRole('button', { name: '원형 추가', exact: true }).click();
  const box = await page.getByLabel('마스크 그리기 영역').boundingBox();
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.8, { steps: 6 });
  await page.mouse.up();
  await page.getByLabel('로컬 노출', { exact: true }).fill('1');
  await page.getByLabel('로컬 노출', { exact: true }).press('ArrowRight');
  await idle();
  const edited = await pixels();
  assert.ok(edited[(50 * 200 + 60) * 4] > before[(50 * 200 + 60) * 4]);
  assert.equal(edited[(50 * 200 + 180) * 4], before[(50 * 200 + 180) * 4]);
  await page.getByTitle('실행 취소 (⌘/Ctrl Z)').click();
  await idle();
  assert.deepEqual(await pixels(), before);
  await page.getByTitle('다시 실행 (⌘/Ctrl Shift Z)').click();
  await idle();
  assert.deepEqual(await pixels(), edited);
  await page.getByLabel('마스크 사용', { exact: true }).uncheck();
  await idle();
  assert.deepEqual(await pixels(), before);
  await page.getByLabel('마스크 사용', { exact: true }).check();
  await idle();
  await page.getByTitle('프로젝트 저장 (⌘/Ctrl S)').click();
  const project = JSON.parse(await waitFile('Hinana-Workspace.hinanaimage'));
  assert.equal(project.version, 5);
  assert.equal(project.photos[0].adjustments.masks.length, 1);
  await page.getByRole('button', { name: '내보내기', exact: true }).click();
  await page.getByLabel('파일 형식', { exact: true }).selectOption('png');
  await page.getByRole('button', { name: '이미지 저장', exact: true }).click();
  const bytes = await waitFile('mask-edited.png');
  const exported = decode(bytes);
  assert.equal(exported.data[(50 * 200 + 60) * 4], edited[(50 * 200 + 60) * 4]);
  assert.equal(exported.data[(50 * 200 + 180) * 4], edited[(50 * 200 + 180) * 4]);
  await page.waitForFunction(() =>
    document.querySelector('.save-status')?.textContent.includes('이 기기에 저장됨'),
  );
  await page.reload();
  await idle();
  assert.deepEqual(await pixels(), edited);
  await page.getByRole('button', { name: '◉ 마스크', exact: true }).click();
  await page.getByRole('button', { name: '브러시 추가', exact: true }).click();
  await page.getByLabel('로컬 노출', { exact: true }).fill('-0.5');
  await page.getByLabel('로컬 노출', { exact: true }).press('ArrowRight');
  const brush = await page.getByLabel('마스크 그리기 영역').boundingBox();
  for (const x of [0.15, 0.85]) {
    await page.mouse.move(brush.x + brush.width * x, brush.y + brush.height * 0.2);
    await page.mouse.down();
    await page.mouse.move(brush.x + brush.width * x, brush.y + brush.height * 0.3, { steps: 5 });
    await page.mouse.up();
  }
  await idle();
  const brushed = await pixels();
  assert.equal(brushed[(25 * 200 + 100) * 4], edited[(25 * 200 + 100) * 4]);
  assert.ok(brushed[(25 * 200 + 30) * 4] < edited[(25 * 200 + 30) * 4]);
  await page.screenshot({ path: 'docs/local-masks.png' });
  page.on('dialog', (d) => d.accept());
  await page
    .getByTestId('project-file-input')
    .setInputFiles(path.join(root, 'Hinana-Workspace.hinanaimage'));
  await page.waitForTimeout(300);
  await idle();
  assert.deepEqual(await pixels(), edited);
  await page.getByRole('button', { name: '모든 보정 초기화', exact: true }).click();
  await idle();
  assert.deepEqual(await pixels(), before);
  await page.getByTitle('실행 취소 (⌘/Ctrl Z)').click();
  await idle();
  assert.deepEqual(await pixels(), edited);
  await page.getByRole('button', { name: '편집', exact: true }).click();
  await page.getByLabel('편집 정밀도', { exact: true }).selectOption('legacy');
  await idle();
  const legacy = await pixels();
  assert.ok(legacy[(50 * 200 + 60) * 4] > legacy[(50 * 200 + 180) * 4]);
  await page.getByLabel('편집 정밀도', { exact: true }).selectOption('float');
  await fs.unlink(path.join(root, 'mask-edited.png'));
  await page.getByRole('button', { name: '내보내기', exact: true }).click();
  await page.getByLabel('파일 형식', { exact: true }).selectOption('png16');
  await page.getByRole('button', { name: '이미지 저장', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  const high = decode(await waitFile('mask-edited.png'));
  assert.equal(high.depth, 16);
  assert.ok(high.data[(50 * 200 + 60) * 4] > high.data[(50 * 200 + 180) * 4]);
  assert.deepEqual(errors, []);
  console.log(
    'PASS: radial/brush local edits, untouched areas, undo/redo, disable, overlay-free export, v5 project reopen and autosave',
  );
} finally {
  await app.close();
}
