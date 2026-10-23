import assert from 'node:assert/strict';
import type { SocialContentTaskBrief } from '../../shared/contracts/socialContentWorkflow.js';
import { assertSocialContentReleaseQuality, inspectSocialContentReleaseQuality } from './socialContentReleaseQuality.js';
import { socialManagedArtifactReview } from './socialContentManagedReview.js';

const brief = { referenceMode: 'single_source_fidelity', perItemBudgetCny: 10, managementMode: 'one_click_managed' } as SocialContentTaskBrief;
const passed = { status: 'passed' };
const content = {
  workflowSchema: 'social-content.auto-production.v3',
  productionResult: {
    artifactResourceRef: 'socialfile:verified', executionPlanReviewId: 'plan', creativeReviewId: 'creative',
    technicalReview: { approved: true, checkedScenes: 37, failures: [] as string[] },
    creativeReview: { approved: true, failedCriteria: [] as string[], reviewedBy: 'director_agent' },
  },
  render: { completed: true, qualityPassed: true, audioDecoded: true },
  replicationEvaluation: {
    status: 'passed', viralFactorFidelity: passed, identityReplacement: passed,
    originalityDifference: passed, unauthorizedReuseRisk: passed, accountAndFactFit: passed,
    referenceTimelineAudit: { referenceShotCount: 37, outputShotCount: 37, referenceDurationSeconds: 38, fullCoverageValidated: true },
  },
  costSummary: { currency: 'CNY', estimatedBeforeGenerationCny: 9.9, recordedProviderCostCny: null, recordedProviderEstimatedCostCny: 9.8 },
};
const check = (value: unknown, mode: 'human'|'managed' = 'human') => inspectSocialContentReleaseQuality({ brief, content: value, mode });
assert.equal(check(content).approved, true);
assert.equal(check(content, 'managed').approved, true);
{
  const configured = process.env.INTERNAL_BUDGET_EXEMPT_TENANT_IDS;
  try {
    process.env.INTERNAL_BUDGET_EXEMPT_TENANT_IDS = 'local_tenant_customer_aurelia_beauty';
    const overBudget = structuredClone(content);
    overBudget.costSummary.estimatedBeforeGenerationCny = 16;
    overBudget.costSummary.recordedProviderEstimatedCostCny = 16;
    assert.equal(inspectSocialContentReleaseQuality({ tenantId: 'another-tenant', brief, content: overBudget, mode: 'human' }).failures.includes('budget_exceeded'), true);
    assert.equal(inspectSocialContentReleaseQuality({ tenantId: 'local_tenant_customer_aurelia_beauty', brief, content: overBudget, mode: 'human' }).approved, false);
    assert.equal(inspectSocialContentReleaseQuality({ tenantId: 'local_tenant_customer_aurelia_beauty', brief: { ...brief, perItemBudgetCny: undefined }, content: overBudget, mode: 'human' }).approved, false);
    assert.equal(inspectSocialContentReleaseQuality({ tenantId: 'another-tenant', brief: { ...brief, perItemBudgetCny: undefined }, content: overBudget, mode: 'human' }).failures.includes('budget_exceeded'), true);
    const missingEvidence = structuredClone(overBudget);
    delete (missingEvidence as Partial<typeof content>).costSummary;
    assert.equal(inspectSocialContentReleaseQuality({ tenantId: 'local_tenant_customer_aurelia_beauty', brief, content: missingEvidence, mode: 'human' }).failures.includes('budget_evidence_missing'), true);
  } finally {
    if (configured === undefined) delete process.env.INTERNAL_BUDGET_EXEMPT_TENANT_IDS;
    else process.env.INTERNAL_BUDGET_EXEMPT_TENANT_IDS = configured;
  }
}
const mutations: Array<(value: typeof content) => void> = [
  value => { value.productionResult.technicalReview.approved = false; },
  value => { value.productionResult.creativeReview.failedCriteria = ['missing shot']; },
  value => { value.replicationEvaluation.status = 'failed'; },
  value => { value.replicationEvaluation.referenceTimelineAudit.outputShotCount = 5; },
  value => { value.replicationEvaluation.referenceTimelineAudit.fullCoverageValidated = false; },
  value => { value.costSummary.recordedProviderEstimatedCostCny = 15.01; },
  value => { value.costSummary.estimatedBeforeGenerationCny = 15.01; },
  value => { delete (value as Partial<typeof content>).costSummary; },
  value => { delete (value as Partial<typeof content>).replicationEvaluation; },
  value => { value.costSummary.recordedProviderEstimatedCostCny = NaN; },
];
for (const mutate of mutations) {
  const value = structuredClone(content); mutate(value);
  assert.equal(check(value).approved, false);
  assert.throws(() => assertSocialContentReleaseQuality({ brief, content: value, mode: 'human' }), /social_artifact_release_quality_failed/);
}
const unknown = structuredClone(content);
unknown.replicationEvaluation.status = 'review_required';
unknown.replicationEvaluation.viralFactorFidelity = { status: 'review_required' };
assert.equal(check(unknown).approved, true, 'subjective fidelity belongs in final human review');
assert.equal(check(unknown, 'managed').approved, false, 'subjective review is not automatic acceptance');
for (const key of ['identityReplacement', 'originalityDifference', 'unauthorizedReuseRisk', 'accountAndFactFit'] as const) {
  const unverified = structuredClone(unknown);
  unverified.replicationEvaluation[key] = { status: 'review_required' };
  assert.equal(check(unverified).approved, false, `${key} is a hard evidence gate`);
}
const missingTimeline = structuredClone(unknown);
missingTimeline.replicationEvaluation.referenceTimelineAudit.fullCoverageValidated = false;
assert.equal(check(missingTimeline).approved, false, 'timeline unknown cannot be waived');
const failedFidelity = structuredClone(unknown);
failedFidelity.replicationEvaluation.viralFactorFidelity = { status: 'failed' };
assert.equal(check(failedFidelity).approved, false, 'explicitly failed fidelity cannot be waived');
assert.equal(inspectSocialContentReleaseQuality({ brief: {} as SocialContentTaskBrief, content, mode: 'human' }).applicable, true);
const managedInput = { brief, trustedAgentOrigin: true, origin: 'agent', kind: 'short_video', resourceRef: 'socialfile:verified', content };
assert.equal(socialManagedArtifactReview(managedInput).approved, true);
assert.equal(socialManagedArtifactReview({ ...managedInput, content: { ...content, replicationEvaluation: undefined } }).approved, false);
console.log('socialContentReleaseQuality tests passed');

