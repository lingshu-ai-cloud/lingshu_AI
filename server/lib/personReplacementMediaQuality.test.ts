import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import { inspectPersonReplacementPair } from './personReplacementMediaQuality.js';

// Portable, real encoded media isolates technical matching from supplier quality.
// These fixtures make no claim about identity, lip sync, or human approval.
function fixtures() {
  assert.ok(ffmpeg);
  const dir = mkdtempSync(path.join(tmpdir(), 'person-media-quality-'));
  const source = path.join(dir, 'source.mp4'), candidate = path.join(dir, 'mismatch.mp4');
  execFileSync(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x160:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', source]);
  execFileSync(ffmpeg, ['-y', '-v', 'error', '-i', source, '-vf', 'negate', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'copy', candidate]);
  return { source, candidate, close: () => rmSync(dir, { recursive: true, force: true }) };
}

test('measures a video against itself as an exact technical match', async () => {
  const f = fixtures();
  try {
    const report = await inspectPersonReplacementPair(f.source, f.source);
    assert.equal(report.durationDeltaFrames, 0);
    assert.ok((report.audioCorrelation || 0) > 0.9999);
    assert.ok(report.wholeFrameSimilarity > 0.9999);
    assert.ok(report.comparedFrames >= 5);
  } finally { f.close(); }
});

test('detects a real encoded visual mismatch while preserving the original audio', async () => {
  const f = fixtures();
  try {
    const report = await inspectPersonReplacementPair(f.source, f.candidate);
    assert.ok((report.audioCorrelation || 0) > 0.99);
    assert.ok(report.wholeFrameSimilarity < 0.9);
  } finally { f.close(); }
});
