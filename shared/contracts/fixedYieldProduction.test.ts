import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertAndNormalizeFixedYieldProductionPlan,
  freezeFixedYieldProductionPlan,
  validateFixedYieldOperationReceipt,
  type FixedYieldProductionPlan,
} from './fixedYieldProduction.js';
import { fixedYieldRuntimeSnapshotId, type FixedYieldRuntimeReadinessSnapshot } from '../fixedYieldPathRegistry.js';
import type { FixedYieldTimelineCompilation } from '../fixedYieldTimelineCompiler.js';

const timeline: FixedYieldTimelineCompilation = {
  schemaVersion: 'fixed-yield-timeline-compilation.v2', capabilityMapVersion: 'fixed-yield-capability.v2',
  referenceVideoId: 'reference-1', referenceEvidenceRevision: 'rev-1', productRef: 'product-1', ready: true, blockers: [],
  referenceDurationMs: 3000, targetDurationMs: 3000, unresolvedReferenceDurationMs: 0,
  classifiedDurationMsByPath: { P1_PRESENTER: 0, P2_PRODUCT_REAL: 3000, P3_FACTORY_REAL: 0, P4_CONSUMER_REAL: 0, P5_GENERAL_EVIDENCE: 0 },
  requiredArchetypeIds: ['P2B_PRODUCT_SHELF'], shots: [{ timelineShotId: 'timeline:shot-1', referenceShotId: 'shot-1',
    sourceStartMs: 0, sourceEndMs: 3000, timelineStartMs: 0, timelineEndMs: 3000, targetOutputDurationMs: 3000, productRef: 'product-1',
    materialType: 'product', narrativeRole: 'product_proof', pathId: 'P2_PRODUCT_REAL', archetypeId: 'P2B_PRODUCT_SHELF',
    productionMode: 'local_video_match', classificationEvidence: '产品货架展示' }],
};
const readinessCore: Omit<FixedYieldRuntimeReadinessSnapshot, 'snapshotId'> = {
  schemaVersion: 'fixed-yield-runtime-readiness.v2', capabilityMapVersion: 'fixed-yield-capability.v2', checkedAt: '2026-10-15T00:00:00.000Z',
  states: Object.fromEntries(['P1_PRESENTER', 'P2_PRODUCT_REAL', 'P3_FACTORY_REAL', 'P4_CONSUMER_REAL', 'P5_GENERAL_EVIDENCE'].map(pathId => [pathId, {
    pathId, state: 'available', allowedModes: pathId === 'P1_PRESENTER' ? ['pipeline_1'] : ['local_video_match'], reasonCodes: [], checkedAt: '2026-10-15T00:00:00.000Z',
  }])) as FixedYieldRuntimeReadinessSnapshot['states'],
};
const readiness: FixedYieldRuntimeReadinessSnapshot = { ...readinessCore, snapshotId: fixedYieldRuntimeSnapshotId(readinessCore) };
const core = {
  tenantId: 'tenant-1', projectId: 'project-1', timeline, readinessSnapshot: readiness,
  operations: [
    { operationId: 'extract', shotId: 'shot-1', role: 'local_segment_extract' as const, executor: 'ffmpeg', executionKind: 'local' as const, provider: null, dependsOn: [], activation: 'always' as const, request: { segment: 'asset:0-3000' }, maxCostFen: 0 },
    { operationId: 'shot-qa', shotId: 'shot-1', role: 'shot_quality' as const, executor: 'local-qa', executionKind: 'local' as const, provider: null, dependsOn: ['extract'], activation: 'always' as const,
      request: { qaProfileId: 'local-qa', thresholdsVersion: 'local-qa.v2', durationMs: 3000 }, maxCostFen: 0 },
    { operationId: 'shot-final', shotId: 'shot-1', role: 'shot_finalize' as const, executor: 'local-asset', executionKind: 'local' as const, provider: null, dependsOn: ['shot-qa'], activation: 'always' as const,
      request: { initialQualityGateOperationId: 'shot-qa', conditionalRepairOperationId: null, repairQualityGateOperationId: null, deliverableSelector: 'accepted_quality_output_only' }, maxCostFen: 0 },
    { operationId: 'assembly', shotId: null, role: 'timeline_assembly' as const, executor: 'ffmpeg', executionKind: 'local' as const, provider: null, dependsOn: ['shot-final'], activation: 'always' as const, request: { durationMs: 3000 }, maxCostFen: 0 },
    { operationId: 'whole-qa', shotId: null, role: 'whole_video_quality' as const, executor: 'local-qa', executionKind: 'local' as const, provider: null, dependsOn: ['assembly'], activation: 'always' as const,
      request: { qaProfileId: 'local-qa', thresholdsVersion: 'local-qa.v2' }, maxCostFen: 0 },
    { operationId: 'final', shotId: null, role: 'content_finalize' as const, executor: 'local-asset', executionKind: 'local' as const, provider: null, dependsOn: ['whole-qa'], activation: 'always' as const,
      request: { initialQualityGateOperationId: 'whole-qa', conditionalRepairOperationId: null, repairQualityGateOperationId: null, deliverableSelector: 'accepted_quality_output_only' }, maxCostFen: 0 },
  ],
  finalOutputOperationId: 'final', totalReservedCostFen: 0,
};

