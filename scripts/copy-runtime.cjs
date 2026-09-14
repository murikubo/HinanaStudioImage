const fs = require('node:fs');
for (const file of ['raw-worker.mjs', 'raw-exif.mjs'])
  fs.copyFileSync(`electron/${file}`, `dist-electron/${file}`);
fs.mkdirSync('dist/licenses', { recursive: true });
for (const file of ['COPYRIGHT', 'LICENSE.CDDL', 'LICENSE.LGPL'])
  fs.copyFileSync(
    `node_modules/@colorhythm/libraw-wasm/LibRaw/${file}`,
    `dist/licenses/LibRaw-${file}`,
  );
fs.copyFileSync('THIRD_PARTY_NOTICES.md', 'dist/licenses/THIRD_PARTY_NOTICES.md');

fs.copyFileSync(
  'node_modules/@colorhythm/libraw-wasm/LICENSE',
  'dist/licenses/libraw-wasm-MIT.txt',
);
