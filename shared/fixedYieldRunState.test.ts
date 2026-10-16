import assert from 'node:assert/strict';
import test from 'node:test';
import { freezeFixedYieldProductionPlan, type FixedYieldOperationDraft,
  type FixedYieldProductionPlan, type ProductionFailure } from './contracts/fixedYieldProduction.js';
import { sealFixedYieldQualityDecision, type FixedYieldQualityDecision } from './contracts/fixedYieldQuality.js';
import { fixedYieldRuntimeSnapshotId, type FixedYieldRuntimeReadinessSnapshot } from './fixedYieldPathRegistry.js';
import type { FixedYieldTimelineCompilation } from './fixedYieldTimelineCompiler.js';
import { assertAndNormalizeFixedYieldRunState, createFixedYieldRunState, fixedYieldRunProgress, reconcileFixedYieldRunState,
  transitionFixedYieldOperationState, type FixedYieldRunState } from './fixedYieldRunState.js';

const MEDIA_SHA = 'a'.repeat(64);
const REPAIR_SHA = 'b'.repeat(64);

function operation(input: {
  operationId: string;
  role?: string;
  executor?: string;
  dependsOn?: string[];
  activation?: 'always' | 'on_quality_failure';
  qualityGateOperationId?: string;
  request?: Record<string, unknown>;
  shotId?: string | null;
}) {
  const dependsOn = input.dependsOn ?? [];
  const activation = input.activation ?? 'always';
  const role = input.role ?? 'local_segment_extract';
  const executor = input.executor ?? 'local';
  const qualityRequest = ['shot_quality', 'repair_quality', 'whole_video_quality'].includes(role)
    ? { qaProfileId: executor, thresholdsVersion: 'v2' }
    : {};
  return {
    operationId: input.operationId, shotId: input.shotId === undefined ? 'timeline:shot' : input.shotId, role,
    executor, executionKind: 'local', provider: null, dependsOn, activation,
    ...(input.qualityGateOperationId ? { qualityGateOperationId: input.qualityGateOperationId } : {}),
    request: { ...qualityRequest, ...(input.request ?? {}) }, maxCostFen: 0,
    operationIdentityHash: '1'.repeat(64), requestHash: '2'.repeat(64), idempotencyKey: '3'.repeat(64),
  };
}

const frozenAt = '2026-10-15T00:00:00.000Z';
const timeline: FixedYieldTimelineCompilation = {
  schemaVersion: 'fixed-yield-timeline-compilation.v2', capabilityMapVersion: 'fixed-yield-capability.v2',
  referenceVideoId: 'reference', referenceEvidenceRevision: 'reference-revision', productRef: null,
  ready: true, blockers: [], referenceDurationMs: 3000, targetDurationMs: 3000, unresolvedReferenceDurationMs: 0,
  classifiedDurationMsByPath: { P1_PRESENTER: 3000, P2_PRODUCT_REAL: 0, P3_FACTORY_REAL: 0,
    P4_CONSUMER_REAL: 0, P5_GENERAL_EVIDENCE: 0 },
  requiredArchetypeIds: ['P1B_FACTORY_STAND_TALK'],
  shots: [{ timelineShotId: 'timeline:shot', referenceShotId: 'shot', sourceStartMs: 0, sourceEndMs: 3000,
    timelineStartMs: 0, timelineEndMs: 3000, targetOutputDurationMs: 3000, productRef: null,
    materialType: 'talking_head', narrativeRole: 'hook', pathId: 'P1_PRESENTER',
    archetypeId: 'P1B_FACTORY_STAND_TALK', productionMode: 'pipeline_1', classificationEvidence: 'presenter' }],
};
const readinessCore: Omit<FixedYieldRuntimeReadinessSnapshot, 'snapshotId'> = {
  schemaVersion: 'fixed-yield-runtime-readiness.v2', capabilityMapVersion: 'fixed-yield-capability.v2', checkedAt: frozenAt,
  states: Object.fromEntries(['P1_PRESENTER', 'P2_PRODUCT_REAL', 'P3_FACTORY_REAL', 'P4_CONSUMER_REAL', 'P5_GENERAL_EVIDENCE']
    .map(pathId => [pathId, { pathId, state: 'available', allowedModes: pathId === 'P1_PRESENTER'
      ? ['pipeline_1'] : ['local_video_match'], reasonCodes: [], checkedAt: frozenAt }])) as FixedYieldRuntimeReadinessSnapshot['states'],
};
const readinessSnapshot: FixedYieldRuntimeReadinessSnapshot = {
  ...readinessCore, snapshotId: fixedYieldRuntimeSnapshotId(readinessCore),
};

