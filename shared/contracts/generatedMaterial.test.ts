import assert from 'node:assert/strict';
import test from 'node:test';
import { assertGeneratedMaterialMetadata, qualityAllowsReuse, type GeneratedMaterialMetadata } from './generatedMaterial.js';

const metadata = (): GeneratedMaterialMetadata => ({
  generation: { pipelineId: 'non_person_generation', assetGenerationKind: 'concept_visual', pipelineVersion: 'v1', executionId: 'exec-1',
    provider: 'provider', model: 'model', idempotencyKey: 'idem', inputFingerprint: 'input', promptOrSpecHash: 'spec', inputMaterialIds: [] },
  lineage: {}, quality: { state: 'accepted', checks: [{ key: 'decode', status: 'passed', evidence: 'decoded' }], checkedAt: '2026-10-09T00:00:00.000Z', policyVersion: 'v1' },
  reuse: { eligible: true, reason: 'quality_accepted', usageCount: 0 }, rightsScope: 'tenant_private',
});

test('accepted generated assets require complete passed automatic evidence', () => {
  const valid = metadata();
  assert.doesNotThrow(() => assertGeneratedMaterialMetadata(valid));
  assert.equal(qualityAllowsReuse(valid.quality), true);
  const unavailable = metadata(); unavailable.quality.checks[0]!.status = 'unavailable';
  assert.throws(() => assertGeneratedMaterialMetadata(unavailable), /自动证据不完整/);
});

test('a non-accepted asset cannot be marked reusable', () => {
  const invalid = metadata(); invalid.quality.state = 'repair_required';
  assert.throws(() => assertGeneratedMaterialMetadata(invalid), /不能复用/);
});
