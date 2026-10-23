import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import ffmpegStatic from 'ffmpeg-static';
import { detectVideoSceneCuts, extractOpeningHookFrames, extractQwenAnalysisFrames, sourceFrameTimes, strongestSceneCuts } from './videoFrameExtraction.js';

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
    assert.ok(strategy.every(frame => /^\d+\.\d{6}s$/.test(frame.timeLabel)));

    const exact = await extractQwenAnalysisFrames(videoPath, 12, 6, 'exact', [], 'talking_head_dense', [{ startSeconds: 0, endSeconds: 1 }]);
    assert.ok(exact.length >= 2 && exact.length <= 12);
    assert.ok(exact.some(frame => Number.parseFloat(frame.timeLabel) === 0.5));

    const hook = await extractOpeningHookFrames(videoPath);
    assert.ok(hook.length >= 1 && hook.length <= 12);
    assert.equal(hook[0]?.timeLabel, '0.000000s');

    const cuts = await detectVideoSceneCuts(videoPath);
    assert.ok(cuts.every((cut, index) => Number.isFinite(cut) && cut > 0.2 && (index === 0 || cut - cuts[index - 1]! >= 0.18)));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('strategy sampling preserves an observed first frame for a short clip', { skip: !ffmpegStatic }, async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-short-video-frames-'));
  const videoPath = path.join(tempDir, 'short.mp4');
  try {
    await promisify(execFile)(ffmpegStatic!, [
      '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=2:size=320x240:rate=12',
      '-c:v', 'mpeg4', '-q:v', '5', '-y', videoPath,
    ], { timeout: 30_000 });
    const frames = await extractQwenAnalysisFrames(videoPath, 8, 2, 'strategy');
    assert.ok(frames.length >= 1);
    assert.equal(frames[0]?.timeLabel, '0.000000s');
    assert.equal(frames[0]?.mimeType, 'image/jpeg');
    assert.ok(Buffer.from(frames[0]!.base64, 'base64').length > 100);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('uniform, dense and hook sampling retain the actual first source frame instead of fps midpoint content', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-frame-clock-'));
  const source = path.join(dir, 'source.mp4');
  const run = promisify(execFile);
  try {
    await run(ffmpegStatic!, ['-loglevel', 'error', '-f', 'lavfi', '-i', 'color=red:s=64x64:r=30:d=0.25',
      '-f', 'lavfi', '-i', 'color=blue:s=64x64:r=30:d=5.75', '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]',
      '-map', '[v]', '-c:v', 'libx264', '-y', source]);
    for (const frames of [await extractQwenAnalysisFrames(source, 3, 6, 'strategy'),
      await extractQwenAnalysisFrames(source, 12, 6, 'exact'),
      await extractQwenAnalysisFrames(source, 12, 6, 'exact', [], 'talking_head_dense', [{ startSeconds: 0, endSeconds: 1 }]),
      await extractOpeningHookFrames(source)]) {
      assert.equal(Number.parseFloat(frames[0]!.timeLabel), 0);
      for (const frame of frames) {
        const jpeg = path.join(dir, 'sample.jpg'); fs.writeFileSync(jpeg, Buffer.from(frame.base64, 'base64'));
        const { stdout } = await run(ffmpegStatic!, ['-loglevel', 'error', '-i', jpeg, '-vf', 'scale=1:1',
          '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { encoding: 'buffer' });
        const time = Number.parseFloat(frame.timeLabel);
        assert.equal(stdout[0]! > stdout[2]!, time < 0.266666, `actual color must agree with source PTS ${frame.timeLabel}`);
      }
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('source clock uses integer PTS instead of rounded showinfo seconds', () => {
  const times = sourceFrameTimes('config in time_base: 1/15360, frame_rate: 30/1\nn: 0 pts: 85504 pts_time:5.56667');
  assert.equal(times[0], 85504 / 15360);
  assert.notEqual(times[0], 5.56667);
  assert.throws(() => sourceFrameTimes('n: 0 pts: 85504 pts_time:5.56667'), /source_clock_missing/);
});

test('transition candidates keep the strongest change instead of the premature first motion frame', () => {
  assert.deepEqual(strongestSceneCuts([{ time: 27.133333, score: 0.133873 },
    { time: 27.266667, score: 0.157386 }, { time: 27.3, score: 0.174275 },
    { time: 28.2, score: 0.3 }]), [27.3, 28.2]);
});
