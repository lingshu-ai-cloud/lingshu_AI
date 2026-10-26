import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ffmpeg from 'ffmpeg-static';
import { completeReferenceWindowFrames } from './referenceWindowFrames.js';

test('short chunk-tail window gets an actual in-window frame without borrowing adjacent evidence', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'window-frame-test-'));
  try {
    const filePath = path.join(dir, 'source.mp4');
    await promisify(execFile)(ffmpeg!, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
      'color=c=red:s=64x64:r=30:d=2', '-c:v', 'libx264', filePath]);
    const frames = [{ base64: 'existing', mimeType: 'image/jpeg', timeLabel: '0.1s' }];
    const result = await completeReferenceWindowFrames({ filePath, frames, offset: 1,
      windows: [{ id: 'b1', start: 0, end: 0.766667 }, { id: 'b2', start: 0.766667, end: 1 }] });
    assert.equal(frames.length, 1);
    assert.equal(result.length, 2);
    assert.ok(Number.parseFloat(result[1]!.timeLabel) >= 0.766667);
    assert.ok(Number.parseFloat(result[1]!.timeLabel) < 1);
    assert.notEqual(result[1]!.base64, 'existing');
    await assert.rejects(completeReferenceWindowFrames({ frames, offset: 1, windows: [{ id: 'b2', start: 0.8, end: 1 }] }), /frames_missing_b2/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
