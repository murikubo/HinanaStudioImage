const fs = require('node:fs');
for (const file of ['raw-worker.mjs', 'raw-exif.mjs', 'subject-worker.mjs'])
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

for (const name of ['fast-png', 'fflate', 'iobuffer'])
  fs.copyFileSync(`node_modules/${name}/LICENSE`, `dist/licenses/${name}-MIT.txt`);
fs.copyFileSync('licenses/SlimSAM-Apache-2.0.txt', 'dist/licenses/SlimSAM-Apache-2.0.txt');
for (const file of ['LICENSE', 'ThirdPartyNotices.txt'])
  if (fs.existsSync(`node_modules/onnxruntime-node/${file}`))
    fs.copyFileSync(`node_modules/onnxruntime-node/${file}`, `dist/licenses/ONNX-${file}`);

for (const file of ['ONNX-Runtime-MIT.txt', 'ONNX-ThirdPartyNotices.txt'])
  fs.copyFileSync(`licenses/${file}`, `dist/licenses/${file}`);
