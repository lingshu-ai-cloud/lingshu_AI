import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileMatchesSha256, sha256File } from './digitalHumanFileIntegrity.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'digital-human-integrity-'));
const file = path.join(dir, 'result.mp4');
try {
  fs.writeFileSync(file, Buffer.from('known-result'));
  const digest = await sha256File(file);
  assert.equal(digest.sizeBytes, 12);
  assert.equal(await fileMatchesSha256(file, digest.sha256, 12), true);
  assert.equal(await fileMatchesSha256(file, digest.sha256, 13), false);
  fs.writeFileSync(file, Buffer.from('tampered'));
  assert.equal(await fileMatchesSha256(file, digest.sha256), false, 'an existing destination must be rehashed before an idempotent acknowledgement');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('digital human file integrity tests passed');