// All actual automatic films share the hard media gate; conception mode and
// a human click cannot turn measured failure into delivery eligibility.
for (const referenceMode of [undefined, 'inspiration', 'single_source_fidelity']) {
  for (const mode of ['human', 'managed'] as const) {
    const scopedBrief = { ...brief, referenceMode } as SocialContentTaskBrief;
    for (const mutate of [
      (v: any) => { v.render.audioDecoded = false; },
      (v: any) => { v.productionResult.technicalReview.approved = false; },
      (v: any) => { delete v.productionResult.technicalReview.failures; },
      (v: any) => { v.productionResult.creativeReview.approved = false; },
      (v: any) => { v.delivery = { status: 'requires_revision' }; },
      (v: any) => { v.technicalQualityReport = { mediaHardProbe: { version: 'scene-media-hard-probe.v1', captionSpeechAlignment: { status: 'mismatch' } } }; },
    ]) {
      const failed = structuredClone(content); mutate(failed);
      assert.throws(() => assertSocialContentReleaseQuality({ brief: scopedBrief, content: failed, mode }), /release_quality_failed/);
    }
    assert.equal(inspectSocialContentReleaseQuality({ brief: scopedBrief, content, mode }).approved, true);
  }
}
assert.equal(inspectSocialContentReleaseQuality({ brief, content: { workflowSchema: 'uploaded-video' }, mode: 'human' }).applicable, false);

{
 const value=structuredClone(content) as any;
 value.costSummary.productionBudget={policyVersion:'finished-video-15-cny-per-30-seconds.v1',durationSeconds:30,maximumCny:15,retainedCny:15,acquisitionCny:50,budgetTaskId:'original-film'};
 assert.equal(check(value).approved,true,'separately authorized acquisition does not consume film cap');
 value.costSummary.productionBudget.retainedCny=15.01;
 assert.ok(check(value).failures.includes('budget_exceeded'),'retained previous attempts and revisions count at release');
 value.costSummary.productionBudget.retainedCny=14;
 value.costSummary.productionBudget.durationSeconds=12;
 assert.ok(check(value).failures.includes('budget_exceeded'),'a forged maximum cannot exceed its frozen duration policy');
}
