import assert from 'node:assert/strict';
import test from 'node:test';
import type { SocialContentTaskDetail } from '../../shared/contracts/socialContentWorkflow.js';
import { replicationSystemReviewBlockers, systemReviewAppliedForStart } from './socialReplicationSystemReview.js';

function ready(): SocialContentTaskDetail {
  return { brief: { creationMode: 'viral_replication', managementMode: 'advanced' },
    referenceVideoAnalysis: { status: 'ready', analysisId: 'analysis', coverage: { fullTimelineCovered: true } },
    replicationScript: { referenceAnalysisId: 'analysis', shots: [{ shotId: 's1', materialPlan: {} }] },
    agentWorkflow: { directorBrief: { scenes: [{}] }, executionPlanReview: { approved: true,
      reasonCodes: [], failedCriteria: [], requiredRevision: [], sceneResults: [{ approved: true, failedCriteria: [] }] } },
  } as unknown as SocialContentTaskDetail;
}
test('automatic review checks real evidence instead of manufacturing user approvals', () => {
  assert.deepEqual(replicationSystemReviewBlockers(ready()), []);
  const partial = ready(); partial.referenceVideoAnalysis!.coverage!.fullTimelineCovered = false;
  assert.ok(replicationSystemReviewBlockers(partial).includes('reference_analysis_incomplete'));
  const changed = ready(); changed.replicationScript!.referenceAnalysisId = 'other';
  assert.ok(replicationSystemReviewBlockers(changed).includes('script_analysis_mismatch'));
  const missing = ready(); delete missing.agentWorkflow;
  assert.ok(replicationSystemReviewBlockers(missing).includes('execution_plan_unavailable'));
  for (const code of ['facts_missing', 'rights_missing', 'budget_exceeded'] as const) {
    const task = ready(); task.agentWorkflow!.executionPlanReview.reasonCodes = [code];
    assert.ok(replicationSystemReviewBlockers(task).includes(code));
  }
  const failedScene = ready(); failedScene.agentWorkflow!.executionPlanReview.sceneResults[0]!.approved = false;
  assert.ok(replicationSystemReviewBlockers(failedScene).includes('scene_review_incomplete'));
  const incomplete = ready(); incomplete.agentWorkflow!.executionPlanReview.sceneResults = [];
  assert.ok(replicationSystemReviewBlockers(incomplete).includes('scene_review_incomplete'));
});
test('a start retry recognizes only its system review at the unchanged task version', () => {
  const record = { version: '8', replication_script: { status: 'confirmed', review: {
    reviewedBy: 'system:replication-review', evidence: ['system:request:start-1:system-review', 'system:confirmed-task-version:8'],
  } } };
  assert.equal(systemReviewAppliedForStart(record, 'start-1'), true);
  assert.equal(systemReviewAppliedForStart(record, 'start-2'), false);
  assert.equal(systemReviewAppliedForStart({ ...record, version: '9' }, 'start-1'), false);
  assert.equal(systemReviewAppliedForStart({ ...record, replication_script: { ...record.replication_script,
    review: { ...record.replication_script.review, reviewedBy: 'human' } } }, 'start-1'), false);
});
