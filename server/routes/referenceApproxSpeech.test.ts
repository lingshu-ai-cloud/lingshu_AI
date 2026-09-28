import assert from 'node:assert/strict';
import { test } from 'node:test';
import { approximateSpeechLines } from './referenceApproxSpeech.js';

test('splits a coarse ASR window into estimated sentences without claiming exact timing', () => {
  const lines = approximateSpeechLines([{ start: 2, end: 6, text: 'First sentence. Second sentence?', provenance: 'source-asr' }]);
  assert.deepEqual(lines.map(line => line.text), ['First sentence.', 'Second sentence?']);
  assert.equal(lines[0]?.start, 2);
  assert.equal(lines[1]?.end, 6);
  assert.ok(lines[0]!.end <= lines[1]!.start);
  assert.ok(lines.every(line => line.timingPrecision === 'coarse' && line.provenance.startsWith('source-asr:')));
});
