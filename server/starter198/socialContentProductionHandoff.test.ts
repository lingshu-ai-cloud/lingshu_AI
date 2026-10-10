import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import type {
  SocialContentExecutionPlan,
  SocialDirectorBrief,
  SocialExecutionPlanReview,
  SocialProductionResult,
  SocialReferenceVideoAnalysis,
} from '../../shared/contracts/socialContentWorkflow.js';
import { STARTER_COLLECTIONS, type Starter198Repository, type StarterRecord } from './repository.js';
import {
  buildSocialProductionHandoff,
  buildSocialProductionReceipt,
  evaluateSocialProductionGates,
  persistSocialProductionHandoff,
  persistSocialProductionReceipt,
  readSocialProductionState,
} from './socialContentProductionHandoff.js';

const analysisVersion = '3';
const analysis: SocialReferenceVideoAnalysis = {
  analysisId: 'analysis-v3', version: analysisVersion, referenceSourceId: 'captured-video-1', status: 'ready', durationSeconds: 6,
  coverage: { fullDurationSeconds: 6, precisionIntervals: [{ startSeconds: 0, endSeconds: 6, level: 'L3' }], gaps: [], overallConfidence: 0.92, fullTimelineCovered: true },
  shots: [
    { shotId: 'reference-hook', startSeconds: 0, endSeconds: 3, visualDescription: '产品进入画面', spokenText: null, captionText: null, audioDescription: '起音', rhythmDescription: '快速', purpose: 'hook', tags: { sceneTypes: [], subjects: [], subjectRelations: [], cameraLanguage: [], contentFunctions: [], soundTypes: [], onScreenInformation: [], truthRequirements: [], suggestedProductionMethods: [] }, fidelityPoints: ['结果先行'], mustDifferPoints: ['替换产品'] },
    { shotId: 'reference-cta', startSeconds: 3, endSeconds: 6, visualDescription: '行动收束', spokenText: null, captionText: null, audioDescription: '收束', rhythmDescription: '稳定', purpose: 'call_to_action', tags: { sceneTypes: [], subjects: [], subjectRelations: [], cameraLanguage: [], contentFunctions: [], soundTypes: [], onScreenInformation: [], truthRequirements: [], suggestedProductionMethods: [] }, fidelityPoints: ['行动收束'], mustDifferPoints: ['替换文案'] },
  ],
  hookAnalysis: null, rightsNotice: '仅分析结构', createdAt: '2026-09-26T00:00:00.000Z',
};

const scene = (sceneId: string, order: number, referenceShotId: string, purpose: 'hook' | 'call_to_action') => ({
  sceneId, order, referenceShotId, purpose, targetVisual: `${purpose} target`, requiredEvidence: [],
  action: { startState: '静止', path: '进入画面', endState: '稳定' },
  shotLanguage: { shotSize: 'close-up', cameraAngle: 'eye-level', movement: 'static', composition: 'center' },
  spaceAndContinuity: ['产品方向保持一致'],
  audioLayers: { voiceover: null, dialogue: null, captionIntent: null, ambient: null, music: null, soundEffects: null },
  duration: { startSeconds: order === 1 ? 0 : 3, endSeconds: order === 1 ? 3 : 6, targetSeconds: 3 },
  truthBoundary: { subject: 'none' as const, syntheticVisualAllowed: true, customerEvidenceRequired: false, customerEvidenceRefs: [], confirmedFactRefs: [], mustNotImplyCustomerReality: true, prohibitedRepresentations: [] },
  allowedVariation: ['构图微调'], acceptanceCriteria: ['时长正确'], fidelityPoints: [], mustDifferPoints: [],
});

const brief: SocialDirectorBrief = {
  directorBriefId: 'brief-v3', version: '3', status: 'ready', source: { weeklyPackageId: 'weekly-v3', adHocBusinessContextId: null },
  referenceAnalysis: { analysisId: analysis.analysisId, version: analysisVersion, fullDurationSeconds: 6, precisionIntervals: analysis.coverage!.precisionIntervals, gaps: [], overallConfidence: 0.92 },
  topic: '新品演示', audience: '采购商', platforms: ['tiktok'], accountRefs: ['account-playbook:v3'], creativeIntent: '展示差异', narrativeStructure: ['hook', 'cta'], rhythm: '快到稳', primaryHookId: null,
  coreSellingPoints: ['可验证参数'], callToAction: '询盘', totalDurationSeconds: 6, aspectRatio: '9:16', languages: ['zh'], brandRequirements: [], factSourceRefs: ['knowledge:1'], rightsConstraints: ['不使用原视频'],
  referenceEvidence: [{ analysisId: analysis.analysisId, referenceShotId: 'reference-hook', transferable: ['节奏'], mustReplace: ['产品'] }], budgetCny: 10, dueAt: null,
  scenes: [scene('scene-hook', 1, 'reference-hook', 'hook'), scene('scene-cta', 2, 'reference-cta', 'call_to_action')], createdBy: 'director_agent',
};

