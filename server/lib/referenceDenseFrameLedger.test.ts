import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import ffmpeg from 'ffmpeg-static';
import { readReferenceDenseFrameLedger } from './referenceDenseFrameLedger.js';

const exec = promisify(execFile);

test('read-only framehash ledger binds real decoded frames to source bytes and timing without semantic claims', async () => {
  assert.ok(ffmpeg);
  const directory = await mkdtemp(path.join(os.tmpdir(), 'reference-frame-ledger-'));
  const sourcePath = path.join(directory, 'source.mp4');
  try {
    await exec(ffmpeg!, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=32x32:rate=10:duration=1',
      '-c:v', 'libx264', '-y', sourcePath]);
    const expectedSourceSha256 = createHash('sha256').update(await readFile(sourcePath)).digest('hex');
    const input = { sourcePath, expectedSourceSha256, sourceTenantId: 'old-tenant', sourceVideoId: 'reference-video',
      windows: [{ shotId: 'one', startSeconds: 0, endSeconds: .5 }, { shotId: 'two', startSeconds: .5, endSeconds: 1 }] };
    const first = await readReferenceDenseFrameLedger(input);
    const again = await readReferenceDenseFrameLedger(input);
    assert.deepEqual(first, again);
    assert.equal(first.purpose, 'reference_structure_only');
    assert.equal(first.semanticStatus, 'unobserved');
    assert.equal(first.frames.length, 10);
    assert.deepEqual(first.windows.map(window => window.frameCount), [5, 5]);
    assert.ok(first.windows.every(window => window.denseAtHalfSecond));
    assert.ok(first.frames.every(frame => /^[a-f0-9]{64}$/.test(frame.decodedSha256)));
    await assert.rejects(() => readReferenceDenseFrameLedger({ ...input, expectedSourceSha256: '0'.repeat(64) }),
      /source_hash_mismatch/);
    await assert.rejects(() => readReferenceDenseFrameLedger({ ...input, windows: [
      input.windows[0]!, { shotId: 'two', startSeconds: .6, endSeconds: 1 },
    ] }), /windows_noncontiguous/);
    await assert.rejects(() => readReferenceDenseFrameLedger({ ...input, windows: [
      { shotId: 'one', startSeconds: 0, endSeconds: .5 },
    ] }), /windows_incomplete/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
