import assert from 'node:assert/strict';
import type { SocialInspirationCollectionRun } from '../../shared/contracts/socialContentWorkflow.js';
import { advanceProductionGapTask, createProductionGapTask, ReferenceSelector, type ProductionGapTask } from './orchestration.js';
import { assessAccountRelativeMomentum, buildCandidateG1, evaluateInnovationGate, planRollingSevenDayQuotas, recommendAccountTracking } from './qualityOrchestration.js';

const now = new Date('2026-09-26T12:00:00.000Z');
const run = (finishedAt: string, accepted: Partial<Record<'momentum' | 'account' | 'innovation', number>>): SocialInspirationCollectionRun => ({
  runId: finishedAt, planId: 'p', keywordSetId: 'k', keywordSetVersion: 1, discoveryScopeId: 's', discoveryScopeVersion: 1,
  status: 'succeeded', triggerType: 'scheduled', scopeSnapshot: {} as SocialInspirationCollectionRun['scopeSnapshot'],
  modeStats: Object.fromEntries(Object.entries(accepted).map(([mode, value]) => [mode, { requested: 99, fetched: 99, deduplicated: 0, accepted: value, momentumCandidates: 0, failed: 0, costCny: null, effectiveRate: null }])),
  sourceRunRefs: [], queryBasis: {}, market: 'DE', language: 'en', stopReason: 'completed', startedAt: finishedAt, finishedAt, error: null,
});

const quotas = planRollingSevenDayQuotas([
  run('2026-09-25T12:00:00.000Z', { momentum: 5, account: 3, innovation: 0 }),
  run('2026-09-18T11:59:59.000Z', { innovation: 50 }),
], { totalAcceptedTarget: 20, innovationShare: 0.15 }, now);
assert.deepEqual(quotas.targetByMode, { momentum: 9, account: 8, innovation: 3 });
assert.deepEqual(quotas.remainingByMode, { momentum: 4, account: 5, innovation: 3 });
assert.throws(() => planRollingSevenDayQuotas([], { totalAcceptedTarget: 10, innovationShare: 0.21 }), /innovation_share/);

assert.equal(assessAccountRelativeMomentum({ currentPerformance: 160, accountPlatformBaseline: 100, snapshots: [{ observedAt: '2026-09-24', value: 100 }] }).level, 'high_performance');
assert.equal(assessAccountRelativeMomentum({ currentPerformance: 160, accountPlatformBaseline: 100, snapshots: [
  { observedAt: '2026-09-24', value: 100 }, { observedAt: '2026-09-25', value: 120 }, { observedAt: '2026-09-26', value: 160 },
] }).level, 'rising');
assert.equal(assessAccountRelativeMomentum({ currentPerformance: 160, accountPlatformBaseline: null }).relativeToAccountBaseline, 'unknown');

assert.equal(evaluateInnovationGate({ kind: 'adjacent_industry', businessAnchor: 'same sealing problem', independentSourceRefs: ['a', 'b'], userConfirmed: false }).qualified, true);
assert.equal(evaluateInnovationGate({ kind: 'comment_question', commentRefs: ['c1', 'c2'], contentRefs: ['v1', 'v2'] }).status, 'suggestion');
assert.equal(evaluateInnovationGate({ kind: 'comment_question', commentRefs: ['c1', 'c2', 'c3'], contentRefs: ['v1', 'v2'] }).qualified, true);

const g1 = buildCandidateG1({ runId: 'run', queryRef: 'query', discoveryMode: 'momentum', sourceUrl: 'https://example.com/v' });
assert.equal(g1.publishedAt, 'unknown');
assert.ok(g1.missingFields.includes('commentText'));

const selector = new ReferenceSelector();
const noSource = selector.select({ candidates: [{ candidateId: 'c', evidenceId: 'e', evidenceVersion: 1, readiness: 'production_reference', taskRelevance: 1, transferability: 1, rightsClear: true, sceneIds: ['scene'] }], requiredSceneIds: ['scene'] });
assert.equal(noSource.status, 'needs_collection', '无来源的条目不能成为采信证据');
const selected = selector.select({ candidates: [{ candidateId: 'c', evidenceId: 'e', evidenceVersion: 2, readiness: 'production_reference', taskRelevance: 1, transferability: 0.8, rightsClear: true, sceneIds: ['scene'], sourceRef: 'https://example.com/v' }], requiredSceneIds: ['scene'] });
assert.equal(selected.status, 'selected');

const task: ProductionGapTask = { gapTaskId: 'gap', tenantId: 't', upstreamTaskRef: 'weekly-task', taskGap: { description: 'proof', requiredSceneIds: ['scene'], minimumReferences: 1, requiredReadiness: 'production_reference', requestedModes: ['momentum'] }, budget: { currency: 'CNY', limitCny: 5, spentCny: 0 }, status: 'collecting', attemptCount: 0, lastError: null, lastAttemptAt: null, runRefs: [], selectedEvidenceRefs: [], referenceSelectionRef: null, stopReason: null, createdAt: now.toISOString(), updatedAt: now.toISOString() };
const createdTask = createProductionGapTask({ tenantId: 't', upstreamTaskRef: 'weekly-task', description: 'proof', requiredSceneIds: ['scene'], budgetLimitCny: 5, now });
assert.equal(createdTask.taskGap.description, 'proof');
assert.equal(createdTask.budget.limitCny, 5);
assert.equal(advanceProductionGapTask({ task, selection: noSource, addedCostCny: 5, runRef: 'run-1', now }).stopReason, 'budget_exhausted');
assert.equal(advanceProductionGapTask({ task, selection: selected, now }).status, 'ready_to_resume');
const promotion = recommendAccountTracking({ evidenceVideoIds: ['v1', 'v2', 'v3'], consecutiveQualifiedWindows: 2 });
assert.equal(promotion.resultingStatus, 'trial');
assert.equal(promotion.businessConfirmationRequired, true);

console.log('social discovery quality orchestration tests passed');
