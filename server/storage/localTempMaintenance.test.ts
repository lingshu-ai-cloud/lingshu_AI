import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { sweepStaleTemporaryDirectories } from './localTempMaintenance.js';

test('temporary maintenance removes only stale allowlisted directories', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'storage-sweep-test-'));
  const now = Date.now();
  const old = path.join(root, 'lingshu-material-upload-old');
  const recent = path.join(root, 'lingshu-material-upload-recent');
  const unrelated = path.join(root, 'customer-export-old');
  try {
    await Promise.all([fs.mkdir(old), fs.mkdir(recent), fs.mkdir(unrelated)]);
    await fs.writeFile(path.join(old, 'video.mp4'), 'old');
    await fs.utimes(old, new Date(now - 48 * 60 * 60_000), new Date(now - 48 * 60 * 60_000));
    const dryRun = await sweepStaleTemporaryDirectories({ root, now, retentionMs: 24 * 60 * 60_000, apply: false });
    assert.deepEqual(dryRun.removed, ['lingshu-material-upload-old']);
    assert.equal(await fs.stat(old).then(() => true), true);
    const applied = await sweepStaleTemporaryDirectories({ root, now, retentionMs: 24 * 60 * 60_000 });
    assert.deepEqual(applied.removed, ['lingshu-material-upload-old']);
    await assert.rejects(fs.stat(old), { code: 'ENOENT' });
    assert.equal(await fs.stat(recent).then(() => true), true);
    assert.equal(await fs.stat(unrelated).then(() => true), true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