function frozenPlan(input: {
  runId: string;
  operations: ReturnType<typeof operation>[];
  assemblyDependency: string;
}): FixedYieldProductionPlan {
  const operations = [
    ...input.operations,
    operation({ operationId: 'content:assembly', shotId: null, role: 'timeline_assembly',
      dependsOn: [input.assemblyDependency], request: { targetDurationMs: 3000 } }),
    operation({ operationId: 'content:qa', shotId: null, role: 'whole_video_quality', executor: 'whole-qa',
      dependsOn: ['content:assembly'], request: { qaProfileId: 'whole-qa', thresholdsVersion: 'whole-qa.v2' } }),
    operation({ operationId: 'content:finalize', shotId: null, role: 'content_finalize', dependsOn: ['content:qa'], request: {
      initialQualityGateOperationId: 'content:qa', conditionalRepairOperationId: null,
      repairQualityGateOperationId: null, deliverableSelector: 'accepted_quality_output_only',
    } }),
  ] as FixedYieldOperationDraft[];
  return freezeFixedYieldProductionPlan({ runId: input.runId, createdAt: frozenAt, core: {
    tenantId: 'tenant', projectId: 'project', timeline, readinessSnapshot, operations,
    finalOutputOperationId: 'content:finalize', totalReservedCostFen: 0,
  } });
}

function succeed(plan: FixedYieldProductionPlan, state: FixedYieldRunState, operationId: string, evidence: {
  outputSha256?: string;
  receiptSha256?: string;
}, second: number, qualityDecision?: FixedYieldQualityDecision): FixedYieldRunState {
  let next = transitionFixedYieldOperationState({ plan, state, operationId, to: 'running',
    now: `2026-10-15T00:00:${String(second).padStart(2, '0')}Z` });
  next = transitionFixedYieldOperationState({ plan, state: next, operationId, to: 'succeeded',
    now: `2026-10-15T00:01:${String(second).padStart(2, '0')}Z`, ...evidence, qualityDecision });
  return next;
}

function decision(input: {
  subjectOperationId: string;
  subjectSha256: string;
  qaProfileId?: string;
  thresholdsVersion?: string;
  verdict: 'accepted' | 'rejected';
  failureCodes?: string[];
}): FixedYieldQualityDecision {
  return sealFixedYieldQualityDecision({
    schemaVersion: 'fixed-yield-quality-decision.v2', subjectOperationId: input.subjectOperationId,
    subjectOutputName: 'video', subjectSha256: input.subjectSha256,
    qaProfileId: input.qaProfileId ?? 'local-qa', thresholdsVersion: input.thresholdsVersion ?? 'v2', verdict: input.verdict,
    failureCodes: input.failureCodes ?? [], measurements: {},
  });
}

const plan = frozenPlan({ runId: 'run', assemblyDependency: 'repair', operations: [
    operation({ operationId: 'media' }),
    operation({ operationId: 'qa', role: 'shot_quality', executor: 'local-qa', dependsOn: ['media'] }),
    operation({ operationId: 'repair', role: 'conditional_repair', dependsOn: ['qa'],
      activation: 'on_quality_failure', qualityGateOperationId: 'qa', request: { repairableFailureCodes: ['repairable'] } }),
  ] });

test('conditional repair is skipped only when QA accepts the actual dependency receipt', () => {
  let state = createFixedYieldRunState(plan, '2026-10-15T00:00:00Z');
  state = reconcileFixedYieldRunState({ plan, state, qualityDecisions: {}, now: '2026-10-15T00:00:01Z' });
  state = succeed(plan, state, 'media', { receiptSha256: MEDIA_SHA }, 2);
  state = reconcileFixedYieldRunState({ plan, state, qualityDecisions: {}, now: '2026-10-15T00:00:03Z' });
  const accepted = decision({ subjectOperationId: 'media', subjectSha256: MEDIA_SHA, verdict: 'accepted' });
  state = succeed(plan, state, 'qa', { outputSha256: accepted.decisionHash }, 4, accepted);
  state = reconcileFixedYieldRunState({ plan, state, qualityDecisions: { qa: accepted }, now: '2026-10-15T00:00:05Z' });
  assert.equal(state.operations.repair?.state, 'skipped');
  assert.equal(state.operations['content:assembly']?.state, 'ready');
});

