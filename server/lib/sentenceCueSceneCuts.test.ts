import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ffmpegStatic from 'ffmpeg-static';
import { assertPersonCueShotBoundaries, assertSeedanceCueDurations, hardSceneCutTimes } from './sentenceCueSceneCuts.js';

test('a physical cut inside a person cue blocks generation while shot-aligned cues remain valid', async () => {
  assert.ok(ffmpegStatic);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sentence-cue-cuts-'));
  try {
    const source = path.join(root, 'source.mp4');
    execFileSync(String(ffmpegStatic), [
      '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=red:s=160x240:r=25:d=0.5',
      '-f', 'lavfi', '-i', 'color=blue:s=160x240:r=25:d=0.5',
      '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0', '-pix_fmt', 'yuv420p', '-y', source,
    ]);
    const cuts = await hardSceneCutTimes(String(ffmpegStatic), source);
    assert.ok(cuts.some(time => time >= 0.48 && time <= 0.56), `expected the physical cut: ${cuts}`);
    const cue = { id: 'whole-sentence', start: 0, end: 1, originalText: 'Hello', targetText: 'Hi', shotIds: ['s1'], personShot: true };
    assert.throws(() => assertPersonCueShotBoundaries([cue], cuts), /硬切.*未调用供应商/);
    assert.doesNotThrow(() => assertPersonCueShotBoundaries([
      { ...cue, end: 0.52 },
      { ...cue, id: 'next-shot', start: 0.52, end: 1 },
      { ...cue, id: 'factory', personShot: false },
    ], cuts));
    assert.throws(() => assertPersonCueShotBoundaries([{ ...cue, splitFromCueId: cue.id, targetText: '' }], []), /填写本片对应语句/);
    assert.throws(() => assertPersonCueShotBoundaries([{ ...cue, splitFromCueId: cue.id, personShot: undefined }], []), /指定镜头类型/);
    assert.doesNotThrow(() => assertPersonCueShotBoundaries([{ ...cue, splitFromCueId: cue.id, personShot: false, targetText: '' }], []));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('Seedance rejects sub-four-second and over-fifteen-second person cues before billing', () => {
  const cue = { id: 'short', start: 0.1, end: 1, originalText: 'Hi boss', targetText: '你好', shotIds: [], personShot: true };
  assert.throws(() => assertSeedanceCueDurations([cue]), /仅支持 4–15s.*未调用供应商/);
  assert.throws(() => assertSeedanceCueDurations([{ ...cue, end: 16 }]), /仅支持 4–15s.*未调用供应商/);
  assert.doesNotThrow(() => assertSeedanceCueDurations([{ ...cue, end: 4.1 }, { ...cue, personShot: false }]));
});
