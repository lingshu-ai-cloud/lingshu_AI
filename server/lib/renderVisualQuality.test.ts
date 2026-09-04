import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import ffmpegStatic from 'ffmpeg-static';
import { inspectRenderedVisuals, runVisualFfmpeg } from './renderVisualQuality.js';

function fakeDecoder(onStart?: (child: EventEmitter & { stdout: PassThrough; stderr: PassThrough }) => void) {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(), stderr: new PassThrough(), killed: false,
    kill(signal: string) { assert.equal(signal, 'SIGKILL'); this.killed = true; return true; },
  });
  const spawnProcess = (() => { queueMicrotask(() => onStart?.(child)); return child; }) as unknown as NonNullable<Parameters<typeof runVisualFfmpeg>[2]>['spawnProcess'];
  return { child, spawnProcess };
}
const stalledDecoder = fakeDecoder();
const timeout = await runVisualFfmpeg([], true, { timeoutMs: 10, spawnProcess: stalledDecoder.spawnProcess });
assert.equal(timeout.ok, false);
assert.match(timeout.stderr, /visual_ffmpeg_timeout/);
assert.equal(stalledDecoder.child.killed, true, 'timed-out decoders must not keep occupying a worker');
const noisyDecoder = fakeDecoder(child => child.stdout.write(Buffer.alloc(2 * 1024 * 1024 + 1)));
const oversized = await runVisualFfmpeg([], true, { spawnProcess: noisyDecoder.spawnProcess });
assert.equal(oversized.ok, false);
assert.match(oversized.stderr, /visual_ffmpeg_output_limit/);
assert.equal(noisyDecoder.child.killed, true);
assert.equal(oversized.stdout.length, 0, 'oversized chunks must not be retained');
const brokenDecoder = fakeDecoder(child => child.emit('error', new Error('decoder unavailable')));
assert.equal((await runVisualFfmpeg([], false, { spawnProcess: brokenDecoder.spawnProcess })).ok, false);

assert.ok(ffmpegStatic, 'ffmpeg-static is required');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'render-business-quality-'));
try {
  const repeated = path.join(root, 'repeated.mp4');
  const moving = path.join(root, 'moving.mp4');
  execFileSync(String(ffmpegStatic), [
    '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'smptebars=s=320x480:r=10:d=4',
    '-pix_fmt', 'yuv420p', '-y', repeated,
  ]);
  execFileSync(String(ffmpegStatic), [
    '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=320x480:r=10:d=4',
    '-pix_fmt', 'yuv420p', '-y', moving,
  ]);

  const repeatedResult = await inspectRenderedVisuals({
    outputPath: repeated,
    expectedDuration: 4,
    expectedUniqueScenes: 5,
  });
  assert.equal(repeatedResult.passed, false, 'one repeated visual must not satisfy a five-scene content order');
  assert.ok(repeatedResult.failures.some(item => item.includes('可区分内容')));
  assert.ok(repeatedResult.metrics.nearDuplicateFrameRatio >= 0.8);

  const movingResult = await inspectRenderedVisuals({
    outputPath: moving,
    expectedDuration: 4,
    expectedUniqueScenes: 3,
    minSharpFrameRatio: 0.5,
  });
  assert.equal(movingResult.passed, true, movingResult.failures.join('；'));
  assert.ok(movingResult.metrics.estimatedDistinctFrames >= 3);
  assert.ok(movingResult.metrics.sharpFrameRatio >= 0.5);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('render visual business quality tests passed');
