import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
export const revision = '5850ab45f587c112167512ffef949107115e26a0';
const files = {
  'vision_encoder_quantized.onnx':
    'cce23c7b2e5d4f330932738fb67ba518e04b0d99ccdd1cccd22a7da4e01f2971',
  'prompt_encoder_mask_decoder_quantized.onnx':
    'cb90b279f549d2cab7fd6e20c38522438c65d84bdcca3d2a764cff7d857fdce2',
};
const hash = (b) => createHash('sha256').update(b).digest('hex');
await mkdir('models/slimsam', { recursive: true });
for (const [name, expected] of Object.entries(files)) {
  const file = `models/slimsam/${name}`;
  try {
    if (hash(await readFile(file)) === expected) continue;
  } catch {}
  const response = await fetch(
    `https://huggingface.co/Xenova/slimsam-77-uniform/resolve/${revision}/onnx/${name}`,
    { signal: AbortSignal.timeout(120000) },
  );
  if (!response.ok) throw Error(`Model download failed: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (hash(bytes) !== expected) throw Error(`Model checksum mismatch: ${name}`);
  await writeFile(`${file}.tmp`, bytes);
  await rename(`${file}.tmp`, file);
}
console.log('Pinned SlimSAM models verified.');
