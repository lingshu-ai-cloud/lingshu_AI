import assert from 'node:assert/strict';
import test from 'node:test';
import { assertFixedYieldQualityDecision, sealFixedYieldQualityDecision } from './fixedYieldQuality.js';

test('quality decision is immutable, normalized and hash verified', () => {
  const decision = sealFixedYieldQualityDecision({ schemaVersion: 'fixed-yield-quality-decision.v2', subjectOperationId: 'op',
    subjectOutputName: 'video', subjectSha256: 'a'.repeat(64), qaProfileId: 'presenter-v2', thresholdsVersion: 'v2',
    verdict: 'rejected', failureCodes: ['lip_sync', 'lip_sync'], measurements: { durationMs: 3000 } });
  assert.deepEqual(decision.core.failureCodes, ['lip_sync']);
  assert.doesNotThrow(() => assertFixedYieldQualityDecision(decision));
  assert.throws(() => assertFixedYieldQualityDecision({ ...decision, decisionHash: 'bad' }), /hash_invalid/);
});

test('quality decision assertion rejects malformed runtime payloads before hashing', () => {
  assert.throws(() => assertFixedYieldQualityDecision(null), /shape_invalid/);
  assert.throws(() => assertFixedYieldQualityDecision({ decisionHash: 'a'.repeat(64), core: {
    schemaVersion: 'fixed-yield-quality-decision.v2', subjectOperationId: 'op', subjectOutputName: 'video',
    subjectSha256: 'a'.repeat(64), qaProfileId: 'presenter-v2', thresholdsVersion: 'v2',
    verdict: 'accepted', failureCodes: [], measurements: { score: Number.NaN },
  } }), /shape_invalid/);
  assert.throws(() => sealFixedYieldQualityDecision({
    schemaVersion: 'fixed-yield-quality-decision.v2', subjectOperationId: 'op', subjectOutputName: 'video',
    subjectSha256: 'a'.repeat(64), qaProfileId: 'presenter-v2', thresholdsVersion: 'v2',
    verdict: 'accepted', failureCodes: [], measurements: null as never,
  }), /shape_invalid/);
});
