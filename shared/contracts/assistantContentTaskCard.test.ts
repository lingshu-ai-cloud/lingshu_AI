import assert from 'node:assert/strict';
import test from 'node:test';
import type { ProductionReadModelV1 } from './productionReadModel.js';
import type { SocialContentTaskDetail, SocialContentTaskSummary } from './socialContentTaskContract.js';
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

test('cancelled content remains cancelled rather than completed', () => {
  const cancelled = projectContentProductionTaskCard(task({ status: 'cancelled', readiness: { complete: true, missing: [] } }));
  assert.equal(cancelled.overallState, 'cancelled');
  assert.equal(cancelled.currentNode.id, 'cancelled');
  assert.equal(cancelled.nextAction, 'none');
});

test('projects exact artifact versions and server delivery receipts for same-conversation actions', () => {
  const detail = {
    ...task({ status: 'asset_review', readiness: { complete: true, missing: [] }, artifactCount: 2, approvedArtifactCount: 1, deliveryPackageCount: 1 }),
    artifacts: [
      { artifactId: 'candidate-a', taskId: 'content-1', kind: 'poster', platform: 'linkedin', language: 'en', version: '3', status: 'review_required', origin: 'agent', resourceRef: 'socialfile:candidate-a', content: {}, parentArtifactId: 'candidate-old', createdAt: '2026-10-24T01:00:00.000Z', updatedAt: '2026-10-24T01:05:00.000Z' },
      { artifactId: 'candidate-b', taskId: 'content-1', kind: 'poster', platform: 'linkedin', language: 'en', version: '2', status: 'approved', origin: 'agent', resourceRef: 'socialfile:candidate-b', content: {}, parentArtifactId: null, createdAt: '2026-10-24T01:00:00.000Z', updatedAt: '2026-10-24T01:04:00.000Z' },
    ],
    deliveryPackages: [{ packageId: 'delivery-a', taskId: 'content-1', version: '1', status: 'ready', artifactIds: ['candidate-b'], packageHash: 'a'.repeat(64), downloadHref: '/api/overseas/starter-198/social-content/delivery-packages/delivery-a/download', createdAt: '2026-10-24T01:05:00.000Z', updatedAt: '2026-10-24T01:05:00.000Z' }],
    sources: [], publications: [], metricSubmissions: [],
  } as unknown as SocialContentTaskDetail;
  const card = projectContentProductionTaskCard(detail);
  assert.deepEqual(card.artifacts?.map(item => [item.artifactId, item.version, item.status]), [
    ['candidate-a', '3', 'review_required'], ['candidate-b', '2', 'approved'],
  ]);
  assert.equal(card.artifacts?.[0]?.previewAvailable, true);
  assert.equal(card.deliveryReceipts?.[0]?.packageId, 'delivery-a');
  assert.match(card.deliveryReceipts?.[0]?.downloadHref || '', /delivery-a\/download/);
});

test('uses the canonical production read model for node, blockers, cost, progress and recovery', () => {
  const production: ProductionReadModelV1 = {
    schemaVersion: 'production-read-model.v1', authority: 'canonical_task',
    project: { kind: 'social_content', id: 'content-1', version: '7', title: '青柠精华短视频', taskStatus: 'producing', runId: 'run-1', studioProjectId: null, studioProjectVersion: null, studioProjectStatus: null, studioProjectConflict: false },
    aggregate: {
      stage: 'production', status: 'running', executable: true,
      identityGuarantee: { overall: 'qa_gated', product: 'qa_gated', presenter: 'not_required', requiresQa: true, basis: ['verified_product'] },
      inputs: { required: [], missing: [], items: [] },
      cost: { currency: 'CNY', expectedCny: 6, upperBoundCny: 8, actualCny: null, unsettledCny: null, status: 'estimated', reusable: false, basis: 'execution_plan' },
      blockers: [{ code: 'provider_reconciliation', message: '外部回执仍在核对，请勿重复提交', recoverable: true, inputId: null }],
      counts: { total: 3, ready: 0, running: 2, needsInput: 0, blocked: 0, review: 0, completed: 1 },
      phases: [], allowedCommands: ['open_project'],
    },
    shots: [], updatedAt: '2026-10-24T01:06:00.000Z',
  };
  const card = projectContentProductionTaskCard({
    ...task({ status: 'producing', readiness: { complete: true, missing: [] }, runId: 'run-1' }), production,
  } as unknown as SocialContentTaskDetail);
  assert.equal(card.overallState, 'processing');
  assert.equal(card.currentNode.id, 'production_run');
  assert.deepEqual(card.progress, { mode: 'units', completed: 1, total: 3 });
  assert.equal(card.blockingItems[0]?.value, '外部回执仍在核对，请勿重复提交');
  assert.equal(card.cost?.upperBoundCny, 8);
  assert.deepEqual(card.recoveryCursor, { kind: 'task_projection', value: 'content-1@7#2026-10-24T01:06:00.000Z', runId: 'run-1' });
  assert.equal(card.lastConfirmedAt, '2026-10-24T01:06:00.000Z');
});
