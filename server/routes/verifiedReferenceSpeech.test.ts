import assert from 'node:assert/strict';
import test from 'node:test';
import { currentVerifiedSpeech, validateVerifiedSpeechLines, verifiedSpeechStatus } from '../lib/verifiedReferenceSpeech.js';

test('manual sentence verification enforces ordered, bounded lines and screen visibility', () => {
  const lines = validateVerifiedSpeechLines([
    { text: '第一句。', start: 0.2, end: 1.8, visibility: 'on_camera' },
    { text: '第二句。', start: 1.9, end: 3.2, visibility: 'voiceover' },
  ], 4);
  assert.equal(lines.length, 2);
  assert.throws(() => validateVerifiedSpeechLines([{ text: '错句', start: 3, end: 5, visibility: 'voiceover' }], 4));
  assert.throws(() => validateVerifiedSpeechLines([
    { text: '第一句', start: 0, end: 2, visibility: 'on_camera' },
    { text: '第二句', start: 1, end: 3, visibility: 'voiceover' },
  ], 4));
  assert.throws(() => validateVerifiedSpeechLines([{ text: '未知', start: 0, end: 1, visibility: 'unknown' }], 4));
});

test('verified speech becomes stale when the source or analysis run changes', () => {
  const record = { schemaVersion: 1, analysisRunId: 'run-1', sourceSha256: 'sha-1', lines: [], coverageConfirmed: false, reviewerId: 'user', verifiedAt: '2026-09-28T00:00:00Z' };
  assert.equal(currentVerifiedSpeech(record, 'run-1', 'sha-1'), record);
  assert.equal(currentVerifiedSpeech(record, 'run-2', 'sha-1'), null);
  assert.equal(currentVerifiedSpeech(record, 'run-1', 'sha-2'), null);
});

test('a single time-checked sentence remains partial without explicit full-audio coverage review', () => {
  const partial = { schemaVersion: 1 as const, analysisRunId: 'run-1', sourceSha256: 'sha-1',
    lines: [{ text: '只校对这一句', start: 0, end: 2, visibility: 'on_camera' as const }],
    coverageConfirmed: false, reviewerId: 'user', verifiedAt: '2026-09-28T00:00:00Z' };
  assert.equal(verifiedSpeechStatus(partial), 'partial_review');
  assert.equal(verifiedSpeechStatus(null), 'needs_review');
});
