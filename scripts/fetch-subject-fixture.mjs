import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const response = await fetch(
  'https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/fbe92bd97d48f3ec17779d8d8f2964e1c6bc7634/corgi.jpg',
  { signal: AbortSignal.timeout(60000) },
);
if (!response.ok) throw Error(`Fixture download failed: ${response.status}`);
const bytes = Buffer.from(await response.arrayBuffer());
if (
  createHash('sha256').update(bytes).digest('hex') !==
  '385413e29523ac6b777f8f23bcf72696119f9bfa364792036fc008700a1f6811'
)
  throw Error('Fixture checksum mismatch');
await writeFile(process.argv[2] || '/tmp/hinana-subject.jpg', bytes);
