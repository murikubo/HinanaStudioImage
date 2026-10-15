import { mkdir, readFile, writeFile, rename, copyFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const files = {
  'face_landmarker.task': [
    'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
    '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff',
  ],
  'pose_landmarker_lite.task': [
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
    '59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a',
  ],
};
const hash = (b) => createHash('sha256').update(b).digest('hex');
await mkdir('models/portrait', { recursive: true });
await mkdir('public/portrait/wasm', { recursive: true });
for (const [name, [url, expected]] of Object.entries(files)) {
  const file = `models/portrait/${name}`;
  let valid = false;
  try {
    valid = hash(await readFile(file)) === expected;
  } catch {}
  if (!valid) {
    const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw Error(`Portrait model download: ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (hash(bytes) !== expected) throw Error(`Portrait model checksum: ${name}`);
    await writeFile(`${file}.tmp`, bytes);
    await rename(`${file}.tmp`, file);
  }
  await copyFile(file, `public/portrait/${name}`);
}
for (const name of await readdir('node_modules/@mediapipe/tasks-vision/wasm'))
  if (/\.(js|wasm)$/.test(name))
    await copyFile(
      `node_modules/@mediapipe/tasks-vision/wasm/${name}`,
      `public/portrait/wasm/${name}`,
    );
await copyFile('licenses/MediaPipe-Apache-2.0.txt', 'public/portrait/LICENSE.txt');
console.log('Pinned local portrait models and WASM prepared.');