test('external service failures never masquerade as user input blockers', () => {
  let state = createFixedYieldRunState(plan, '2026-10-15T00:00:00Z');
  state = reconcileFixedYieldRunState({ plan, state, qualityDecisions: {}, now: '2026-10-15T00:00:01Z' });
  state = transitionFixedYieldOperationState({ plan, state, operationId: 'media', to: 'running', now: '2026-10-15T00:00:02Z' });
  const failure: ProductionFailure = { schemaVersion: 'production-failure.v2', code: 'provider_timeout', category: 'provider', retryability: 'automatic',
    responsibleParty: 'provider', message: 'provider timeout', evidenceRefs: [], occurredAt: '2026-10-15T00:00:03Z' };
  assert.throws(() => transitionFixedYieldOperationState({ plan, state, operationId: 'media', to: 'blocked_input', now: failure.occurredAt, failure }), /transition_invalid|blocked_input_invalid/);
  assert.doesNotThrow(() => transitionFixedYieldOperationState({ plan, state, operationId: 'media', to: 'failed_retryable', now: failure.occurredAt, failure }));
  assert.throws(() => transitionFixedYieldOperationState({ plan, state, operationId: 'media', to: 'succeeded',
    now: failure.occurredAt, outputSha256: 'not-a-sha' }), /output_sha_invalid/);
});

const qualityPlan = frozenPlan({ runId: 'quality-run', assemblyDependency: 'finalize', operations: [
    operation({ operationId: 'initial-media' }),
    operation({ operationId: 'qa', role: 'shot_quality', executor: 'local-qa', dependsOn: ['initial-media'] }),
    operation({ operationId: 'repair', role: 'conditional_repair', dependsOn: ['qa'], activation: 'on_quality_failure',
      qualityGateOperationId: 'qa', request: { sourceOperationId: 'initial-media', repairableFailureCodes: ['lip_sync_mismatch'] } }),
    operation({ operationId: 'repair-qa', role: 'repair_quality', executor: 'local-qa', dependsOn: ['qa', 'repair'],
      activation: 'on_quality_failure', qualityGateOperationId: 'qa',
      request: { sourceOperationId: 'repair', repairableFailureCodes: ['lip_sync_mismatch'] } }),
    operation({ operationId: 'finalize', role: 'shot_finalize', dependsOn: ['qa', 'repair', 'repair-qa'], request: {
      initialQualityGateOperationId: 'qa', conditionalRepairOperationId: 'repair', repairQualityGateOperationId: 'repair-qa',
      deliverableSelector: 'accepted_quality_output_only',
    } }),
  ] });

function reachInitialQa(firstDecision: FixedYieldQualityDecision): FixedYieldRunState {
  let state = createFixedYieldRunState(qualityPlan, '2026-10-15T00:00:00Z');
  state = reconcileFixedYieldRunState({ plan: qualityPlan, state, qualityDecisions: {}, now: '2026-10-15T00:00:01Z' });
  state = succeed(qualityPlan, state, 'initial-media', { outputSha256: MEDIA_SHA }, 2);
  state = reconcileFixedYieldRunState({ plan: qualityPlan, state, qualityDecisions: {}, now: '2026-10-15T00:00:03Z' });
  return succeed(qualityPlan, state, 'qa', { outputSha256: firstDecision.decisionHash }, 4, firstDecision);
}

function reachQaRunning(): FixedYieldRunState {
  let state = createFixedYieldRunState(qualityPlan, '2026-10-15T00:00:00Z');
  state = reconcileFixedYieldRunState({ plan: qualityPlan, state, qualityDecisions: {}, now: '2026-10-15T00:00:01Z' });
  state = succeed(qualityPlan, state, 'initial-media', { outputSha256: MEDIA_SHA }, 2);
  state = reconcileFixedYieldRunState({ plan: qualityPlan, state, qualityDecisions: {}, now: '2026-10-15T00:00:03Z' });
  return transitionFixedYieldOperationState({ plan: qualityPlan, state, operationId: 'qa', to: 'running',
    now: '2026-10-15T00:00:04Z' });
}

