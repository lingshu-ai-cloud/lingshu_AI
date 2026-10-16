import assert from 'node:assert/strict';
import test from 'node:test';
import { sealFixedYieldQualityDecision, type FixedYieldQualityDecision } from '../../shared/contracts/fixedYieldQuality.js';
import { fixedYieldSha256, type FixedYieldProductionPlan } from '../../shared/contracts/fixedYieldProduction.js';
import { buildLocalMaterialSegmentProfile } from '../../shared/contracts/localMaterialSegmentProfile.js';
import { createFixedYieldRunState, fixedYieldRunProgress, reconcileFixedYieldRunState,
  transitionFixedYieldOperationState } from '../../shared/fixedYieldRunState.js';
import type { FixedYieldTimelineCompilation } from '../../shared/fixedYieldTimelineCompiler.js';
import { normalizeSceneVisualContract } from '../../shared/sceneVisualContract.js';
import { authorizeFixedYieldPlanBeforeExecution } from './fixedYieldBudgetGate.js';
import { compileFixedYieldProductionPlan, freezeFixedYieldWeeklyMaterialUsageSnapshot } from './fixedYieldCompiler.js';
import { buildFixedYieldRuntimeReadinessSnapshot, type FixedYieldModeProbe } from './fixedYieldRuntimeReadiness.js';

const now = '2026-10-15T00:00:00.000Z';
const unavailable = (): FixedYieldModeProbe => ({ adapterRegistered: false, authenticationReady: false,
  quotaAndBillingReady: false, qualityInspectionReady: false, objectStorageReady: false, reasonCodes: ['not_required'] });

