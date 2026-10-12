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
const mutations: Array<(value: typeof content) => void> = [
  value => { value.productionResult.technicalReview.approved = false; },
  value => { value.productionResult.creativeReview.failedCriteria = ['missing shot']; },
  value => { value.replicationEvaluation.status = 'failed'; },
  value => { value.replicationEvaluation.referenceTimelineAudit.outputShotCount = 5; },
  value => { value.replicationEvaluation.referenceTimelineAudit.fullCoverageValidated = false; },
  value => { value.costSummary.recordedProviderEstimatedCostCny = 10.01; },
  value => { value.costSummary.estimatedBeforeGenerationCny = 10.01; },
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
unknown.replicationEvaluation.accountAndFactFit = { status: 'review_required' };
assert.equal(check(unknown).approved, true, 'human can resolve account evidence unknown');
assert.equal(check(unknown, 'managed').approved, false);
unknown.replicationEvaluation.viralFactorFidelity = { status: 'review_required' };
assert.equal(check(unknown).approved, false, 'timeline unknown cannot be waived');
assert.equal(inspectSocialContentReleaseQuality({ brief: {} as SocialContentTaskBrief, content, mode: 'human' }).applicable, false);
const managedInput = { brief, trustedAgentOrigin: true, origin: 'agent', kind: 'short_video', resourceRef: 'socialfile:verified', content };
assert.equal(socialManagedArtifactReview(managedInput).approved, true);
assert.equal(socialManagedArtifactReview({ ...managedInput, content: { ...content, replicationEvaluation: undefined } }).approved, false);
console.log('socialContentReleaseQuality tests passed');