test('a repairable rejection must pass a separate repair QA before finalize', () => {
  const firstDecision = decision({ subjectOperationId: 'initial-media', subjectSha256: MEDIA_SHA,
    verdict: 'rejected', failureCodes: ['lip_sync_mismatch'] });
  let state = reachInitialQa(firstDecision);
  state = reconcileFixedYieldRunState({ plan: qualityPlan, state, qualityDecisions: { qa: firstDecision }, now: '2026-10-15T00:00:05Z' });
  assert.equal(state.operations.repair?.state, 'ready');
  assert.equal(state.operations['repair-qa']?.state, 'planned');
  assert.equal(state.operations.finalize?.state, 'planned');
  state = succeed(qualityPlan, state, 'repair', { outputSha256: REPAIR_SHA }, 6);
  state = reconcileFixedYieldRunState({ plan: qualityPlan, state, qualityDecisions: { qa: firstDecision }, now: '2026-10-15T00:00:07Z' });
  assert.equal(state.operations['repair-qa']?.state, 'ready');
  const repairedDecision = decision({ subjectOperationId: 'repair', subjectSha256: REPAIR_SHA, verdict: 'accepted' });
  state = succeed(qualityPlan, state, 'repair-qa', { outputSha256: repairedDecision.decisionHash }, 8, repairedDecision);
  state = reconcileFixedYieldRunState({ plan: qualityPlan, state,
    qualityDecisions: { qa: firstDecision, 'repair-qa': repairedDecision }, now: '2026-10-15T00:00:09Z' });
  assert.equal(state.operations.finalize?.state, 'ready');
});

test('a reconciled conditional branch can retry without reselecting the branch', () => {
  const firstDecision = decision({ subjectOperationId: 'initial-media', subjectSha256: MEDIA_SHA,
    verdict: 'rejected', failureCodes: ['lip_sync_mismatch'] });
  let state = reachInitialQa(firstDecision);
  state = reconcileFixedYieldRunState({ plan: qualityPlan, state, qualityDecisions: { qa: firstDecision },
    now: '2026-10-15T00:00:05Z' });
  state = transitionFixedYieldOperationState({ plan: qualityPlan, state, operationId: 'repair', to: 'running',
    now: '2026-10-15T00:00:06Z' });
  state = transitionFixedYieldOperationState({ plan: qualityPlan, state, operationId: 'repair', to: 'failed_retryable',
    now: '2026-10-15T00:00:07Z', failure: { schemaVersion: 'production-failure.v2', code: 'renderer_timeout',
      category: 'infrastructure', retryability: 'automatic', responsibleParty: 'system', message: 'renderer timeout',
      evidenceRefs: [], occurredAt: '2026-10-15T00:00:07Z' } });
  state = transitionFixedYieldOperationState({ plan: qualityPlan, state, operationId: 'repair', to: 'ready',
    now: '2026-10-15T00:00:08Z' });
  assert.equal(state.operations.repair?.state, 'ready');
  assert.equal(state.operations.repair?.attempt, 1);
});

test('an unrepairable rejection fails the frozen shot instead of submitting a blind repair', () => {
  const firstDecision = decision({ subjectOperationId: 'initial-media', subjectSha256: MEDIA_SHA,
    verdict: 'rejected', failureCodes: ['unsafe_identity'] });
  let state = reachInitialQa(firstDecision);
  state = reconcileFixedYieldRunState({ plan: qualityPlan, state,
    qualityDecisions: { qa: firstDecision }, now: '2026-10-15T00:00:05Z' });
  assert.equal(state.operations.repair?.state, 'skipped');
  assert.equal(state.operations['repair-qa']?.state, 'skipped');
  assert.equal(state.operations.finalize?.state, 'failed_terminal');
  assert.equal(state.operations.finalize?.failure?.code, 'fixed_yield_no_accepted_shot_output');
});

test('a self-sealed forged acceptance cannot replace the QA decision persisted by the runtime', () => {
  const rejected = decision({ subjectOperationId: 'initial-media', subjectSha256: MEDIA_SHA,
    verdict: 'rejected', failureCodes: ['lip_sync_mismatch'] });
  const state = reachInitialQa(rejected);
  const forgedAccepted = decision({ subjectOperationId: 'initial-media', subjectSha256: MEDIA_SHA, verdict: 'accepted' });
  assert.throws(() => reconcileFixedYieldRunState({ plan: qualityPlan, state,
    qualityDecisions: { qa: forgedAccepted }, now: '2026-10-15T00:00:05Z' }), /decision_evidence_mismatch/);
  assert.equal(state.operations.repair?.state, 'planned');
  assert.equal(state.operations.finalize?.state, 'planned');
});

test('quality decisions cannot switch the subject operation or its actual output hash', () => {
  const wrongSubject = decision({ subjectOperationId: 'other-media', subjectSha256: MEDIA_SHA, verdict: 'accepted' });
  const state = reachQaRunning();
  assert.throws(() => transitionFixedYieldOperationState({ plan: qualityPlan, state, operationId: 'qa', to: 'succeeded',
    now: '2026-10-15T00:00:05Z', outputSha256: wrongSubject.decisionHash, qualityDecision: wrongSubject }),
  /subject_operation_mismatch/);

  const wrongHash = decision({ subjectOperationId: 'initial-media', subjectSha256: 'f'.repeat(64), verdict: 'accepted' });
  assert.throws(() => transitionFixedYieldOperationState({ plan: qualityPlan, state, operationId: 'qa', to: 'succeeded',
    now: '2026-10-15T00:00:05Z', outputSha256: wrongHash.decisionHash, qualityDecision: wrongHash }),
  /subject_hash_mismatch/);
});