test('local fixed-yield lifecycle compiles, authorizes, quality-gates and finalizes without paid work', async () => {
  const timeline: FixedYieldTimelineCompilation = {
    schemaVersion: 'fixed-yield-timeline-compilation.v2', capabilityMapVersion: 'fixed-yield-capability.v2',
    referenceVideoId: 'reference', referenceEvidenceRevision: 'reference-revision', productRef: 'SKU-1', ready: true, blockers: [],
    referenceDurationMs: 3000, targetDurationMs: 3000, unresolvedReferenceDurationMs: 0,
    classifiedDurationMsByPath: { P1_PRESENTER: 0, P2_PRODUCT_REAL: 3000, P3_FACTORY_REAL: 0, P4_CONSUMER_REAL: 0, P5_GENERAL_EVIDENCE: 0 },
    requiredArchetypeIds: ['P2B_PRODUCT_SHELF'], shots: [{ timelineShotId: 'timeline:shot', referenceShotId: 'shot',
      sourceStartMs: 0, sourceEndMs: 3000, timelineStartMs: 0, timelineEndMs: 3000, targetOutputDurationMs: 3000,
      productRef: 'SKU-1', materialType: 'product', narrativeRole: 'product_intro', pathId: 'P2_PRODUCT_REAL',
      archetypeId: 'P2B_PRODUCT_SHELF', productionMode: 'local_video_match', classificationEvidence: '同款产品货架展示' }],
  };
  const visual = normalizeSceneVisualContract({ subjects: ['product'], interaction: { kind: 'product_only_display', description: '同款产品货架展示' },
    environment: { kind: 'retail', description: '企业样品间货架' }, productRef: 'SKU-1', productPolicy: 'locked' });
  const assessment = buildLocalMaterialSegmentProfile({ tenantId: 'tenant', sourceTenantId: 'tenant', origin: 'my_materials',
    assetId: 'asset', segmentId: 'segment', sourceRevision: 'asset-revision', currentSourceRevision: 'asset-revision', mediaType: 'video',
    synthetic: false, startSeconds: 0, endSeconds: 4, materialType: 'product', materialRoles: ['product'], productId: 'SKU-1',
    productRef: 'SKU-1', visualContract: visual, observedActionTags: ['产品货架展示'], rightsEvidenceRefs: ['rights:asset'],
    commercialUseApproved: true, modelInputAllowed: false, derivativeUseAllowed: true, confidence: 0.99,
    needsReview: false, cleanEntry: true, cleanExit: true });
  assert.ok(assessment.profile);
  const readinessSnapshot = buildFixedYieldRuntimeReadinessSnapshot({ checkedAt: now,
    localVideo: { ffmpegReady: true, segmentProfilesReady: true, localQualityReady: true, reasonCodes: [] },
    presenter: { pipeline_1: unavailable(), pipeline_2: unavailable(), pipeline_3: unavailable() } });
  const compiled = compileFixedYieldProductionPlan({ tenantId: 'tenant', projectId: 'project', runId: 'run', createdAt: now,
    timeline, readinessSnapshot, presenterRouting: null,
    weeklyMaterialUsageSnapshot: freezeFixedYieldWeeklyMaterialUsageSnapshot({
      schemaVersion: 'fixed-yield-weekly-material-usage.v2', tenantId: 'tenant', weekStartsAt: '2026-10-12',
      weekEndsAt: '2026-10-18', checkedAt: now, reservations: [],
    }),
    localSegmentBindings: [{ timelineShotId: 'timeline:shot', assetId: 'asset',
      segmentId: 'segment', sourceRevision: 'asset-revision', physicalSegmentSha256: '7'.repeat(64),
      profile: assessment.profile, requestedProductRef: 'SKU-1' }] });
  assert.equal(compiled.ready, true);
  assert.ok(compiled.plan);
  let reserveCalls = 0;
  const authorization = { schemaVersion: 'fixed-yield-budget-authorization.v2' as const, tenantId: 'tenant', taskId: 'task', runId: 'run',
    planHash: compiled.plan.planHash, coreHash: compiled.plan.coreHash, maximumCostFen: 0, strategy: 'complete' as const,
    authorizedBy: 'owner', authorizedAt: now };
  const budget = await authorizeFixedYieldPlanBeforeExecution({ plan: compiled.plan, taskId: 'task', authorization,
    providerAccounts: [], ledger: { reserveBatch: async () => { reserveCalls += 1; return null as never; }, status: () => null } });
  assert.equal(budget.paidOperationCount, 0);
  assert.equal(reserveCalls, 0);

  let state = createFixedYieldRunState(compiled.plan, now);
  const qualityDecisions: Record<string, FixedYieldQualityDecision> = {};
  for (let tick = 1; tick <= 20 && fixedYieldRunProgress(compiled.plan, state).percent < 100; tick += 1) {
    state = reconcileFixedYieldRunState({ plan: compiled.plan, state, qualityDecisions, now: `2026-10-15T00:00:${String(tick).padStart(2, '0')}.000Z` });
    const ready: FixedYieldProductionPlan['operations'][number] | undefined = compiled.plan.operations
      .find(operation => state.operations[operation.operationId]?.state === 'ready');
    if (!ready) continue;
    state = transitionFixedYieldOperationState({ plan: compiled.plan, state, operationId: ready.operationId, to: 'running', now: `2026-10-15T00:01:${String(tick).padStart(2, '0')}.000Z` });
    let outputSha256 = fixedYieldSha256({ operationId: ready.operationId, tick });
    let qualityDecision: FixedYieldQualityDecision | undefined;
    if (ready.role === 'shot_quality' || ready.role === 'whole_video_quality') {
      const subjectOperationId = String(ready.request.sourceOperationId ?? ready.dependsOn[0] ?? '');
      const subject = state.operations[subjectOperationId];
      const subjectSha256 = subject?.outputSha256 || subject?.receiptSha256;
      assert.ok(subjectSha256);
      const frozenQaProfileId: string = String(ready.request.qaProfileId ?? '');
      const frozenThresholdsVersion: string = String(ready.request.thresholdsVersion ?? '');
      assert.equal(frozenQaProfileId, ready.executor);
      assert.ok(frozenThresholdsVersion);
      qualityDecisions[ready.operationId] = sealFixedYieldQualityDecision({
        schemaVersion: 'fixed-yield-quality-decision.v2', subjectOperationId, subjectOutputName: 'video',
        subjectSha256, qaProfileId: frozenQaProfileId, thresholdsVersion: frozenThresholdsVersion, verdict: 'accepted',
        failureCodes: [], measurements: {},
      });
      qualityDecision = qualityDecisions[ready.operationId]!;
      outputSha256 = qualityDecision.decisionHash;
    }
    state = transitionFixedYieldOperationState({ plan: compiled.plan, state, operationId: ready.operationId, to: 'succeeded',
      now: `2026-10-15T00:02:${String(tick).padStart(2, '0')}.000Z`, outputSha256, qualityDecision });
  }
  assert.equal(state.operations[compiled.plan.core.finalOutputOperationId]?.state, 'succeeded');
  assert.equal(fixedYieldRunProgress(compiled.plan, state).percent, 100);
});
