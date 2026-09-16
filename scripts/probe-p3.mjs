import { _electron as electron } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'hinana-p3-probe-'));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ['.', `--user-data-dir=${profile}`], env });
try {
  const page = await app.firstWindow();
  const result = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 2;
    c.height = 1;
    const ctx = c.getContext('2d', { colorSpace: 'display-p3' });
    ctx.fillStyle = 'color(display-p3 1 0.3 0)';
    ctx.fillRect(0, 0, 2, 1);
    const out = {
      settings: ctx.getContextAttributes(),
      pixel: [...ctx.getImageData(0, 0, 1, 1, { colorSpace: 'display-p3' }).data],
    };
    for (const mime of ['png', 'jpeg', 'webp']) {
      const blob = await new Promise((r) => c.toBlob(r, 'image/' + mime, 1));
      const src = await new Promise((r) => {
        const f = new FileReader();
        f.onload = () => r(f.result);
        f.readAsDataURL(blob);
      });
      const img = new Image();
      img.src = src;
      await img.decode();
      ctx.clearRect(0, 0, 2, 1);
      ctx.drawImage(img, 0, 0);
      out[mime] = {
        src,
        pixel: [...ctx.getImageData(0, 0, 1, 1, { colorSpace: 'display-p3' }).data],
      };
      ctx.fillStyle = 'color(display-p3 1 0.3 0)';
      ctx.fillRect(0, 0, 2, 1);
    }
    return out;
  });
  for (const type of ['png', 'jpeg', 'webp']) {
    const bytes = Buffer.from(result[type].src.split(',')[1], 'base64');
    await fs.writeFile('/tmp/hinana-p3-probe.' + type, bytes);
    delete result[type].src;
    console.log(type, bytes.length, bytes.includes(Buffer.from('ICC')));
  }
  const png = await fs.readFile('/tmp/hinana-p3-probe.png');
  for (let at = 8; at < png.length;) {
    const len = png.readUInt32BE(at);
    if (png.toString('ascii', at + 4, at + 8) === 'iCCP') {
      const data = png.subarray(at + 8, at + 8 + len);
      const start = data.indexOf(0) + 2;
      const icc = inflateSync(data.subarray(start));
      await fs.mkdir('public/profiles', { recursive: true });
      await fs.writeFile('public/profiles/display-p3.icc', icc);
      console.log('ICC', icc.length, icc.subarray(0, 100).toString('hex'));
    }
    at += len + 12;
  }
  console.log(result);
} finally {
  await app.close();
  await fs.rm(profile, { recursive: true, force: true });
}