test('a quality decision evaluated with stale thresholds cannot be persisted', () => {
  const staleThresholds = decision({ subjectOperationId: 'initial-media', subjectSha256: MEDIA_SHA,
    thresholdsVersion: 'v1', verdict: 'accepted' });
  const state = reachQaRunning();
  assert.throws(() => transitionFixedYieldOperationState({ plan: qualityPlan, state, operationId: 'qa', to: 'succeeded',
    now: '2026-10-15T00:00:05Z', outputSha256: staleThresholds.decisionHash, qualityDecision: staleThresholds }),
  /thresholds_version_mismatch/);
  assert.equal(state.operations.finalize?.state, 'planned');
});

test('quality and finalize nodes cannot bypass their decision gates through the public transition API', () => {
  let state = createFixedYieldRunState(qualityPlan, '2026-10-15T00:00:00Z');
  state = reconcileFixedYieldRunState({ plan: qualityPlan, state, qualityDecisions: {}, now: '2026-10-15T00:00:01Z' });
  state = succeed(qualityPlan, state, 'initial-media', { outputSha256: MEDIA_SHA }, 2);
  state = reconcileFixedYieldRunState({ plan: qualityPlan, state, qualityDecisions: {}, now: '2026-10-15T00:00:03Z' });
  state = transitionFixedYieldOperationState({ plan: qualityPlan, state, operationId: 'qa', to: 'running',
    now: '2026-10-15T00:00:04Z' });
  assert.throws(() => transitionFixedYieldOperationState({ plan: qualityPlan, state, operationId: 'qa', to: 'succeeded',
    now: '2026-10-15T00:00:05Z', outputSha256: MEDIA_SHA }), /quality_decision_missing/);
  assert.throws(() => transitionFixedYieldOperationState({ plan: qualityPlan, state, operationId: 'repair', to: 'ready',
    now: '2026-10-15T00:00:05Z' }), /reconcile_required/);
  assert.throws(() => transitionFixedYieldOperationState({ plan: qualityPlan, state, operationId: 'finalize', to: 'ready',
    now: '2026-10-15T00:00:05Z' }), /reconcile_required/);
});

const dependencyChainPlan = frozenPlan({ runId: 'dependency-run', assemblyDependency: 'deliverable', operations: [
    operation({ operationId: 'source' }),
    operation({ operationId: 'middle', dependsOn: ['source'] }),
    operation({ operationId: 'deliverable', dependsOn: ['middle'] }),
  ] });

test('public and persisted downstream states fail closed while a dependency is incomplete', () => {
  const state = createFixedYieldRunState(dependencyChainPlan, '2026-10-15T00:00:00Z');
  assert.throws(() => transitionFixedYieldOperationState({ plan: dependencyChainPlan, state,
    operationId: 'middle', to: 'ready', now: '2026-10-15T00:00:01Z' }), /dependency_incomplete:middle/);

  for (const target of ['ready', 'running', 'provider_pending', 'reconciling', 'succeeded'] as const) {
    const tampered = structuredClone(state);
    tampered.operations.middle!.state = target;
    tampered.operations.middle!.attempt = target === 'ready' ? 0 : 1;
    if (target === 'succeeded') tampered.operations.middle!.outputSha256 = MEDIA_SHA;
    assert.throws(() => assertAndNormalizeFixedYieldRunState(dependencyChainPlan, tampered),
      /dependency_incomplete:middle/, target);
  }
});

