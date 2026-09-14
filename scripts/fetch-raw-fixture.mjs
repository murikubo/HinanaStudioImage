import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
// Public NASA test photo used by rawpy; pinned source and checksum. Never bundled.
const url =
  'https://raw.githubusercontent.com/letmaik/rawpy/a39c2e7a44911889c3360891012f862f904ba551/test/iss030e122639.NEF';
const response = await fetch(url);
if (!response.ok) throw new Error(`RAW fixture download: ${response.status}`);
const data = Buffer.from(await response.arrayBuffer());
if (
  createHash('sha256').update(data).digest('hex') !==
  '5922721d13f11795557d97fdeb0a60b900086c402bc82a848ff280d15b99ffd4'
)
  throw new Error('RAW fixture checksum mismatch');
const target = process.argv[2];
if (!target) throw new Error('Specify a temporary output path');
await fs.mkdir(path.dirname(target), { recursive: true });
await fs.writeFile(target, data);
