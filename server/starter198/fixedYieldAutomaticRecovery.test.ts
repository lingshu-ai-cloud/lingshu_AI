import assert from 'node:assert/strict';
import test from 'node:test';
import { freezeFixedYieldProductionPlan, type FixedYieldOperationDraft } from '../../shared/contracts/fixedYieldProduction.js';
import { sealFixedYieldQualityDecision } from '../../shared/contracts/fixedYieldQuality.js';
import { fixedYieldRuntimeSnapshotId, type FixedYieldRuntimeReadinessSnapshot } from '../../shared/fixedYieldPathRegistry.js';
import type { FixedYieldTimelineCompilation } from '../../shared/fixedYieldTimelineCompiler.js';
import { createFixedYieldRunState, reconcileFixedYieldRunState, transitionFixedYieldOperationState } from '../../shared/fixedYieldRunState.js';
import { decideFixedYieldAutomaticRecovery, type FixedYieldDegradeRevisionCandidate } from './fixedYieldAutomaticRecovery.js';

const at = '2026-10-17T00:00:00.000Z';
const sha = (char: string) => char.repeat(64);
const readinessCore = { schemaVersion: 'fixed-yield-runtime-readiness.v2' as const, capabilityMapVersion: 'fixed-yield-capability.v2' as const,
  checkedAt: at, states: Object.fromEntries(['P1_PRESENTER','P2_PRODUCT_REAL','P3_FACTORY_REAL','P4_CONSUMER_REAL','P5_GENERAL_EVIDENCE'].map(pathId =>
    [pathId, { pathId, state: 'available', allowedModes: pathId === 'P1_PRESENTER' ? ['pipeline_1'] : ['local_video_match'], reasonCodes: [], checkedAt: at }])) as unknown as FixedYieldRuntimeReadinessSnapshot['states'] };
const readiness = { ...readinessCore, snapshotId: fixedYieldRuntimeSnapshotId(readinessCore) };
const timeline = { schemaVersion: 'fixed-yield-timeline-compilation.v2', capabilityMapVersion: 'fixed-yield-capability.v2',
  referenceVideoId: 'reference', referenceEvidenceRevision: 'revision', productRef: null, referenceDurationMs: 3_000,
  targetDurationMs: 3_000, unresolvedReferenceDurationMs: 0, ready: true, blockers: [],
  classifiedDurationMsByPath: { P1_PRESENTER: 3_000, P2_PRODUCT_REAL: 0, P3_FACTORY_REAL: 0, P4_CONSUMER_REAL: 0, P5_GENERAL_EVIDENCE: 0 },
  requiredArchetypeIds: ['P1B_FACTORY_STAND_TALK'], shots: [{ timelineShotId: 'shot-a', referenceShotId: 'reference-shot', sourceStartMs: 0,
    sourceEndMs: 3_000, timelineStartMs: 0, timelineEndMs: 3_000, targetOutputDurationMs: 3_000, productRef: null,
    materialType: 'talking_head', narrativeRole: 'hook', pathId: 'P1_PRESENTER', archetypeId: 'P1B_FACTORY_STAND_TALK',
    productionMode: 'pipeline_1', classificationEvidence: 'presenter' }] } as unknown as FixedYieldTimelineCompilation;
const op = (value: Partial<FixedYieldOperationDraft> & Pick<FixedYieldOperationDraft, 'operationId'|'role'>): FixedYieldOperationDraft => ({
  shotId: 'shot-a', executor: 'local', executionKind: 'local', provider: null, dependsOn: [], activation: 'always', request: {}, maxCostFen: 0, ...value,
});
const plan = freezeFixedYieldProductionPlan({ runId: 'run-a', createdAt: at, core: { tenantId: 'tenant-a', projectId: 'project-a',
  timeline, readinessSnapshot: readiness, finalOutputOperationId: 'content-finalize', totalReservedCostFen: 1, operations: [
    op({ operationId: 'media', role: 'talking_video' }),
    op({ operationId: 'qa', role: 'shot_quality', executor: 'presenter-shot-quality-gate', dependsOn: ['media'], request: { qaProfileId: 'presenter-shot-quality-gate', thresholdsVersion: 'presenter-shot-quality-gate.v2', subjectOperationId: 'media' } }),
    op({ operationId: 'repair', role: 'conditional_repair', executionKind: 'provider', provider: 'seedance', executor: 'seedance', maxCostFen: 1,
      dependsOn: ['qa'], activation: 'on_quality_failure', qualityGateOperationId: 'qa', request: { repairableFailureCodes: ['lip_sync_mismatch'] } }),
    op({ operationId: 'repair-qa', role: 'repair_quality', executor: 'presenter-shot-quality-gate', dependsOn: ['qa','repair'], activation: 'on_quality_failure', qualityGateOperationId: 'qa',
      request: { qaProfileId: 'presenter-shot-quality-gate', thresholdsVersion: 'presenter-shot-quality-gate.v2', sourceOperationId: 'repair', repairableFailureCodes: ['lip_sync_mismatch'] } }),
    op({ operationId: 'finalize', role: 'shot_finalize', dependsOn: ['qa','repair','repair-qa'], request: { initialQualityGateOperationId: 'qa', conditionalRepairOperationId: 'repair', repairQualityGateOperationId: 'repair-qa', deliverableSelector: 'accepted_quality_output_only' } }),
    op({ operationId: 'assembly', role: 'timeline_assembly', shotId: null, dependsOn: ['finalize'] }),
    op({ operationId: 'whole-qa', role: 'whole_video_quality', shotId: null, executor: 'whole-video-qa', dependsOn: ['assembly'], request: { qaProfileId: 'whole-video-qa', thresholdsVersion: 'v2' } }),
    op({ operationId: 'content-finalize', role: 'content_finalize', shotId: null, dependsOn: ['whole-qa'], request: { initialQualityGateOperationId: 'whole-qa', conditionalRepairOperationId: null, repairQualityGateOperationId: null, deliverableSelector: 'accepted_quality_output_only' } }),
  ] } });