const executionPlan: SocialContentExecutionPlan = {
  executionPlanId: 'execution-v3', version: '3', directorBriefId: brief.directorBriefId, directorBriefVersion: brief.version,
  status: 'approved', reviewRound: 1, maxReviewRounds: 2, budgetLimitCny: 10, deadlineAt: null, estimatedTotalCostCny: 2, estimatedTotalSeconds: 30,
  scenes: brief.scenes.map(item => ({ sceneId: item.sceneId, feasibility: 'full_fidelity', feasibilityReason: 'ready', candidates: [{ candidateId: `candidate-${item.sceneId}`, kind: 'capability', label: 'motion', sourceRef: null, sourceStrategy: 'motion_graphics', evidenceStrength: 'non_evidentiary', rightsStatus: 'confirmed', enterpriseOwnershipScore: 1, semanticScore: 1, evidenceScore: 1, actionAndShotScore: 1, qualityScore: 1, durationFitScore: 1, repetitionPenalty: 0, estimatedCostCny: 1, estimatedSeconds: 15, estimatedSuccessRate: 1, dataTransfer: 'local_only', providerId: null, modelId: null, clipId: null, timeRange: null, promptRef: null, retryPolicy: { maxAttempts: 2, fallbackStrategies: [] }, provenance: { origin: 'system_capability', inputVersion: '3', authorizationRef: 'system', executionRecordId: null } }], recommendedCandidateIds: [`candidate-${item.sceneId}`], alternativeCandidateGroups: [], selectedSourceStrategy: 'motion_graphics', fallbackSourceStrategy: null, estimatedCostCny: 1, estimatedSeconds: 15, estimatedSuccessRate: 1, rightsRisks: [], dataTransferRisks: [], idempotencyKey: `execute-${item.sceneId}` })),
  createdBy: 'content_agent',
};

const executionPlanReview: SocialExecutionPlanReview = {
  reviewId: 'execution-review-v3', version: '3', executionPlanId: executionPlan.executionPlanId,
  executionPlanVersion: executionPlan.version, directorBriefId: brief.directorBriefId,
  directorBriefVersion: brief.version, approved: true,
  sceneResults: brief.scenes.map(item => ({ sceneId: item.sceneId, approved: true, feasibility: 'full_fidelity', failedCriteria: [], requiredRevision: [], goalImpact: 'none', reasonCodes: [] })),
  failedCriteria: [], requiredRevision: [], goalImpact: 'none', reasonCodes: [], createdBy: 'director_agent',
};

const productionResult: SocialProductionResult = {
  productionResultId: 'production-v3', version: '3', executionPlanId: executionPlan.executionPlanId,
  executionPlanVersion: executionPlan.version, executionPlanReviewId: executionPlanReview.reviewId,
  artifactId: 'artifact-v3', creativeReviewId: 'creative-review-v3', publishAssignmentId: null,
  status: 'technical_review_passed',
  sceneResults: executionPlan.scenes.map(item => ({ sceneId: item.sceneId, idempotencyKey: item.idempotencyKey, sourceStrategy: item.selectedSourceStrategy, feasibility: item.feasibility, provenanceCandidateIds: item.recommendedCandidateIds })),
  technicalReview: { approved: true, checkedScenes: 2, failures: [] },
  creativeReview: { approved: true, failedCriteria: [], reviewedBy: 'director_agent' },
  artifactResourceRef: 'artifact:production-v3', createdAt: '2026-09-26T02:00:00.000Z',
};

const surfaceHashes = {
  firstThreeSeconds: { baseline: 'hook-a', current: 'hook-b' },
  caption: { baseline: 'caption-a', current: 'caption-b' },
  cover: { baseline: 'cover-a', current: 'cover-b' },
  cta: { baseline: 'cta-a', current: 'cta-b' },
  copy: { baseline: 'copy-a', current: 'copy-b' },
  render: { baseline: 'render-a', current: 'render-b' },
};

