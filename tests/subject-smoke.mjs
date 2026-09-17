import { _electron as electron } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { decode } from 'fast-png';
import { pngChunks } from '../src/precision-codec.ts';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hinana-subject-'));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.env.HINANA_TEST_APP;
const app = await electron.launch({
  ...(executablePath ? { executablePath } : {}),
  args: [...(executablePath ? [] : ['.']), `--user-data-dir=${root}`],
  env,
});
const page = await app.firstWindow();
page.setDefaultTimeout(120000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await app.evaluate(({ session }, root) => {
  session.defaultSession.on('will-download', (_e, item) =>
    item.setSavePath(root + '/' + item.getFilename()),
  );
}, root);
const idle = () =>
  page.waitForFunction(
    () => document.querySelector('.canvas-holder canvas')?.getAttribute('aria-busy') === 'false',
  );
async function save() {
  const file = path.join(root, 'Hinana-Workspace.hinanaimage');
  await fs.rm(file, { force: true });
  await page.getByTitle('프로젝트 저장 (⌘/Ctrl S)').click();
  for (let i = 0; i < 300; i++) {
    try {
      return JSON.parse(await fs.readFile(file, 'utf8'));
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error('Project not saved');
}
const sample = () =>
  page.locator('.canvas-holder canvas').evaluate((c) => {
    const ctx = c.getContext('2d');
    return {
      dog: Array.from(
        ctx.getImageData(Math.round(c.width * 0.64), Math.round(c.height * 0.6), 1, 1).data,
      ),
      grass: Array.from(
        ctx.getImageData(Math.round(c.width * 0.1), Math.round(c.height * 0.8), 1, 1).data,
      ),
    };
  });
try {
  await page.waitForSelector('.welcome');
  // No runtime network is needed, including first recognition.
  await app.evaluate(({ session }) =>
    session.defaultSession.webRequest.onBeforeRequest(
      { urls: ['http://*/*', 'https://*/*'] },
      (_d, callback) => callback({ cancel: true }),
    ),
  );
  await page.locator('input[multiple]').setInputFiles(process.argv[2] || '/tmp/hinana-subject.jpg');
  await idle();
  const before = await sample();
  await page.getByRole('button', { name: '◉ 마스크', exact: true }).click();
  await page.getByRole('button', { name: '피사체 선택', exact: true }).click();
  let box = await page.getByLabel('마스크 그리기 영역').boundingBox();
  const click = async (x, y) => {
    box = await page.getByLabel('마스크 그리기 영역').boundingBox();
    await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
    await page.getByText('피사체 인식 중…', { exact: false }).waitFor();
    await page.getByText('피사체 인식 중…', { exact: false }).waitFor({ state: 'hidden' });
    await idle();
  };
  // Cancel a cold encoder request, then retry. Cancellation must leave no partial mask.
  await page.mouse.click(box.x + box.width * 0.64, box.y + box.height * 0.6);
  await page.getByRole('button', { name: '인식 취소', exact: true }).click();
  await page.getByText('피사체 인식 중…', { exact: false }).waitFor({ state: 'hidden' });
  let cancelled = await save();
  assert.equal(cancelled.photos[0].adjustments.masks[0].points.length, 0);
  assert.equal(cancelled.photos[0].adjustments.masks[0].raster, undefined);
  const start = Date.now();
  await click(0.64, 0.6);
  console.log('First recognition ms:', Date.now() - start);
  let project = await save();
  assert.equal(project.version, 5);
  assert.deepEqual(
    project.photos[0].history,
    [],
    'Export must not duplicate mask rasters in undo history',
  );
  const mask = project.photos[0].adjustments.masks[0];
  assert.equal(mask.kind, 'subject');
  assert.equal(mask.points.length, 1);
  const raster = mask.raster,
    bytes = Buffer.from(raster.data, 'base64');
  const coverage = (x, y) =>
    bytes[Math.floor(y * raster.height) * raster.width + Math.floor(x * raster.width)];
  assert.equal(coverage(0.64, 0.6), 255);
  assert.equal(coverage(0.1, 0.8), 0);
  const count = bytes.reduce((s, v) => s + (v > 0 ? 1 : 0), 0) / bytes.length;
  assert.ok(count > 0.03 && count < 0.5, `Unexpected selected area ${count}`);
  assert.deepEqual(await sample(), before, 'Selection alone must not edit pixels');
  await page.getByLabel('로컬 노출', { exact: true }).fill('1');
  await page.getByLabel('로컬 노출', { exact: true }).press('ArrowRight');
  await idle();
  const edited = await sample();
  assert.ok(edited.dog[0] > before.dog[0]);
  assert.deepEqual(edited.grass, before.grass);
  await page.getByRole('button', { name: '선택에서 제외', exact: true }).click();
  const next = Date.now();
  await click(0.43, 0.51);
  console.log('Refinement ms:', Date.now() - next);
  project = await save();
  assert.equal(project.photos[0].adjustments.masks[0].points[1].exclude, true);
  assert.notEqual(project.photos[0].adjustments.masks[0].raster.data, raster.data);
  await page.getByTitle('실행 취소 (⌘/Ctrl Z)').click();
  await idle();
  assert.deepEqual(await sample(), edited);
  await page.getByTitle('다시 실행 (⌘/Ctrl Shift Z)').click();
  await idle();
  const aiOnly = await sample();
  await page.getByRole('button', { name: '브러시로 더하기', exact: true }).click();
  await page.getByLabel('브러시 반경', { exact: true }).fill('0.05');
  await page.getByLabel('브러시 반경', { exact: true }).press('ArrowRight');
  await page.getByLabel('브러시 경계 부드러움', { exact: true }).fill('0');
  await page.getByLabel('브러시 경계 부드러움', { exact: true }).press('Home');
  async function stroke(x, y, cancel = false) {
    box = await page.getByLabel('마스크 그리기 영역').boundingBox();
    await page.mouse.move(box.x + box.width * (x - 0.01), box.y + box.height * y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * (x + 0.01), box.y + box.height * y, { steps: 4 });
    if (cancel) await page.keyboard.press('Escape');
    await page.mouse.up();
    await idle();
  }
  await stroke(0.1, 0.8);
  const added = await sample();
  assert.ok(added.grass[0] > before.grass[0]);
  assert.deepEqual(added.dog, aiOnly.dog);
  await page.getByRole('button', { name: '브러시로 지우기', exact: true }).click();
  await stroke(0.64, 0.6);
  const erased = await sample();
  assert.deepEqual(erased.dog, before.dog);
  assert.deepEqual(erased.grass, added.grass);
  await page.getByTitle('실행 취소 (⌘/Ctrl Z)').click();
  await idle();
  assert.deepEqual(await sample(), added);
  await page.getByTitle('다시 실행 (⌘/Ctrl Shift Z)').click();
  await idle();
  assert.deepEqual(await sample(), erased);
  await stroke(0.1, 0.8, true);
  assert.deepEqual(await sample(), erased);
  const manualMask = (await save()).photos[0].adjustments.masks[0];
  assert.equal(manualMask.strokes.length, 2);
  assert.equal(manualMask.strokes[0].erase, false);
  assert.equal(manualMask.strokes[1].erase, true);
  await page.getByRole('button', { name: '수동 수정 초기화', exact: true }).click();
  await idle();
  assert.deepEqual(await sample(), aiOnly);
  await page.getByTitle('실행 취소 (⌘/Ctrl Z)').click();
  await idle();
  assert.deepEqual(await sample(), erased);
  await page.getByRole('button', { name: '선택에 추가', exact: true }).click();
  await click(0.48, 0.62);
  project = await save();
  assert.deepEqual(project.photos[0].adjustments.masks[0].strokes, manualMask.strokes);
  assert.deepEqual(await sample(), erased);
  assert.equal(project.photos[0].adjustments.masks[0].points.length, 3);
  assert.equal(project.photos[0].adjustments.masks[0].points[2].exclude, false);
  const finalPixels = await sample();
  await page.screenshot({ path: 'docs/subject-mask.png' });
  await page.waitForFunction(() =>
    document.querySelector('.save-status')?.textContent.includes('이 기기에 저장됨'),
  );
  await page.reload();
  await idle();
  assert.deepEqual(await sample(), finalPixels);
  page.on('dialog', (d) => d.accept());
  await page
    .getByTestId('project-file-input')
    .setInputFiles(path.join(root, 'Hinana-Workspace.hinanaimage'));
  await page.waitForTimeout(300);
  await idle();
  assert.deepEqual(await sample(), finalPixels);
  const loaded = await save();
  assert.deepEqual(loaded.photos[0].adjustments.masks, project.photos[0].adjustments.masks);
  await page.getByRole('button', { name: '편집', exact: true }).click();
  await page.getByLabel('밝기 범위', { exact: true }).selectOption('hdr');
  await idle();
  await page.getByRole('button', { name: '내보내기', exact: true }).click();
  await page.getByLabel('파일 형식', { exact: true }).selectOption('hdr-png');
  await page.getByRole('button', { name: '이미지 저장', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  const exportName =
    (process.argv[2] || '/tmp/hinana-subject.jpg')
      .split(/[\\/]/)
      .pop()
      .replace(/\.[^.]+$/, '') + '-edited.png';
  let output;
  for (let i = 0; i < 300; i++) {
    try {
      output = decode(await fs.readFile(path.join(root, exportName)));
      break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.deepEqual(
    [...pngChunks(await fs.readFile(path.join(root, exportName))).get('cICP')],
    [9, 16, 0, 1],
  );
  assert.equal(output?.depth, 16);
  assert.equal(output.width, 614);
  assert.equal(output.height, 410);
  // Cancellation during a warmed request must never change the persisted previous raster.
  await page.getByRole('button', { name: '◉ 마스크', exact: true }).click();
  const savedMask = loaded.photos[0].adjustments.masks[0];
  await page.mouse.click(box.x + box.width * 0.7, box.y + box.height * 0.6);
  await page.getByRole('button', { name: '인식 취소', exact: true }).click();
  await page.getByText('피사체 인식 중…', { exact: false }).waitFor({ state: 'hidden' });
  assert.deepEqual((await save()).photos[0].adjustments.masks[0], savedMask);
  // Reimport actual 16-bit PQ output: inference uses an SDR proxy, editing stays HDR/float.
  await page.locator('input[multiple]').setInputFiles(path.join(root, exportName));
  await idle();
  await page.getByRole('button', { name: '피사체 선택', exact: true }).click();
  await click(0.64, 0.6);
  const hdrProject = await save();
  const hdrPhoto = hdrProject.photos.find((p) => p.id === hdrProject.selected);
  assert.equal(hdrPhoto.adjustments.precision, 'float');
  assert.equal(hdrPhoto.adjustments.dynamicRange, 'hdr');
  assert.equal(hdrPhoto.adjustments.masks[0].kind, 'subject');
  assert.ok(hdrPhoto.adjustments.masks[0].raster.data.length > 1000);
  // Main-process validation rejects malformed inputs before model allocation.
  assert.ok(
    await page.evaluate(async () => {
      try {
        await window.hinana.selectSubject({
          rgba: new Uint8ClampedArray(4),
          width: 1,
          height: 1,
          points: [],
        });
        return false;
      } catch {
        return true;
      }
    }),
  );
} finally {
  await app.close();
}
assert.deepEqual(errors, []);
console.log(
  'PASS: offline subject recognition, refinement, local exposure, cancellation, undo/redo, manual add/erase strokes, history/cancel/reset, project/autosave, HDR export and input',
);