test('terminal dependency failure closes every planned descendant', () => {
  let state = createFixedYieldRunState(dependencyChainPlan, '2026-10-15T00:00:00Z');
  state = reconcileFixedYieldRunState({ plan: dependencyChainPlan, state, qualityDecisions: {}, now: '2026-10-15T00:00:01Z' });
  state = transitionFixedYieldOperationState({ plan: dependencyChainPlan, state, operationId: 'source', to: 'running', now: '2026-10-15T00:00:02Z' });
  state = transitionFixedYieldOperationState({ plan: dependencyChainPlan, state, operationId: 'source', to: 'failed_terminal', now: '2026-10-15T00:00:03Z',
    failure: { schemaVersion: 'production-failure.v2', code: 'provider_rejected', category: 'provider', retryability: 'never',
      responsibleParty: 'provider', message: 'provider rejected', evidenceRefs: ['provider:receipt'], occurredAt: '2026-10-15T00:00:03Z' } });
  state = reconcileFixedYieldRunState({ plan: dependencyChainPlan, state, qualityDecisions: {}, now: '2026-10-15T00:00:04Z' });
  assert.equal(state.operations.middle?.state, 'failed_terminal');
  assert.equal(state.operations.deliverable?.state, 'failed_terminal');
  assert.equal(state.operations.middle?.failure?.code, 'fixed_yield_upstream_dependency_failed_terminal');
  assert.match(state.operations.deliverable?.failure?.evidenceRefs.join(',') ?? '', /middle/);
});

test('cancellation closes every planned descendant without inventing a failure', () => {
  let state = createFixedYieldRunState(dependencyChainPlan, '2026-10-15T00:00:00Z');
  state = reconcileFixedYieldRunState({ plan: dependencyChainPlan, state, qualityDecisions: {}, now: '2026-10-15T00:00:01Z' });
  state = transitionFixedYieldOperationState({ plan: dependencyChainPlan, state, operationId: 'source', to: 'cancelled', now: '2026-10-15T00:00:02Z' });
  state = reconcileFixedYieldRunState({ plan: dependencyChainPlan, state, qualityDecisions: {}, now: '2026-10-15T00:00:03Z' });
  assert.equal(state.operations.middle?.state, 'cancelled');
  assert.equal(state.operations.deliverable?.state, 'cancelled');
  assert.equal(state.operations.middle?.failure, null);
  assert.equal(state.operations.deliverable?.failure, null);
});

test('terminal failure propagates across every nonterminal descendant state, not only planned', () => {
  const terminalFailure: ProductionFailure = { schemaVersion: 'production-failure.v2', code: 'provider_rejected', category: 'provider',
    retryability: 'never', responsibleParty: 'provider', message: 'provider rejected', evidenceRefs: ['provider:receipt'],
    occurredAt: '2026-10-15T00:00:02Z' };
  const retryableFailure: ProductionFailure = { schemaVersion: 'production-failure.v2', code: 'provider_timeout', category: 'provider',
    retryability: 'automatic', responsibleParty: 'provider', message: 'provider timeout', evidenceRefs: [],
    occurredAt: '2026-10-15T00:00:02Z' };
  const blockedFailure: ProductionFailure = { schemaVersion: 'production-failure.v2', code: 'input_missing', category: 'input',
    retryability: 'after_input', responsibleParty: 'user', message: 'input missing', evidenceRefs: [],
    occurredAt: '2026-10-15T00:00:02Z' };
  const variants = ['ready', 'running', 'provider_pending', 'reconciling', 'failed_retryable', 'blocked_input'] as const;
  for (const variant of variants) {
    let state = createFixedYieldRunState(dependencyChainPlan, '2026-10-15T00:00:00Z');
    state = reconcileFixedYieldRunState({ plan: dependencyChainPlan, state, qualityDecisions: {}, now: '2026-10-15T00:00:01Z' });
    state = transitionFixedYieldOperationState({ plan: dependencyChainPlan, state, operationId: 'source',
      to: 'failed_terminal', now: terminalFailure.occurredAt, failure: terminalFailure });
    const corrupted = structuredClone(state);
    corrupted.operations.middle!.state = variant;
    corrupted.operations.middle!.attempt = ['ready', 'blocked_input'].includes(variant) ? 0 : 1;
    corrupted.operations.middle!.failure = variant === 'failed_retryable'
      ? retryableFailure
      : variant === 'blocked_input' ? blockedFailure : null;
    const reconciled = reconcileFixedYieldRunState({ plan: dependencyChainPlan, state: corrupted,
      qualityDecisions: {}, now: '2026-10-15T00:00:03Z' });
    assert.equal(reconciled.operations.middle?.state, 'failed_terminal', variant);
    assert.equal(reconciled.operations.deliverable?.state, 'failed_terminal', variant);
  }
});

