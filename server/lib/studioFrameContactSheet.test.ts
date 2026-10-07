import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { buildStudioFrameContactSheet, extractStudioContactFrames, selectStudioFrameSamples } from './studioFrameContactSheet.js';

test('samples three positions per shot and caps one contact sheet at 18 frames', () => {
  const shots = Array.from({ length: 8 }, (_, index) => ({ id: `shot-${index + 1}`, startMs: index * 1_000,
    endMs: (index + 1) * 1_000, confidence: .9, source: 'ffmpeg_scene' as const }));
  const samples = selectStudioFrameSamples({ shotWindows: shots, eventTimesMs: [7_500] });
  assert.equal(samples.length, 18);
  assert.ok(samples.some(sample => sample.shotId === 'shot-8'));
  assert.deepEqual(selectStudioFrameSamples({ shotWindows: shots.slice(0, 1) }).map(item => item.timeMs), [200, 500, 800]);
});

test('builds a labeled JPEG grid with stable dimensions and manifest cells', async () => {
  const red = await sharp({ create: { width: 320, height: 180, channels: 3, background: '#cc2233' } }).jpeg().toBuffer();
  const blue = await sharp({ create: { width: 180, height: 320, channels: 3, background: '#2255cc' } }).png().toBuffer();
  const sheet = await buildStudioFrameContactSheet([
    { shotId: 'shot-1', timeMs: 200, bytes: red }, { shotId: 'shot-1', timeMs: 500, bytes: red },
    { shotId: 'shot-2', timeMs: 1_200, bytes: blue }, { shotId: 'shot-2', timeMs: 1_500, bytes: blue },
  ]);
  assert.ok(sheet);
  assert.equal(sheet?.width, 768);
  assert.equal(sheet?.height, 344);
  assert.equal(sheet?.frames.length, 4);
  const metadata = await sharp(sheet!.bytes).metadata();
  assert.equal(metadata.format, 'jpeg');
  assert.equal(metadata.width, 768);
  assert.equal(metadata.height, 344);
});

test('returns null when no frames could be extracted', async () => {
  assert.equal(await buildStudioFrameContactSheet([]), null);
});

test('frame extraction is partial and non-blocking when FFmpeg misses a sample', async () => {
  let calls = 0;
  const jpeg = await sharp({ create: { width: 256, height: 144, channels: 3, background: '#444' } }).jpeg().toBuffer();
  const frames = await extractStudioContactFrames({ sourcePath: '/tmp/source.mp4',
    samples: [{ shotId: 'shot-1', timeMs: 200 }, { shotId: 'shot-1', timeMs: 500 }],
    execute: async (_file, args) => { calls += 1; assert.ok(args.includes('scale=256:-2:flags=lanczos')); if (calls === 1) throw new Error('bad frame'); return { stdout: jpeg }; } });
  assert.equal(frames.length, 1);
  assert.equal(frames[0]?.timeMs, 500);
});