test('content identity is deterministic while run-scoped idempotency keys remain unique', () => {
  const first = freezeFixedYieldProductionPlan({ runId: 'run-1', createdAt: '2026-10-15T01:00:00Z', core });
  const second = freezeFixedYieldProductionPlan({ runId: 'run-2', createdAt: '2026-10-15T02:00:00Z', core });
  assert.equal(first.coreHash, second.coreHash);
  assert.notEqual(first.planHash, second.planHash);
  assert.notEqual(first.operations[0]?.idempotencyKey, second.operations[0]?.idempotencyKey);
});

test('unused paid work and local billing are rejected before execution', () => {
  assert.throws(() => freezeFixedYieldProductionPlan({ runId: 'run-1', createdAt: '2026-10-15T01:00:00Z', core: {
    ...core, operations: [...core.operations, { operationId: 'orphan', shotId: null, role: 'conditional_repair', executor: 'vendor', executionKind: 'provider', provider: 'vendor', dependsOn: ['whole-qa'], activation: 'on_quality_failure', qualityGateOperationId: 'whole-qa', request: {}, maxCostFen: 10 }], totalReservedCostFen: 10,
  } }), /operation_not_in_final_lineage/);
  assert.throws(() => freezeFixedYieldProductionPlan({ runId: 'run-1', createdAt: '2026-10-15T01:00:00Z', core: {
    ...core, operations: core.operations.map(item => item.operationId === 'extract' ? { ...item, maxCostFen: 1 } : item), totalReservedCostFen: 1,
  } }), /local_operation_billing_invalid/);
});

test('receipt invariants prevent skipped or local work from creating charges', () => {
  const plan = freezeFixedYieldProductionPlan({ runId: 'run-1', createdAt: '2026-10-15T01:00:00Z', core });
  const operation = plan.operations[0]!;
  const issues = validateFixedYieldOperationReceipt(operation, {
    schemaVersion: 'fixed-yield-operation-receipt.v2', runId: plan.runId, operationId: operation.operationId,
    idempotencyKey: operation.idempotencyKey, state: 'skipped', outputRefs: ['bad'], providerReceiptId: 'bad',
    reservedCostFen: 1, settledCostFen: 1, failure: null, finishedAt: '2026-10-15T01:00:00.000Z',
  });
  assert.ok(issues.includes('skipped_receipt_has_side_effect'));
  assert.ok(issues.includes('local_receipt_has_provider_billing'));
});

function persistedCopy(plan: FixedYieldProductionPlan): FixedYieldProductionPlan {
  return JSON.parse(JSON.stringify(plan)) as FixedYieldProductionPlan;
}

test('persisted plans are normalized and every identity layer is revalidated', () => {
  const plan = freezeFixedYieldProductionPlan({ runId: 'run-integrity', createdAt: '2026-10-15T01:00:00Z', core });
  assert.deepEqual(assertAndNormalizeFixedYieldProductionPlan(persistedCopy(plan)), plan);

  const staleCore = persistedCopy(plan);
  staleCore.coreHash = '0'.repeat(64);
  assert.throws(() => assertAndNormalizeFixedYieldProductionPlan(staleCore), /core_hash_invalid/);

  const stalePlan = persistedCopy(plan);
  stalePlan.planHash = '0'.repeat(64);
  assert.throws(() => assertAndNormalizeFixedYieldProductionPlan(stalePlan), /plan_hash_invalid/);

  const staleRequestHash = persistedCopy(plan);
  staleRequestHash.operations[0]!.requestHash = '0'.repeat(64);
  assert.throws(() => assertAndNormalizeFixedYieldProductionPlan(staleRequestHash), /request_hash_invalid/);

  const staleIdentity = persistedCopy(plan);
  staleIdentity.operations[0]!.operationIdentityHash = '0'.repeat(64);
  assert.throws(() => assertAndNormalizeFixedYieldProductionPlan(staleIdentity), /operation_identity_hash_invalid/);

  const staleIdempotency = persistedCopy(plan);
  staleIdempotency.operations[0]!.idempotencyKey = '0'.repeat(64);
  assert.throws(() => assertAndNormalizeFixedYieldProductionPlan(staleIdempotency), /idempotency_key_invalid/);
});

test('persisted request, provider, cost and DAG tampering fail closed', () => {
  const plan = freezeFixedYieldProductionPlan({ runId: 'run-tamper', createdAt: '2026-10-15T01:00:00Z', core });

  const requestTamper = persistedCopy(plan);
  requestTamper.operations.find(item => item.operationId === 'extract')!.request.segment = 'asset:tampered';
  assert.throws(() => assertAndNormalizeFixedYieldProductionPlan(requestTamper), /core_hash_invalid/);

  const providerTamper = persistedCopy(plan);
  providerTamper.operations.find(item => item.operationId === 'extract')!.provider = 'unexpected-provider';
  assert.throws(() => assertAndNormalizeFixedYieldProductionPlan(providerTamper), /local_operation_billing_invalid/);

  const costTamper = persistedCopy(plan);
  costTamper.operations.find(item => item.operationId === 'extract')!.maxCostFen = 1;
  assert.throws(() => assertAndNormalizeFixedYieldProductionPlan(costTamper), /local_operation_billing_invalid/);

  const dagTamper = persistedCopy(plan);
  dagTamper.operations.find(item => item.operationId === 'assembly')!.dependsOn = ['missing-operation'];
  assert.throws(() => assertAndNormalizeFixedYieldProductionPlan(dagTamper), /dependency_missing/);
});