const checks = (gate: 'G4' | 'G5' | 'G6') => ({
  G4: ['format', 'duration', 'audio_visual_sync', 'caption', 'linked_assets', 'render', 'sensitive_data'],
  G5: ['hook', 'evidence_order', 'account_tone', 'cta', 'truth_boundary', 'variant_difference'],
  G6: ['account', 'platform_format', 'conversion_route', 'sales_owner', 'weekly_authorization'],
}[gate].map(code => ({ code, passed: true, message: 'ok' })));

class MemoryRepository implements Starter198Repository {
  rows = new Map<string, StarterRecord[]>();
  async list(collection: keyof typeof STARTER_COLLECTIONS extends never ? never : any, tenantId: string, query: any = {}) {
    const all = (this.rows.get(collection) ?? []).filter(row => row.tenant_id === tenantId);
    const items = all.filter(row => Object.entries(query.where ?? {}).every(([key, value]) => row[key] === value));
    return { page: 1, perPage: query.perPage ?? 500, totalItems: items.length, totalPages: 1, items };
  }
  async get() { return null; }
  async create(collection: any, tenantId: string, data: Record<string, unknown>) {
    const row = { id: `row-${(this.rows.get(collection) ?? []).length + 1}`, tenant_id: tenantId, ...data };
    this.rows.set(collection, [...(this.rows.get(collection) ?? []), row]); return row;
  }
  async update() { return; }
  async access(): Promise<any> { throw new Error('unused'); }
}

function fixture() {
  return buildSocialProductionHandoff({ taskId: 'task-v3', version: '3', sourceAnalysis: analysis, directorBrief: brief, executionPlan, executionPlanReview,
    variantDifference: { variantId: 'variant-b', baselineVariantId: 'variant-a', changedSceneIds: ['scene-hook'], dimensions: ['hook'], hypothesis: '新开场提高停留', unchangedConstraints: ['产品事实', 'CTA'], surfaceHashes },
    now: new Date('2026-09-26T01:00:00.000Z') });
}

test('freezes collected-video lineage, DirectorBrief and per-shot Content Agent execution', () => {
  const handoff = fixture();
  assert.equal(handoff.shotTraces.length, 2);
  assert.equal(handoff.shotTraces[0]?.sourceAnalysisRef?.referenceShotId, 'reference-hook');
  assert.deepEqual(handoff.compositionBoundary.contentAgentMayNot, ['rewrite_brief', 'change_truth_boundary', 'change_source_lineage', 'self_approve_g5', 'self_approve_g6']);
  assert.equal(handoff.variantDifference.hypothesis, '新开场提高停留');
  assert.throws(() => buildSocialProductionHandoff({ taskId: 'task', version: '4', sourceAnalysis: analysis, directorBrief: brief, executionPlan, executionPlanReview,
    variantDifference: { variantId: 'bad', baselineVariantId: null, changedSceneIds: [], dimensions: [], hypothesis: '', unchangedConstraints: [], surfaceHashes } }), /variant_difference_required/);
  assert.throws(() => buildSocialProductionHandoff({ taskId: 'task', version: '4', sourceAnalysis: { ...analysis, version: undefined }, directorBrief: brief, executionPlan, executionPlanReview,
    variantDifference: { variantId: 'variant-b', baselineVariantId: 'variant-a', changedSceneIds: ['scene-hook'], dimensions: ['hook'], hypothesis: '新开场提高停留', unchangedConstraints: ['产品事实', 'CTA'], surfaceHashes } }), /source_analysis_version_required/);
});

test('records the first render as a baseline and reserves variant differences for derived renders', () => {
  const baseline = buildSocialProductionHandoff({
    taskId: 'task-baseline',
    version: '3',
    sourceAnalysis: analysis,
    directorBrief: brief,
    executionPlan,
    executionPlanReview,
    variantDifference: {
      variantId: 'variant-initial',
      baselineVariantId: null,
      changedSceneIds: [],
      dimensions: [],
      hypothesis: '首次成片只建立基线，不声明提升。',
      unchangedConstraints: ['产品事实', 'CTA'],
      surfaceHashes: {
        firstThreeSeconds: { baseline: null, current: surfaceHashes.firstThreeSeconds.current },
        caption: { baseline: null, current: surfaceHashes.caption.current },
        cover: { baseline: null, current: surfaceHashes.cover.current },
        cta: { baseline: null, current: surfaceHashes.cta.current },
        copy: { baseline: null, current: surfaceHashes.copy.current },
        render: { baseline: null, current: surfaceHashes.render.current },
      },
    },
  });
  assert.equal(baseline.variantDifference.baselineVariantId, null);
  assert.deepEqual(baseline.variantDifference.dimensions, []);
  assert.throws(() => buildSocialProductionHandoff({
    taskId: 'task-false-variant',
    version: '3',
    sourceAnalysis: analysis,
    directorBrief: brief,
    executionPlan,
    executionPlanReview,
    variantDifference: {
      ...baseline.variantDifference,
      dimensions: ['render_hash'],
    },
  }), /variant_difference_required/);
});

