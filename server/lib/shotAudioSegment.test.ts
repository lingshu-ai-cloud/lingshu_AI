import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';
import { materializeShotAudioSegment } from './shotAudioSegment.js';

const run = (file: string, args: string[]) => new Promise<void>((resolve, reject) => execFile(file, args, error => error ? reject(error) : resolve()));

test('shot audio segments are content-addressed, tenant-local and reusable', async () => {
  assert.ok(ffmpegStatic);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shot-audio-segment-'));
  try {
    const source = path.join(root, 'source.wav'); const outputDir = path.join(root, 'tenant-a', 'segments');
    await run(String(ffmpegStatic), ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-ar', '16000', source]);
    const first = await materializeShotAudioSegment({ sourcePath: source, outputDir, start: 0.5, duration: 1.25, ffmpegPath: String(ffmpegStatic) });
    const mtime = fs.statSync(path.join(outputDir, `${first.segmentId}.wav`)).mtimeMs;
    const duplicate = await materializeShotAudioSegment({ sourcePath: source, outputDir, start: 0.5, duration: 1.25, ffmpegPath: String(ffmpegStatic) });
    assert.equal(duplicate.segmentId, first.segmentId); assert.equal(duplicate.checksumSha256, first.checksumSha256);
    assert.equal(fs.statSync(path.join(outputDir, `${first.segmentId}.wav`)).mtimeMs, mtime, 'cached segment is not rendered again');
    const other = await materializeShotAudioSegment({ sourcePath: source, outputDir, start: 1, duration: 1.25, ffmpegPath: String(ffmpegStatic) });
    assert.notEqual(other.segmentId, first.segmentId); assert.ok(first.bytes.length > 44);
    await assert.rejects(materializeShotAudioSegment({ sourcePath: source, outputDir, start: -1, duration: 1, ffmpegPath: String(ffmpegStatic) }), /时间段无效/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
