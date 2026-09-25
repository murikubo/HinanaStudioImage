import { _electron as electron } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hinana-launch-'));
const file = path.join(root, '한글 project.HINANAIMAGE');
const src =
  'data:image/jpeg;base64,' + (await fs.readFile('public/samples/alpine.jpg')).toString('base64');
await fs.writeFile(
  file,
  JSON.stringify({
    version: 5,
    selected: 'one',
    photos: [
      {
        id: 'one',
        name: 'OS launch fixture',
        src,
        width: 1,
        height: 1,
        adjustments: { exposure: 0.7 },
        rating: 4,
      },
    ],
  }),
);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.env.HINANA_TEST_APP;
const app = await electron.launch({
  ...(executablePath ? { executablePath } : {}),
  args: [...(executablePath ? [] : ['.']), `--user-data-dir=${root}/profile`, file],
  env,
});
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  await page.getByText('OS launch fixture', { exact: true }).first().waitFor();
  assert.equal(await page.getByLabel('노출', { exact: true }).inputValue(), '0.7');
  await fs.writeFile(
    file,
    JSON.stringify({
      version: 5,
      selected: 'two',
      photos: [
        {
          id: 'two',
          name: 'Second launch fixture',
          src,
          width: 1,
          height: 1,
          adjustments: { exposure: -0.4 },
        },
      ],
    }),
  );
  page.once('dialog', (d) => d.dismiss());
  await app.evaluate(
    ({ app }, file) => app.emit('second-instance', {}, ['hinana.exe', file], process.cwd()),
    file,
  );
  await page.waitForTimeout(800);
  assert.equal(await page.getByLabel('노출', { exact: true }).inputValue(), '0.7');
  page.once('dialog', (d) => d.accept());
  await app.evaluate(
    ({ app }, file) => app.emit('second-instance', {}, ['hinana.exe', file], process.cwd()),
    file,
  );
  await page.getByText('Second launch fixture', { exact: true }).first().waitFor();
  assert.equal(await page.getByLabel('노출', { exact: true }).inputValue(), '-0.4');
  await fs.writeFile(file, 'invalid JSON');
  await app.evaluate(
    ({ app }, file) => app.emit('second-instance', {}, ['hinana.exe', file], process.cwd()),
    file,
  );
  await page.getByText(/프로젝트 열기 실패/).waitFor();
  assert.equal(await page.getByLabel('노출', { exact: true }).inputValue(), '-0.4');
  console.log(
    'PASS: OS project launch, Unicode/spaces, existing-instance delivery, cancel/accept replacement, invalid project preserves workspace',
  );
} finally {
  await app.close();
  await fs.rm(root, { recursive: true, force: true });
}
