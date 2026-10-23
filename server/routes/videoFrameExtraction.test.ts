import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import ffmpegStatic from 'ffmpeg-static';
import { detectVideoSceneCuts, extractOpeningHookFrames, extractQwenAnalysisFrames } from './videoFrameExtraction.js';

test('local video frame extraction preserves source-clock labels and presenter density', { skip: !ffmpegStatic }, async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-video-frames-'));
  const videoPath = path.join(tempDir, 'source.mp4');
  try {
    await promisify(execFile)(ffmpegStatic!, [
      '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=6:size=320x240:rate=12',
      '-c:v', 'mpeg4', '-q:v', '5', '-y', videoPath,
    ], { timeout: 30_000 });

    const strategy = await extractQwenAnalysisFrames(videoPath, 8, 6, 'strategy');
    assert.ok(strategy.length >= 1 && strategy.length <= 8);
    assert.ok(strategy.every(frame => frame.mimeType === 'image/jpeg' && frame.base64.length > 100));
    assert.ok(strategy.every(frame => /^\d+\.\d{2}s$/.test(frame.timeLabel)));

    const exact = await extractQwenAnalysisFrames(videoPath, 12, 6, 'exact', [], 'talking_head_dense', [{ startSeconds: 0, endSeconds: 1 }]);
    assert.ok(exact.length >= 2 && exact.length <= 12);
    assert.ok(exact.some(frame => frame.timeLabel === '0.50s'));

    const hook = await extractOpeningHookFrames(videoPath);
    assert.ok(hook.length >= 1 && hook.length <= 12);
    assert.equal(hook[0]?.timeLabel, '0.000s');

    const cuts = await detectVideoSceneCuts(videoPath);
    assert.ok(cuts.every((cut, index) => Number.isFinite(cut) && cut > 0.2 && (index === 0 || cut - cuts[index - 1]! >= 0.18)));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('strategy sampling falls back to an observed first frame for a short clip', { skip: !ffmpegStatic }, async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-short-video-frames-'));
  const videoPath = path.join(tempDir, 'short.mp4');
  try {
    await promisify(execFile)(ffmpegStatic!, [
      '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=2:size=320x240:rate=12',
      '-c:v', 'mpeg4', '-q:v', '5', '-y', videoPath,
    ], { timeout: 30_000 });
    const frames = await extractQwenAnalysisFrames(videoPath, 8, 2, 'strategy');
    assert.equal(frames.length, 1);
    assert.equal(frames[0]?.timeLabel, '0.00s');
    assert.equal(frames[0]?.mimeType, 'image/jpeg');
    assert.ok(Buffer.from(frames[0]!.base64, 'base64').length > 100);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
