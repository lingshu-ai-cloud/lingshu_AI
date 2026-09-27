import assert from 'node:assert/strict';
import test from 'node:test';
import { detectBeatGridFromPcm } from './audioBeatAnalysis.js';

function pulsePcm(seconds: number, bpm: number): Buffer {
  const sampleRate = 11_025;
  const samples = new Int16Array(seconds * sampleRate);
  const interval = Math.round(sampleRate * 60 / bpm);
  for (let start = 0; start < samples.length; start += interval) {
    for (let offset = 0; offset < 180 && start + offset < samples.length; offset += 1) {
      samples[start + offset] = Math.round(18_000 * (1 - offset / 180));
    }
  }
  return Buffer.from(samples.buffer);
}

test('local beat detector produces a confidence-gated grid without model training', () => {
  const grid = detectBeatGridFromPcm(pulsePcm(12, 120));
  assert.ok(grid);
  assert.ok(grid!.beats.length >= 12);
  assert.ok(grid!.bpm >= 105 && grid!.bpm <= 135);
  assert.ok(grid!.confidence >= .45);
});

test('silence cannot enable beat synchronization', () => {
  assert.equal(detectBeatGridFromPcm(Buffer.alloc(11_025 * 2 * 6)), null);
});
