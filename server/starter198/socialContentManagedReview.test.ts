import assert from 'node:assert/strict';
import { socialManagedArtifactReview } from './socialContentManagedReview.js';
import type { SocialContentTaskBrief } from '../../shared/contracts/socialContentWorkflow.js';

const input = {
  brief: { managementMode: 'one_click_managed' } as SocialContentTaskBrief,
  trustedAgentOrigin: true,
  origin: 'agent', kind: 'short_video', resourceRef: 'socialfile:verified',
  content: {
    workflowSchema: 'social-content.auto-production.v3',
    productionResult: {
      artifactResourceRef: 'socialfile:verified', executionPlanReviewId: 'plan-review-v1', creativeReviewId: 'creative-v1',
      technicalReview: { approved: true, checkedScenes: 4, failures: [] },
      creativeReview: { approved: true, failedCriteria: [], reviewedBy: 'director_agent' },
    },
    render: { completed: true, qualityPassed: true, audioDecoded: true },
  },
};
assert.equal(socialManagedArtifactReview(input).approved, true);
assert.equal(socialManagedArtifactReview({ ...input, brief: { ...input.brief, managementMode: 'advanced' } }).approved, false);
assert.equal(socialManagedArtifactReview({ ...input, brief: {} as SocialContentTaskBrief }).approved, false);
assert.equal(socialManagedArtifactReview({ ...input, trustedAgentOrigin: false }).approved, false);
assert.equal(socialManagedArtifactReview({ ...input, origin: 'manual' }).approved, false);
assert.equal(socialManagedArtifactReview({ ...input, resourceRef: 'socialfile:replaced-version' }).approved, false);
assert.equal(socialManagedArtifactReview({ ...input, content: { ...input.content, replicationEvaluation: { status: 'review_required' } } }).approved, false);
for (const field of ['technicalReview', 'creativeReview', 'executionPlanReviewId', 'creativeReviewId']) {
  const content = structuredClone(input.content);
  delete (content.productionResult as Record<string, unknown>)[field];
  assert.equal(socialManagedArtifactReview({ ...input, content }).approved, false, `missing ${field} must fail closed`);
}
assert.equal(socialManagedArtifactReview({ ...input, content: { ...input.content, render: { completed: true } } }).approved, false);
console.log('socialContentManagedReview tests passed');