function rejected(subjectOperationId: string, subjectSha256: string) { return sealFixedYieldQualityDecision({ schemaVersion: 'fixed-yield-quality-decision.v2',
  subjectOperationId, subjectOutputName: 'video', subjectSha256, verdict: 'rejected', measurements: {},
  failureCodes: ['lip_sync_mismatch'], qaProfileId: 'presenter-shot-quality-gate', thresholdsVersion: 'presenter-shot-quality-gate.v2' }); }
function success(state: ReturnType<typeof createFixedYieldRunState>, id: string, output: string, qualityDecision?: ReturnType<typeof rejected>) {
  let next = transitionFixedYieldOperationState({ plan, state, operationId: id, to: 'running', now: at });
  return transitionFixedYieldOperationState({ plan, state: next, operationId: id, to: 'succeeded', now: at, outputSha256: output, qualityDecision });
}
function twiceRejectedState() {
  let state = reconcileFixedYieldRunState({ plan, state: createFixedYieldRunState(plan, at), qualityDecisions: {}, now: at });
  state = success(state, 'media', sha('a'));
  state = reconcileFixedYieldRunState({ plan, state, qualityDecisions: {}, now: at });
  const first = rejected('media', sha('a')); state = success(state, 'qa', first.decisionHash, first);
  state = reconcileFixedYieldRunState({ plan, state, qualityDecisions: { qa: first }, now: at });
  state = success(state, 'repair', sha('b'));
  state = reconcileFixedYieldRunState({ plan, state, qualityDecisions: { qa: first }, now: at });
  const second = rejected('repair', sha('b')); state = success(state, 'repair-qa', second.decisionHash, second);
  return reconcileFixedYieldRunState({ plan, state, qualityDecisions: { qa: first, 'repair-qa': second }, now: at });
}
const candidate = (cost = 250): FixedYieldDegradeRevisionCandidate => ({ revisionId: 'revision-a', revisionPlanHash: sha('c'), parentPlanHash: plan.planHash,
  affectedShotIds: ['shot-a'], strategy: 'heygen_stable_presenter', estimatedCostFen: cost, hardConstraintsPassed: true,
  coreFunctionPreserved: true, providerChanged: true, splitShot: false, removedActions: ['walk'] });

test('twice rejected shot selects an explicit affordable degrade revision', () => {
  const decision = decideFixedYieldAutomaticRecovery({ plan, state: twiceRejectedState(), budget: { limitCny: 10, retainedCny: 7, remainingCny: 3 }, candidates: [candidate()] });
  assert.equal(decision.action, 'create_degrade_revision');
  if (decision.action === 'create_degrade_revision') assert.equal(decision.candidate.revisionPlanHash, sha('c'));
});

test('no affordable valid revision routes only the failed item to existing decision handling', () => {
  const decision = decideFixedYieldAutomaticRecovery({ plan, state: twiceRejectedState(), budget: { limitCny: 10, retainedCny: 9, remainingCny: 1 }, candidates: [candidate(250)] });
  assert.deepEqual({ action: decision.action, shots: decision.affectedShotIds, reason: decision.action === 'needs_decision' ? decision.reason : null },
    { action: 'needs_decision', shots: ['shot-a'], reason: 'no_valid_degrade_revision' });
});

test('recovery never runs before the one bounded repair and second QA finish', () => {
  let state = reconcileFixedYieldRunState({ plan, state: createFixedYieldRunState(plan, at), qualityDecisions: {}, now: at });
  state = success(state, 'media', sha('a'));
  assert.equal(decideFixedYieldAutomaticRecovery({ plan, state, budget: { limitCny: 10, retainedCny: 2, remainingCny: 8 }, candidates: [candidate()] }).action, 'continue');
});
