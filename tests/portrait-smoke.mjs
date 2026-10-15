import { _electron as electron } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { decode } from 'fast-png';
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'hinana-portrait-'));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.env.HINANA_TEST_APP;
const app = await electron.launch({
  ...(executablePath ? { executablePath } : {}),
  args: [...(executablePath ? [] : ['.']), `--user-data-dir=${profile}`],
  env,
});
const page = await app.firstWindow();
page.setDefaultTimeout(30000);
const errors = [],
  logs = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => logs.push(m.text()));
async function idle() {
  await page.waitForFunction(
    () => document.querySelector('.canvas-holder canvas')?.getAttribute('aria-busy') === 'false',
  );
}
async function end(label) {
  const input = page.getByLabel(label, { exact: true });
  await input.focus();
  await input.press('End');
  await input.blur();
  await idle();
}
const canvas = page.getByLabel('보정 사진 미리보기');
try {
  await app.evaluate(({ session }) =>
    session.defaultSession.webRequest.onBeforeRequest(
      { urls: ['http://*/*', 'https://*/*'] },
      (_details, callback) => callback({ cancel: true }),
    ),
  );
  await page.waitForSelector('.welcome');
  await page.locator('input[multiple]').setInputFiles(path.resolve('models/portrait/portrait.jpg'));
  await idle();
  await page.getByRole('button', { name: '얼굴·체형 인식', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('.portrait-status')?.textContent.match(/얼굴 [1-5]명/),
    {},
    { timeout: 90000 },
  );
  console.log('Face:', await page.locator('.portrait-status').textContent());
  const original = await canvas.evaluate((c) => c.toDataURL());
  await end('얼굴 슬림');
  await page.waitForFunction(
    (before) => document.querySelector('.canvas-holder canvas').toDataURL() !== before,
    original,
  );
  await page.waitForFunction(
    () => document.querySelector('.canvas-holder canvas').dataset.liquifyBackend === 'direct3d11',
  );
  await page.getByTitle('실행 취소 (⌘/Ctrl Z)').click();
  await idle();
  assert.equal(await canvas.evaluate((c) => c.toDataURL()), original);
  await page.getByTitle('다시 실행 (⌘/Ctrl Shift Z)').click();
  await idle();
  await page.getByRole('button', { name: 'AI 인물 크롭 · 4:5', exact: true }).click();
  await idle();
  const cropped = await canvas.evaluate((c) => [c.width, c.height]);
  assert.ok(Math.abs(cropped[0] / cropped[1] - 0.8) < 0.02);
  await end('크롭 가로 위치');
  await page.getByRole('button', { name: '듀이', exact: true }).click();
  await idle();
  assert.equal(await page.getByLabel('피부 글로시', { exact: true }).inputValue(), '50');
  const library = page.getByRole('region', { name: '사용자 프리셋 보관함' });
  await library.locator('.preset-manage').evaluate((d) => {
    d.open = true;
  });
  await library.getByLabel('프리셋 이름', { exact: true }).fill('AI 인물 공유');
  await library.getByLabel('저장할 보정', { exact: true }).selectOption('portrait');
  await library
    .getByRole('button', { name: '현재 보정을 새 프리셋으로 저장', exact: true })
    .click();
  await library.getByRole('button', { name: /^AI 인물 공유/ }).waitFor();
  await library.getByRole('button', { name: '선택 프리셋 토큰 만들기', exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector('textarea[aria-label="Hinana 공유 토큰"]').value.startsWith('HINANA1.'),
  );
  const token = await library.getByLabel('Hinana 공유 토큰', { exact: true }).inputValue();
  await library.getByRole('button', { name: 'Hinana 토큰 가져오기', exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector('.preset-feedback')?.textContent.includes('공유 프리셋을 가져왔습니다.'),
  );
  assert.equal(await library.getByRole('button', { name: /^AI 인물 공유/ }).count(), 2);
  await library
    .getByLabel('Hinana 공유 토큰', { exact: true })
    .fill(token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a'));
  await library.getByRole('button', { name: 'Hinana 토큰 가져오기', exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector('.preset-feedback')?.textContent.includes('손상'),
  );
  await page.locator('input[multiple]').setInputFiles(path.resolve('models/portrait/pose.jpg'));
  await idle();
  await page.getByRole('button', { name: '얼굴·체형 인식', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('.portrait-status')?.textContent.match(/체형 보정 가능 [1-5]명/),
    {},
    { timeout: 90000 },
  );
  console.log('Pose:', await page.locator('.portrait-status').textContent());
  const bodyBefore = await canvas.evaluate((c) => c.toDataURL());
  await end('허리 슬림');
  await page.waitForFunction(
    (before) => document.querySelector('.canvas-holder canvas').toDataURL() !== before,
    bodyBefore,
  );
  // A shared AI preset must re-detect the new photo, rather than copy source coordinates.
  await page.locator('input[multiple]').setInputFiles(path.resolve('models/portrait/portrait.jpg'));
  await idle();
  await library
    .getByRole('button', { name: /^AI 인물 공유/ })
    .first()
    .click();
  await page.waitForFunction(
    () => document.querySelector('.portrait-status')?.textContent.match(/얼굴 [1-5]명/),
    {},
    { timeout: 90000 },
  );
  await idle();
  assert.equal(await page.getByLabel('얼굴 슬림', { exact: true }).inputValue(), '100');
  await page.getByLabel('편집 정밀도', { exact: true }).selectOption('legacy');
  await idle();
  await page.waitForFunction(
    () => document.querySelector('.canvas-holder canvas').dataset.liquifyBackend === 'direct3d11',
  );
  await page.getByLabel('편집 정밀도', { exact: true }).selectOption('float');
  await idle();
  const out = path.join(profile, 'portrait-out.png');
  await app.evaluate(
    ({ session }, out) =>
      session.defaultSession.once('will-download', (_e, item) => item.setSavePath(out)),
    out,
  );
  await page.getByRole('button', { name: '내보내기', exact: true }).click();
  await page.getByLabel('파일 형식', { exact: true }).selectOption('png16');
  await page.getByRole('button', { name: '이미지 저장', exact: true }).click();
  let exported;
  for (let i = 0; i < 150; i++) {
    try {
      exported = decode(await fs.readFile(out));
      break;
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    await page.waitForTimeout(100);
  }
  assert.ok(exported);
  assert.equal(exported.depth, 16);
  assert.equal(exported.width, 820);
  assert.equal(exported.height, 1024);
  await page.waitForFunction(() =>
    document.querySelector('.save-status')?.textContent.includes('이 기기에 저장됨'),
  );
  await page.reload();
  await idle();
  await page.waitForFunction(() =>
    document.querySelector('.portrait-status')?.textContent.match(/얼굴 [1-5]명/),
  );
  assert.equal(await page.getByLabel('얼굴 슬림', { exact: true }).inputValue(), '100');
  await page.screenshot({ path: 'release/portrait-ai.png' });
  assert.deepEqual(errors, []);
  console.log(
    'PASS: offline real face/pose detection, native GPU face/body warps, undo/redo, AI/free crop, gloss, token roundtrip/corruption rejection, new-photo auto-analysis, 8/32-bit GPU paths, 16-bit export and persistence.',
  );
} catch (error) {
  console.error('Renderer errors', errors, 'Logs', logs.slice(-15));
  console.error((await page.locator('body').innerText()).slice(-1500));
  await page.screenshot({ path: 'release/portrait-failure.png' });
  throw error;
} finally {
  await app.close();
  await fs.rm(profile, { recursive: true, force: true });
}
