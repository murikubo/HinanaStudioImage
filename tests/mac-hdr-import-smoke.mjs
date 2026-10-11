import { _electron as electron } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { decodePrecisionPNG } from '../src/precision-codec.ts';
if (process.platform !== 'darwin') {
  console.log('SKIP: macOS gainmap decoder');
  process.exit(0);
}
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hinana-mac-gainmap-'));
const swift = path.join(root, 'fixture.swift');
await fs.writeFile(
  swift,
  `import Foundation
import CoreImage
let values=Array(repeating:[Float(4),Float(2),Float(1),Float(1)],count:24*32).flatMap{$0}
let bytes=values.withUnsafeBytes{Data($0)}
let space=CGColorSpace(name:CGColorSpace.extendedLinearDisplayP3)!
let image=CIImage(bitmapData:bytes,bytesPerRow:24*16,size:CGSize(width:24,height:32),format:.RGBAf,colorSpace:space).settingContentHeadroom(4)
let base=CIImage(color:CIColor(red:0.8,green:0.6,blue:0.4)).cropped(to:image.extent)
let context=CIContext(options:[.workingColorSpace:space,.workingFormat:CIFormat.RGBAf])
try context.writeJPEGRepresentation(of:base,to:URL(fileURLWithPath:CommandLine.arguments[1]),colorSpace:CGColorSpace(name:CGColorSpace.displayP3)!,options:[.hdrImage:image,.hdrGainMapAsRGB:true])
let decoded=CIImage(contentsOf:URL(fileURLWithPath:CommandLine.arguments[1]),options:[.expandToHDR:true])!
var sample=[Float](repeating:0,count:4)
context.render(decoded,toBitmap:&sample,rowBytes:16,bounds:CGRect(x:12,y:16,width:1,height:1),format:.RGBAf,colorSpace:space)
print(String(data:try JSONSerialization.data(withJSONObject:Array(sample.prefix(3))),encoding:.utf8)!)
`,
);
const fixture = path.join(root, 'gainmap.jpg');
const reference = JSON.parse(
  execFileSync('xcrun', ['swift', swift, fixture], { encoding: 'utf8' }),
);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.env.HINANA_TEST_APP;
const app = await electron.launch({
  ...(executablePath ? { executablePath } : {}),
  args: [...(executablePath ? [] : ['.']), `--user-data-dir=${root}`],
  env,
});
try {
  const page = await app.firstWindow();
  page.on('dialog', (dialog) => dialog.accept());
  page.setDefaultTimeout(60000);
  await app.evaluate(
    ({ session }, folder) =>
      session.defaultSession.on('will-download', (_e, item) =>
        item.setSavePath(folder + '/' + item.getFilename()),
      ),
    root,
  );
  await page.waitForSelector('.welcome');
  await page.locator('input[multiple]').setInputFiles(fixture);
  await page.waitForFunction(() => document.querySelector('.canvas-holder canvas')?.width === 24);
  assert.equal(await page.getByLabel('밝기 범위', { exact: true }).inputValue(), 'hdr');
  async function file(name) {
    for (let i = 0; i < 400; i++) {
      try {
        return await fs.readFile(path.join(root, name));
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    throw Error('Missing ' + name);
  }
  async function exported() {
    await page.getByRole('button', { name: '내보내기', exact: true }).click();
    await page.getByLabel('파일 형식', { exact: true }).selectOption('hdr-png');
    await page.getByRole('button', { name: '이미지 저장', exact: true }).click();
    const bytes = await file('gainmap-edited.png');
    await fs.unlink(path.join(root, 'gainmap-edited.png'));
    const frame = decodePrecisionPNG(bytes);
    const i = (16 * 24 + 12) * 4;
    assert.ok(frame.data[i] > 3.5 && frame.data[i] < 4.4, 'HDR red retained: ' + frame.data[i]);
    for (let c = 0; c < 3; c++)
      assert.ok(
        Math.abs(frame.data[i + c] - reference[c]) < 0.05,
        `HDR channel ${c}: ${frame.data[i + c]} expected ${reference[c]}`,
      );
  }
  await exported();
  await page.getByTitle('프로젝트 저장 (⌘/Ctrl S)').click();
  const project = JSON.parse((await file('Hinana-Workspace.hinanaimage')).toString());
  project.photos[0].src =
    'data:image/jpeg;base64,' + (await fs.readFile(fixture)).toString('base64');
  delete project.photos[0].nativePreview;
  const legacy = path.join(root, 'legacy-hdr.hinanaimage');
  await fs.writeFile(legacy, JSON.stringify(project));
  await page.locator('input[accept=".hinanaimage,.hinana"]').setInputFiles(legacy);
  await page.getByText('프로젝트를 열었습니다.', { exact: true }).waitFor();
  await exported();
  console.log(
    'PASS: native JPEG gainmap import, automatic HDR mode and PQ export retain extended values',
  );
} finally {
  await app.close();
  await fs.rm(root, { recursive: true, force: true });
}
