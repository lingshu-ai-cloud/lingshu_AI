import assert from 'node:assert/strict';
import test from 'node:test';
import type { SocialContentTaskSummary } from './socialContentTaskContract.js';
import { projectContentProductionTaskCard } from './assistantContentTaskCard.js';

function task(patch: Partial<SocialContentTaskSummary> = {}): SocialContentTaskSummary {
  return {
    taskId: 'content-1',
    brief: {
      title: '青柠精华短视频', objective: '介绍产品核心卖点', productRef: '青柠精华',
      markets: [], languages: ['zh'], platforms: ['tiktok'], formats: ['短视频'],
      aspectRatio: '9:16', cadence: null, requestedOutputCount: 1, dueAt: null,
      brandNotes: null, restrictions: [], callToAction: null, planningMode: 'auto_adjust',
    },
    status: 'needs_input', version: '7', packageSelection: [],
    readiness: { complete: false, missing: ['material'] }, runId: null,
    sourceCount: 0, knowledgeSourceCount: 0, materialSourceCount: 0,
    artifactCount: 0, approvedArtifactCount: 0, deliveryPackageCount: 0,
    publicationCount: 0, metricSubmissionCount: 0,
    createdAt: '2026-10-24T01:00:00.000Z', updatedAt: '2026-10-24T01:05:00.000Z',
    mode: 'instant', weeklyPlanId: null,
    ...patch,
  };
}

test('projects a missing-input instant task without inventing progress', () => {
  const card = projectContentProductionTaskCard(task());
  assert.equal(card.contentTaskId, 'content-1');
  assert.deepEqual(card.recoveryCursor, { kind: 'task_version', value: 'content-1@7', runId: null });
  assert.equal(card.overallState, 'needs_input');
  assert.equal(card.currentNode.id, 'preflight');
  assert.equal(card.blockingItems[0]?.value, '补充可用产品素材');
  assert.deepEqual(card.progress, { mode: 'units', completed: 0, total: 1 });
  assert.equal(card.nextAction, 'supply_input');
});

test('keeps approval, delivery and publication semantics distinct', () => {
  const review = projectContentProductionTaskCard(task({
    status: 'asset_review', readiness: { complete: true, missing: [] }, artifactCount: 1,
  }));
  assert.equal(review.overallState, 'needs_approval');
  assert.equal(review.nextAction, 'review');
  assert.match(review.currentNode.userFacingSummary, /等待验收/);

  const delivered = projectContentProductionTaskCard(task({
    status: 'delivered', readiness: { complete: true, missing: [] }, artifactCount: 1,
    approvedArtifactCount: 1, deliveryPackageCount: 1,
  }));
  assert.equal(delivered.overallState, 'completed');
  assert.match(delivered.currentNode.userFacingSummary, /不代表已发布/);
  assert.equal(delivered.progress.mode, 'units');
  if (delivered.progress.mode === 'units') assert.equal(delivered.progress.completed, 1);
});
