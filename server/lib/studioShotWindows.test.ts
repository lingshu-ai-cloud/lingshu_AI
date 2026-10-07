import assert from 'node:assert/strict';
import test from 'node:test';
import { detectStudioShotWindows, parseFfmpegSceneCutTimes, shotWindowsFromCuts } from './studioShotWindows.js';

test('parses FFmpeg showinfo cuts and merges cuts closer than 280ms', () => {
  const cuts = parseFfmpegSceneCutTimes('n:1 pts:100 pts_time:1.000\nn:2 pts:125 pts_time:1.250\nn:3 pts:300 pts_time:3.000');
  assert.deepEqual(cuts, [1_000, 1_250, 3_000]);
  assert.deepEqual(shotWindowsFromCuts(cuts, 5_000).map(item => [item.startMs, item.endMs]), [[0, 1_125], [1_125, 3_000], [3_000, 5_000]]);
});

test('uses scene threshold 0.28 and returns detected windows', async () => {
  let args: string[] = [];
  const windows = await detectStudioShotWindows({ sourcePath: '/tmp/source.mp4', durationMs: 4_000,
    execute: async (_file, values) => { args = values; return { stderr: 'n:1 pts_time:1.500' }; } });
  assert.ok(args.includes("select='gt(scene,0.28)',showinfo"));
  assert.deepEqual(windows.map(item => [item.startMs, item.endMs, item.source]), [[0, 1_500, 'ffmpeg_scene'], [1_500, 4_000, 'ffmpeg_scene']]);
});

test('fails closed to storyboard, then a single fallback window', async () => {
  const failed = async () => { throw new Error('decoder unavailable'); };
  const storyboard = await detectStudioShotWindows({ sourcePath: 'bad.mp4', durationMs: 5_000,
    storyboard: [{ targetStart: 0, targetEnd: 2 }, { targetStart: 2, targetEnd: 5 }], execute: failed });
  assert.deepEqual(storyboard.map(item => item.source), ['storyboard', 'storyboard']);
  const fallback = await detectStudioShotWindows({ sourcePath: 'bad.mp4', durationMs: 5_000, execute: failed });
  assert.deepEqual(fallback, [{ id: 'shot-1', startMs: 0, endMs: 5_000, confidence: 0, source: 'fallback' }]);
});