test('upstream cancellation also closes descendants that already left planned', () => {
  const variants = ['ready', 'running', 'provider_pending', 'reconciling', 'failed_retryable', 'blocked_input'] as const;
  for (const variant of variants) {
    let state = createFixedYieldRunState(dependencyChainPlan, '2026-10-15T00:00:00Z');
    state = reconcileFixedYieldRunState({ plan: dependencyChainPlan, state, qualityDecisions: {}, now: '2026-10-15T00:00:01Z' });
    state = transitionFixedYieldOperationState({ plan: dependencyChainPlan, state, operationId: 'source',
      to: 'cancelled', now: '2026-10-15T00:00:02Z' });
    const corrupted = structuredClone(state);
    corrupted.operations.middle!.state = variant;
    corrupted.operations.middle!.attempt = ['ready', 'blocked_input'].includes(variant) ? 0 : 1;
    corrupted.operations.middle!.failure = variant === 'failed_retryable'
      ? { schemaVersion: 'production-failure.v2', code: 'provider_timeout', category: 'provider', retryability: 'automatic',
        responsibleParty: 'provider', message: 'provider timeout', evidenceRefs: [], occurredAt: '2026-10-15T00:00:02Z' }
      : variant === 'blocked_input'
        ? { schemaVersion: 'production-failure.v2', code: 'input_missing', category: 'input', retryability: 'after_input',
          responsibleParty: 'user', message: 'input missing', evidenceRefs: [], occurredAt: '2026-10-15T00:00:02Z' }
        : null;
    const reconciled = reconcileFixedYieldRunState({ plan: dependencyChainPlan, state: corrupted,
      qualityDecisions: {}, now: '2026-10-15T00:00:03Z' });
    assert.equal(reconciled.operations.middle?.state, 'cancelled', variant);
    assert.equal(reconciled.operations.deliverable?.state, 'cancelled', variant);
  }
});

test('runtime start and reconcile reject a tampered persisted plan before state advances', () => {
  const requestTamper = structuredClone(dependencyChainPlan);
  requestTamper.operations.find(item => item.operationId === 'source')!.request.changed = true;
  assert.throws(() => createFixedYieldRunState(requestTamper, '2026-10-15T00:00:00Z'), /core_hash_invalid/);

  const state = createFixedYieldRunState(dependencyChainPlan, '2026-10-15T00:00:00Z');
  const dagTamper = structuredClone(dependencyChainPlan);
  dagTamper.operations.find(item => item.operationId === 'middle')!.dependsOn = ['missing-operation'];
  assert.throws(() => reconcileFixedYieldRunState({ plan: dagTamper, state, qualityDecisions: {},
    now: '2026-10-15T00:00:01Z' }), /dependency_missing/);
  assert.equal(state.operations.source?.state, 'planned');
});

test('persisted run state must contain exactly the operations frozen in the plan', () => {
  const state = createFixedYieldRunState(dependencyChainPlan, '2026-10-15T00:00:00Z');
  const missing = structuredClone(state);
  delete missing.operations.middle;
  assert.throws(() => reconcileFixedYieldRunState({ plan: dependencyChainPlan, state: missing,
    qualityDecisions: {}, now: '2026-10-15T00:00:01Z' }), /operation_set_invalid/);

  const injected = structuredClone(state);
  injected.operations.injected = { ...injected.operations.source!, operationId: 'injected' };
  assert.throws(() => fixedYieldRunProgress(dependencyChainPlan, injected), /operation_set_invalid/);
  assert.equal(state.operations.middle?.state, 'planned');
});

test('persisted operation identity and scalar state cannot be tampered', () => {
  const state = createFixedYieldRunState(dependencyChainPlan, '2026-10-15T00:00:00Z');
  const wrongIdentity = structuredClone(state);
  wrongIdentity.operations.source!.operationId = 'middle';
  assert.throws(() => assertAndNormalizeFixedYieldRunState(dependencyChainPlan, wrongIdentity), /operation_id_mismatch/);

  const invalidState = structuredClone(state) as unknown as { operations: Record<string, Record<string, unknown>> };
  invalidState.operations.source!.state = 'silently_stuck';
  assert.throws(() => assertAndNormalizeFixedYieldRunState(dependencyChainPlan, invalidState), /operation_state_invalid/);

  const invalidAttempt = structuredClone(state);
  invalidAttempt.operations.source!.attempt = -1;
  assert.throws(() => assertAndNormalizeFixedYieldRunState(dependencyChainPlan, invalidAttempt), /attempt_invalid/);

  const invalidTimestamp = structuredClone(state);
  invalidTimestamp.operations.source!.updatedAt = 'not-a-timestamp';
  assert.throws(() => assertAndNormalizeFixedYieldRunState(dependencyChainPlan, invalidTimestamp), /timestamp_invalid/);
});

