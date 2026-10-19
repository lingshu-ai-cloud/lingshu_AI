import assert from 'node:assert/strict';
import test from 'node:test';
import { freezeFixedYieldProductionPlan } from '../../shared/contracts/fixedYieldProduction.js';
import { fixedYieldRuntimeSnapshotId, type FixedYieldRuntimeReadinessSnapshot } from '../../shared/fixedYieldPathRegistry.js';
import type { FixedYieldTimelineCompilation } from '../../shared/fixedYieldTimelineCompiler.js';
import { authorizeFixedYieldPlanBeforeExecution, type FixedYieldBudgetAuthorization } from './fixedYieldBudgetGate.js';

const checkedAt = '2026-10-15T00:00:00.000Z';
const timeline: FixedYieldTimelineCompilation = {
  schemaVersion: 'fixed-yield-timeline-compilation.v2', capabilityMapVersion: 'fixed-yield-capability.v2',
  referenceVideoId: 'reference', referenceEvidenceRevision: 'revision', productRef: null, ready: true, blockers: [],
  referenceDurationMs: 3000, targetDurationMs: 3000, unresolvedReferenceDurationMs: 0,
  classifiedDurationMsByPath: { P1_PRESENTER: 3000, P2_PRODUCT_REAL: 0, P3_FACTORY_REAL: 0, P4_CONSUMER_REAL: 0, P5_GENERAL_EVIDENCE: 0 },
  requiredArchetypeIds: ['P1B_FACTORY_STAND_TALK'],
  shots: [{ timelineShotId: 'timeline:shot', referenceShotId: 'shot', sourceStartMs: 0, sourceEndMs: 3000,
    timelineStartMs: 0, timelineEndMs: 3000, targetOutputDurationMs: 3000, productRef: null,
    materialType: 'talking_head', narrativeRole: 'product_intro', pathId: 'P1_PRESENTER',
    archetypeId: 'P1B_FACTORY_STAND_TALK', productionMode: 'pipeline_1', classificationEvidence: 'factory presenter' }],
};
const readinessCore: Omit<FixedYieldRuntimeReadinessSnapshot, 'snapshotId'> = {
  schemaVersion: 'fixed-yield-runtime-readiness.v2', capabilityMapVersion: 'fixed-yield-capability.v2', checkedAt,
  states: Object.fromEntries(['P1_PRESENTER', 'P2_PRODUCT_REAL', 'P3_FACTORY_REAL', 'P4_CONSUMER_REAL', 'P5_GENERAL_EVIDENCE'].map(pathId => [pathId, {
    pathId, state: 'available', allowedModes: pathId === 'P1_PRESENTER' ? ['pipeline_1'] : ['local_video_match'],
    reasonCodes: [], checkedAt,
  }])) as unknown as FixedYieldRuntimeReadinessSnapshot['states'],
};
const readinessSnapshot: FixedYieldRuntimeReadinessSnapshot = {
  ...readinessCore, snapshotId: fixedYieldRuntimeSnapshotId(readinessCore),
};
const plan = freezeFixedYieldProductionPlan({ runId: 'run', createdAt: checkedAt, core: {
  tenantId: 'tenant', projectId: 'project', timeline, readinessSnapshot,
  operations: [
    { operationId: 'paid', shotId: 'timeline:shot', role: 'talking_video', executor: 'heygen-v3', executionKind: 'provider', provider: 'heygen', dependsOn: [], activation: 'always', request: {}, maxCostFen: 120 },
    { operationId: 'shot-qa', shotId: 'timeline:shot', role: 'shot_quality', executor: 'presenter-qa', executionKind: 'local', provider: null, dependsOn: ['paid'], activation: 'always', request: { qaProfileId: 'presenter-qa', thresholdsVersion: 'presenter-qa.v2' }, maxCostFen: 0 },
    { operationId: 'shot-final', shotId: 'timeline:shot', role: 'shot_finalize', executor: 'local-finalize', executionKind: 'local', provider: null, dependsOn: ['shot-qa'], activation: 'always', request: { initialQualityGateOperationId: 'shot-qa', deliverableSelector: 'accepted_quality_output_only' }, maxCostFen: 0 },
    { operationId: 'assembly', shotId: null, role: 'timeline_assembly', executor: 'ffmpeg', executionKind: 'local', provider: null, dependsOn: ['shot-final'], activation: 'always', request: {}, maxCostFen: 0 },
    { operationId: 'whole-qa', shotId: null, role: 'whole_video_quality', executor: 'whole-qa', executionKind: 'local', provider: null, dependsOn: ['assembly'], activation: 'always', request: { qaProfileId: 'whole-qa', thresholdsVersion: 'whole-qa.v2' }, maxCostFen: 0 },
    { operationId: 'final', shotId: null, role: 'content_finalize', executor: 'local-finalize', executionKind: 'local', provider: null, dependsOn: ['whole-qa'], activation: 'always', request: { initialQualityGateOperationId: 'whole-qa', deliverableSelector: 'accepted_quality_output_only' }, maxCostFen: 0 },
  ],
  finalOutputOperationId: 'final', totalReservedCostFen: 120,
} });
const authorization: FixedYieldBudgetAuthorization = { schemaVersion: 'fixed-yield-budget-authorization.v2', tenantId: 'tenant', taskId: 'task', runId: 'run',
  planHash: plan.planHash, coreHash: plan.coreHash, maximumCostFen: 120, strategy: 'complete', authorizedBy: 'user', authorizedAt: '2026-10-15T00:00:00.000Z' };

test('all possible paid operations are reserved before execution starts', async () => {
  const calls: unknown[] = [];
  const result = await authorizeFixedYieldPlanBeforeExecution({ plan, taskId: 'task', authorization,
    providerAccounts: [{ provider: 'heygen', accountRef: 'account-v1' }], ledger: {
      reserveBatch: async (scope, operations) => { calls.push({ scope, operations }); return null as never; },
      status: () => null,
    } });
  assert.equal(result.paidOperationCount, 1);
  assert.equal(calls.length, 1);
  assert.deepEqual((calls[0] as { operations: Array<{ operationId: string }> }).operations.map(item => item.operationId),
    [plan.operations.find(item => item.operationId === 'paid')!.idempotencyKey]);
});

test('changed or insufficient budget never reaches the ledger', async () => {
  let called = false;
  await assert.rejects(authorizeFixedYieldPlanBeforeExecution({ plan, taskId: 'task', authorization: { ...authorization, maximumCostFen: 119 },
    providerAccounts: [{ provider: 'heygen', accountRef: 'account-v1' }], ledger: {
      reserveBatch: async () => { called = true; return null as never; }, status: () => null,
    } }), /authorization_insufficient/);
  assert.equal(called, false);
});

test('tampered persisted plans never reach budget reservation', async () => {
  let called = false;
  const tampered = structuredClone(plan);
  tampered.operations.find(item => item.operationId === 'paid')!.provider = 'other-provider';
  await assert.rejects(authorizeFixedYieldPlanBeforeExecution({ plan: tampered, taskId: 'task', authorization,
    providerAccounts: [{ provider: 'other-provider', accountRef: 'account-v1' }], ledger: {
      reserveBatch: async () => { called = true; return null as never; }, status: () => null,
    } }), /core_hash_invalid/);
  assert.equal(called, false);
});
