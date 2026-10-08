import assert from 'node:assert/strict';
import test from 'node:test';
import { requiresContentHumanAcceptance } from './contentProductionAcceptancePolicy.js';
import { presenterApprovalMatches } from './presenterApprovalRecovery.js';
test('replication production no longer waits for human acceptance; other editing policy is unchanged', () => {
  assert.equal(requiresContentHumanAcceptance({ requiresAcceptance: true, spec: { automation: { route: 'clone' }, contentOrder: { videoPlan: { reviewRequirements: ['quality'] } } } }), false);
  assert.equal(requiresContentHumanAcceptance({ requiresAcceptance: true, spec: { creationPath: 'viral_replication' } }), false);
  assert.equal(requiresContentHumanAcceptance({ requiresAcceptance: true, spec: { mode: 'material' } }), true);
});
test('machine-ready presenter may continue replication but still requires exact lineage and quality', () => {
  const binding = { tenantId: 't', projectId: 'p', jobId: 'j', outputMaterialId: 'm', voiceoverUrl: 'voice', spokenText: 'hello', language: 'en' };
  const job = { id: 'j', tenantId: 't', projectId: 'p', provider: 'heygen', status: 'review', outputMaterialId: 'm', voiceoverUrl: 'voice', scriptSnapshot: 'hello', language: 'en', qualityReport: { passed: true } };
  assert.equal(presenterApprovalMatches(binding, [job], true), true);
  assert.equal(presenterApprovalMatches(binding, [job]), false);
  assert.equal(presenterApprovalMatches(binding, [{ ...job, tenantId: 'other' }], true), false);
  assert.equal(presenterApprovalMatches(binding, [{ ...job, qualityReport: { passed: false } }], true), false);
});