test('persisted failure and output evidence must agree with operation state', () => {
  const state = createFixedYieldRunState(dependencyChainPlan, '2026-10-15T00:00:00Z');
  const successWithoutEvidence = structuredClone(state);
  successWithoutEvidence.operations.source!.state = 'succeeded';
  successWithoutEvidence.operations.source!.attempt = 1;
  assert.throws(() => fixedYieldRunProgress(dependencyChainPlan, successWithoutEvidence), /success_evidence_missing/);

  const plannedWithEvidence = structuredClone(state);
  plannedWithEvidence.operations.source!.outputSha256 = MEDIA_SHA;
  assert.throws(() => reconcileFixedYieldRunState({ plan: dependencyChainPlan, state: plannedWithEvidence,
    qualityDecisions: {}, now: '2026-10-15T00:00:01Z' }), /evidence_state_invalid/);

  const failedWithoutFailure = structuredClone(state);
  failedWithoutFailure.operations.source!.state = 'failed_retryable';
  failedWithoutFailure.operations.source!.attempt = 1;
  assert.throws(() => assertAndNormalizeFixedYieldRunState(dependencyChainPlan, failedWithoutFailure), /failure_shape_invalid/);

  const terminalWithRetryableFailure = structuredClone(state);
  terminalWithRetryableFailure.operations.source!.state = 'failed_terminal';
  terminalWithRetryableFailure.operations.source!.attempt = 1;
  terminalWithRetryableFailure.operations.source!.failure = {
    schemaVersion: 'production-failure.v2', code: 'provider_timeout', category: 'provider',
    retryability: 'automatic', responsibleParty: 'provider', message: 'provider timeout',
    evidenceRefs: [], occurredAt: '2026-10-15T00:00:01Z',
  };
  assert.throws(() => assertAndNormalizeFixedYieldRunState(dependencyChainPlan, terminalWithRetryableFailure),
    /terminal_failure_invalid/);
});

test('persisted QA and finalize states retain their exact quality-decision provenance', () => {
  const accepted = decision({ subjectOperationId: 'initial-media', subjectSha256: MEDIA_SHA, verdict: 'accepted' });
  const qaRunning = reachQaRunning();
  const qaWithoutDecision = structuredClone(qaRunning);
  qaWithoutDecision.operations.qa!.state = 'succeeded';
  qaWithoutDecision.operations.qa!.outputSha256 = accepted.decisionHash;
  assert.throws(() => assertAndNormalizeFixedYieldRunState(qualityPlan, qaWithoutDecision),
    /quality_decision_missing/);

  const rejected = decision({ subjectOperationId: 'initial-media', subjectSha256: MEDIA_SHA,
    verdict: 'rejected', failureCodes: ['unsafe_identity'] });
  let rejectedState = reachInitialQa(rejected);
  rejectedState = reconcileFixedYieldRunState({ plan: qualityPlan, state: rejectedState,
    qualityDecisions: { qa: rejected }, now: '2026-10-15T00:00:05Z' });
  const forgedFinalize = structuredClone(rejectedState);
  forgedFinalize.operations.finalize!.state = 'ready';
  forgedFinalize.operations.finalize!.failure = null;
  assert.throws(() => assertAndNormalizeFixedYieldRunState(qualityPlan, forgedFinalize),
    /finalize_quality_not_accepted/);
});

test('persisted run envelope remains bound to schema, run, and plan hashes', () => {
  const state = createFixedYieldRunState(dependencyChainPlan, '2026-10-15T00:00:00Z');
  const wrongRun = structuredClone(state);
  wrongRun.runId = 'other-run';
  assert.throws(() => fixedYieldRunProgress(dependencyChainPlan, wrongRun), /runtime_run_changed/);

  const wrongPlan = structuredClone(state);
  wrongPlan.planHash = 'f'.repeat(64);
  assert.throws(() => reconcileFixedYieldRunState({ plan: dependencyChainPlan, state: wrongPlan,
    qualityDecisions: {}, now: '2026-10-15T00:00:01Z' }), /runtime_plan_changed/);

  const wrongSchema = structuredClone(state) as unknown as { schemaVersion: string };
  wrongSchema.schemaVersion = 'fixed-yield-run-state.v1';
  assert.throws(() => assertAndNormalizeFixedYieldRunState(dependencyChainPlan, wrongSchema), /runtime_schema_invalid/);

  const tamperedPlan = structuredClone(dependencyChainPlan);
  tamperedPlan.operations.find(operation => operation.operationId === 'source')!.request.tampered = true;
  assert.throws(() => transitionFixedYieldOperationState({ plan: tamperedPlan, state, operationId: 'source',
    to: 'cancelled', now: '2026-10-15T00:00:01Z' }), /core_hash_invalid/);
});
