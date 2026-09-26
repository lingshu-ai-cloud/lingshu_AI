import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSentenceLipSyncQuality } from './sentenceLipSyncQuality.js';

const report = (overrides: Record<string, unknown> = {}) => ({
  version: 1,
  detector: 'official_syncnet',
  model_sha256: 'a'.repeat(64),
  passed: true,
  av_offset_frames: 1,
  syncnet_confidence: 7.2,
  thresholds: { absolute_offset_frames_max: 1, confidence_min: 7 },
  failures: [],
  ...overrides,
});

test('accepts traceable official SyncNet evidence at the commercial threshold', () => {
  const parsed = parseSentenceLipSyncQuality(report());
  assert.equal(parsed.passed, true);
  assert.equal(parsed.modelSha256, 'a'.repeat(64));
});

test('keeps a threshold failure as negative evidence', () => {
  const parsed = parseSentenceLipSyncQuality(report({ passed: false, syncnet_confidence: 6.9, failures: ['below threshold'] }));
  assert.equal(parsed.passed, false);
});

test('rejects provider scores, weak thresholds and inconsistent conclusions', () => {
  assert.throws(() => parseSentenceLipSyncQuality(report({ detector: 'provider_score' })), /来源/);
  assert.throws(() => parseSentenceLipSyncQuality(report({ thresholds: { absolute_offset_frames_max: 3, confidence_min: 3 } })), /阈值/);
  assert.throws(() => parseSentenceLipSyncQuality(report({ passed: true, syncnet_confidence: 6.9 })), /结论/);
});
