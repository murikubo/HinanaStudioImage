// Run NativeImagesCheck.swift first; bridge responses use its real HDR PNG fixture.
// This tests JS/native handoff, not device display brightness or the OS picker UI.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { pngInfo, decodePrecisionPNG } from '../src/precision-codec.ts';

const fixtures = process.argv[2] || '/tmp/hinana-ios-fixtures';
const png = await fs.readFile(`${fixtures}/gain.png`);
const heic = await fs.readFile(`${fixtures}/gain.heic`);
const browser = await chromium.launch({ channel: 'chromium' });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
page.setDefaultTimeout(30000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript(
  ({ png }) => {
    window.webkit = { messageHandlers: { bridge: { postMessage() {} } } };
    window.__nativeCalls = [];
    window.Capacitor = {
      convertFileSrc: (uri) => uri.replace('file://', '/_capacitor_file_'),
      PluginHeaders: [
        {
          name: 'HinanaImages',
          methods: [
            'capabilities',
            'pickImages',
            'releaseImports',
            'decodeImage',
            'selectSubject',
            'cancelSubject',
            'showHDRPreview',
          ].map((name) => ({ name, rtype: 'promise' })),
        },
        {
          name: 'Filesystem',
          methods: ['writeFile', 'getUri'].map((name) => ({ name, rtype: 'promise' })),
        },
        { name: 'Share', methods: [{ name: 'share', rtype: 'promise' }] },
      ],
      nativePromise: async (plugin, method, options) => {
        window.__nativeCalls.push({ plugin, method, options });
        if (method === 'capabilities')
          return { heic: true, raw: true, appleHDR: true, subject: true };
        if (method === 'pickImages')
          return { files: [{ uri: 'file:///cache/gain.heic', name: 'gain.heic' }], failures: [] };
        if (method === 'decodeImage') return { png, hdr: true, peak: 3.9625 };
        if (method === 'getUri') return { uri: 'file:///cache/' + options.path };
        if (method === 'selectSubject') {
          const bytes = atob(options.png);
          const view = new DataView(Uint8Array.from(bytes, (c) => c.charCodeAt(0)).buffer);
          const width = view.getUint32(16),
            height = view.getUint32(20);
          // Stub coverage verifies raster persistence, not recognition accuracy.
          return { width, height, data: btoa(String.fromCharCode(255).repeat(width * height)) };
        }
        return {};
      },
    };
  },
  { png: png.toString('base64') },
);
await page.route('**/_capacitor_file_/**', (route) =>
  route.fulfill({ body: heic, contentType: 'image/heic' }),
);
const idle = () => page.locator('.canvas-holder canvas[aria-busy="false"]').waitFor();
const calls = () => page.evaluate(() => window.__nativeCalls);
async function save() {
  const before = (await calls()).filter((c) => c.method === 'writeFile').length;
  await page.getByTitle('프로젝트 저장 (⌘/Ctrl S)').click();
  await page.waitForFunction(
    (before) => window.__nativeCalls.filter((c) => c.method === 'writeFile').length > before,
    before,
  );
  const write = (await calls()).filter((c) => c.method === 'writeFile').at(-1);
  return JSON.parse(Buffer.from(write.options.data, 'base64').toString('utf8'));
}
try {
  await page.goto('http://127.0.0.1:5173');
  await page.locator('.welcome').getByRole('button', { name: /사진/ }).first().click();
  await page.getByRole('button', { name: '사진 보관함에서 선택' }).click();
  await idle();
  const imported = await calls();
  assert.equal(imported.find((c) => c.method === 'pickImages').options.source, 'photos');
  assert.equal(
    imported.find((c) => c.method === 'decodeImage').options.base64,
    heic.toString('base64'),
  );
  assert.equal(imported.find((c) => c.method === 'decodeImage').options.raw, false);
  assert.deepEqual(imported.find((c) => c.method === 'releaseImports').options.uris, [
    'file:///cache/gain.heic',
  ]);
  let project = await save();
  const a = project.photos[0].adjustments;
  assert.equal(a.precision, 'float');
  assert.equal(a.dynamicRange, 'hdr');
  assert.equal(a.hdrPeak, 1000);
  assert.equal(a.hdrHighlights, 0);
  const source = Buffer.from(project.photos[0].src.split(',')[1], 'base64');
  assert.equal(pngInfo(source).depth, 16);
  assert.ok(decodePrecisionPNG(source).data[0] > 3.8);
  await page
    .getByLabel('모바일 작업 도구')
    .getByRole('button', { name: '편집', exact: true })
    .click();
  await page.getByLabel('노출', { exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(350);
  await idle();
  await page.getByRole('button', { name: 'HDR 화면 보기 · iPhone' }).click();
  await page.waitForFunction(() => window.__nativeCalls.some((c) => c.method === 'showHDRPreview'));
  const preview = Buffer.from(
    (await calls()).find((c) => c.method === 'showHDRPreview').options.png,
    'base64',
  );
  assert.ok(pngInfo(preview).hdr);
  assert.ok(
    decodePrecisionPNG(preview).data[0] > 4.3,
    `Native preview must include exposure edits (actual ${decodePrecisionPNG(preview).data[0]})`,
  );
  await page.getByRole('button', { name: '◉ 마스크', exact: true }).click();
  if (!(await page.getByRole('button', { name: '피사체 마스크', exact: true }).count()))
    await page.getByRole('button', { name: '새 마스크 만들기', exact: true }).click();
  await page.getByRole('button', { name: '피사체 마스크', exact: true }).click();
  const box = await page.getByLabel('마스크 그리기 영역').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForFunction(() => window.__nativeCalls.some((c) => c.method === 'selectSubject'));
  await idle();
  project = await save();
  assert.equal(project.photos[0].adjustments.masks[0].kind, 'subject');
  assert.ok(project.photos[0].adjustments.masks[0].raster.data.length > 0);
  // Mock only the RAW codec response; verify original bytes survive import and redevelop.
  const raw = Buffer.from('RAW bridge transport fixture');
  await page
    .locator('input[multiple]')
    .setInputFiles({ name: 'fixture.dng', mimeType: 'image/x-adobe-dng', buffer: raw });
  await idle();
  project = await save();
  const rawPhoto = project.photos.find((p) => p.name === 'fixture.dng');
  assert.equal(
    rawPhoto.rawSource,
    `data:application/octet-stream;base64,${raw.toString('base64')}`,
  );
  const rawDecode = (await calls()).filter((c) => c.method === 'decodeImage').at(-1);
  assert.equal(rawDecode.options.raw, true);
  assert.equal(rawDecode.options.base64, raw.toString('base64'));
  await page.getByRole('button', { name: '편집', exact: true }).last().click();
  await page.getByRole('button', { name: 'RAW 원본에서 16비트 P3 다시 현상' }).click();
  await page.waitForFunction(
    () => window.__nativeCalls.filter((c) => c.method === 'decodeImage').length === 3,
  );
  await idle();
  assert.deepEqual(errors, []);
  console.log(
    'PASS iOS bridge: original HEIC, HDR auto mode, 16-bit project, HDR native preview and subject raster',
  );
} finally {
  await browser.close();
}
