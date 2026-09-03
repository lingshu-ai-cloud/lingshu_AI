import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dataVolumeHealthCheck } from './dataVolumeHealth.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-data-health-'));
try {
  assert.equal((await dataVolumeHealthCheck({ root, minimumFreeBytes: 0 })).ok, true);
  assert.equal(fs.readdirSync(root).some(name => name.startsWith('.readyz-')), false, 'canary files must be cleaned');
  const impossible = await dataVolumeHealthCheck({ root, minimumFreeBytes: Number.MAX_SAFE_INTEGER });
  assert.equal(impossible.ok, false);
  assert.equal(impossible.message, 'app_data_free_space_low');
  const file = path.join(root, 'not-a-directory');
  fs.writeFileSync(file, 'x');
  assert.equal((await dataVolumeHealthCheck({ root: file, minimumFreeBytes: 0 })).ok, false);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('application data volume write, fsync, rename, cleanup, and free-space checks passed');