test('requires append-only G4 technical receipts, Director G5 and business G6 preflight', async () => {
  const handoff = fixture();
  const repository = new MemoryRepository() as unknown as Starter198Repository;
  await persistSocialProductionHandoff(repository, 'tenant-v3', handoff);
  await persistSocialProductionHandoff(repository, 'tenant-v3', handoff);
  const receipts = handoff.shotTraces.map((trace, index) => buildSocialProductionReceipt({ handoff, productionResult, gate: 'G4', sceneId: trace.sceneId, attempt: 1, status: 'passed', artifactRefs: [`artifact:${index}`], evidenceRefs: [`render:${index}`], checks: checks('G4'), actor: 'content_agent' }));
  for (const receipt of receipts) await persistSocialProductionReceipt(repository, 'tenant-v3', receipt);
  assert.equal(evaluateSocialProductionGates(handoff, receipts).G4, 'passed');
  assert.throws(() => buildSocialProductionReceipt({ handoff, productionResult, gate: 'G5', attempt: 1, status: 'passed', evidenceRefs: ['qa:1'], checks: checks('G5'), actor: 'content_agent' }), /g5_independence_required/);
  const g5 = buildSocialProductionReceipt({ handoff, productionResult, gate: 'G5', attempt: 1, status: 'passed', evidenceRefs: ['director:1'], checks: checks('G5'), actor: 'director_agent' });
  const g6 = buildSocialProductionReceipt({ handoff, productionResult, gate: 'G6', attempt: 1, status: 'passed', evidenceRefs: ['preflight:1'], checks: checks('G6'), actor: 'business_agent' });
  assert.equal(evaluateSocialProductionGates(handoff, [...receipts, g5, g6]).readyForRelease, true);
  await persistSocialProductionReceipt(repository, 'tenant-v3', g5);
  await persistSocialProductionReceipt(repository, 'tenant-v3', g6);
  await persistSocialProductionReceipt(repository, 'tenant-v3', g6);
  const state = await readSocialProductionState({ repository, tenantId: 'tenant-v3', taskId: handoff.taskId });
  assert.equal(state?.gates.readyForRelease, true);
  assert.equal(state?.receipts.length, 4);
  assert.equal(await readSocialProductionState({ repository, tenantId: 'other-tenant', taskId: handoff.taskId }), null);
});

test('blocks out-of-order quality gates and rejects forged receipt lineage', async () => {
  const handoff = fixture();
  const repository = new MemoryRepository() as unknown as Starter198Repository;
  await persistSocialProductionHandoff(repository, 'tenant-v3', handoff);
  const g5 = buildSocialProductionReceipt({ handoff, productionResult, gate: 'G5', attempt: 1, status: 'passed', evidenceRefs: ['director:1'], checks: checks('G5'), actor: 'director_agent' });
  await assert.rejects(() => persistSocialProductionReceipt(repository, 'tenant-v3', g5), /g4_incomplete/);
  const g4 = buildSocialProductionReceipt({ handoff, productionResult, gate: 'G4', sceneId: 'scene-hook', attempt: 1, status: 'passed', artifactRefs: ['artifact:1'], evidenceRefs: ['render:1'], checks: checks('G4'), actor: 'content_agent' });
  const forged = { ...g4, shotTraceHash: 'forged' };
  assert.throws(() => evaluateSocialProductionGates(handoff, [forged]), /storage_integrity_violation/);
});

test('migration is additive, tenant-scoped and indexed for immutable identity', async () => {
  const source = await readFile(new URL('../../pb_migrations/1790726400_create_social_production_handoffs.js', import.meta.url), 'utf8');
  const router = await readFile(new URL('./socialContentRouter.ts', import.meta.url), 'utf8');
  assert.match(source, /starter_social_production_handoffs/);
  assert.match(source, /starter_social_production_receipts/);
  assert.match(source, /UNIQUE INDEX idx_social_production_handoff_identity/);
  assert.match(source, /tenant_id, handoff_id, handoff_version/);
  assert.match(source, /UNIQUE INDEX idx_social_production_receipt_attempt/);
  assert.match(router, /\/tasks\/:taskId\/production-state/);
  assert.match(router, /readSocialProductionState/);
});
