const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
if (process.platform !== 'darwin') {
  console.log('Using the bundled LibRaw WebAssembly decoder on this platform.');
  process.exit(0);
}
fs.mkdirSync('native/bin', { recursive: true });
const result = spawnSync(
  'xcrun',
  [
    'swiftc',
    '-O',
    '-target',
    `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macosx12.0`,
    'native/RawDecoder.swift',
    '-o',
    'native/bin/hinana-raw',
  ],
  { stdio: 'inherit' },
);
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
