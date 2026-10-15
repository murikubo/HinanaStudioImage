const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
if (process.platform === 'win32') {
  const path = require('node:path');
  fs.mkdirSync('native/bin', { recursive: true });
  const compiler = path.join(
    process.env.WINDIR || 'C:\\Windows',
    'Microsoft.NET',
    'Framework64',
    'v4.0.30319',
    'csc.exe',
  );
  const result = spawnSync(
    compiler,
    [
      '/nologo',
      '/optimize+',
      '/platform:x64',
      '/target:exe',
      `/out:${path.resolve('native/bin/hinana-gpu.exe')}`,
      path.resolve('native/windows/GpuGeometry.cs'),
    ],
    { stdio: 'inherit' },
  );
  if (result.error) console.error(result.error.message);
  process.exit(result.status ?? 1);
}
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
if (result.status !== 0) process.exit(result.status ?? 1);
const hdr = spawnSync(
  'xcrun',
  [
    'swiftc',
    '-O',
    '-target',
    `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macosx12.0`,
    'native/HDRDecoder.swift',
    'ios/App/App/NativeImageDecoder.swift',
    '-o',
    'native/bin/hinana-hdr',
  ],
  { stdio: 'inherit' },
);
if (hdr.error) console.error(hdr.error.message);
process.exit(hdr.status ?? 1);
