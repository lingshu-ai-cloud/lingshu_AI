import assert from 'node:assert/strict';
import test from 'node:test';
import { createSocialAssetSupplyPlan } from '../../shared/socialContentAssetSupply.js';
import type { SocialDirectorBrief, SocialInspirationHandoff } from '../../shared/contracts/socialContentWorkflow.js';
import type { BusinessContentGoal } from '../../shared/contracts/socialOperatingDecision.js';
import type { WeeklyOperatingPackage } from '../../shared/contracts/socialProgram.js';
import type { VersionedReferenceSelection } from '../socialDiscovery/orchestration.js';
import { buildAuthoritativeSocialContentWorkflow } from './socialContentTasks.js';
import {
  buildSocialContentAuthorityLineage,
  invalidateSocialContentLineage,
  persistAuthoritativeContentBundle,
  persistProductionReturn,
  routeProductionReturn,
} from './socialContentLineage.js';
import { STARTER_COLLECTIONS, type Starter198Repository, type StarterRecord } from './repository.js';

const fact = { type: 'enterprise_fact', id: 'fact-1', version: 3 };
const workflowTask = { taskId: 'weekly-content-1', kind: 'content', taskRef: { type: 'weekly_workflow_task', id: 'weekly-content-1', version: 1 }, dependsOnTaskIds: [], subjectRefs: [{ type: 'weekly_publication_task', id: 'publication-1', version: 4 }], status: 'planned', ownBlockingReasons: [], inheritedBlockingTaskIds: [], carriedFromTaskId: null } as const;
const publicationTask = { publicationTaskId: 'publication-1', motherContentId: 'mother-1', adaptationOfPublicationTaskId: null, platform: 'tiktok', accountId: 'account-1', accountPositioning: '采购知识', businessProposition: '降低采购风险', cta: '提交询盘', factRefs: [fact], metricTargets: ['有效询盘'], publishWindow: '2026-10-02T00:00:00.000Z', status: 'planned' } as const;
const weeklyPackage = {
  packageId: 'package-1', programId: 'program-1', version: 4, status: 'active', weekStart: '2026-09-28', weekEnd: '2026-10-04', objective: '获得询盘',
  enterpriseProfileRef: { type: 'enterprise_profile', id: 'enterprise-1', version: 6 }, businessContentGoalRef: { type: 'business_content_goal', id: 'goal-1', version: 2 }, monthlyPlanRef: null,
  workflows: [], workflowTasks: [workflowTask], appliedWorkflowEvents: [], taskVersionMappings: [], planningBlockers: [], capacityPlanRef: null, automationPolicyRef: null, discoveryBudgetCny: 30,
  socialContentPackage: { contentPackageId: 'content-package-1', operatingPackageId: 'package-1', version: 4, status: 'active', originalContentTarget: 10, adaptationVersionTarget: 16, publicationTaskTarget: 26, publicationTasks: [publicationTask], weeklyBudgetCny: 300, perItemBudgetCny: 20, capacityNotes: [], authorization: { mode: 'bounded', accountIds: ['account-1'], maxPublishItems: 26, weekStart: '2026-09-28', weekEnd: '2026-10-04', allowRealPublishing: false, authorizedBy: null, authorizedAt: null, revokedBy: null, revokedAt: null } },
  successCriteria: ['有效询盘'], changeReason: null, previousVersion: null, createdBy: 'planner', createdAt: '2026-09-26T00:00:00.000Z', updatedAt: '2026-09-26T00:00:00.000Z',
} as unknown as WeeklyOperatingPackage;
const goal = { goalId: 'goal-1', programId: 'program-1', version: 2, status: 'ready', objective: '获得询盘', products: ['product-1'], markets: ['US'], audiences: ['采购商'], languages: ['zh'], accountBoundaries: [], conversionRouteIds: [], publicFactRefs: [fact], prohibitedClaims: [], weeklyBudgetCny: 300, evidence: [], blockers: [], inputRefs: [], inputFingerprint: 'fp', ruleVersion: 'business-content-goal/1.0.0', decisionRecordRef: { type: 'decision', id: 'decision-1', version: 1 }, createdBy: 'agent', createdAt: '2026-09-26T00:00:00.000Z' } as BusinessContentGoal;

function handoff(id: string, role: SocialInspirationHandoff['referenceRole'] = 'primary_structure'): SocialInspirationHandoff {
  return { inspirationId: id, analysisId: `analysis-${id}`, analysisVersion: '1', readiness: 'production_reference', source: { platform: 'tiktok', sourceUrl: `https://example.com/${id}` }, taskContext: {}, whySelected: ['evidence'], referenceRole: role, reusableLogic: { hookTypes: [], revealOrder: [], proofPlacement: [], pacing: '', emotionalProgression: '', ctaPosition: '' }, adaptationBoundary: { reusable: [], mustReplace: [], prohibited: [] }, productionImplications: { requiredEvidence: [], likelyAssetNeeds: [], risks: [] }, evidenceRefs: [{ description: 'observed', confidence: 0.9, needsReview: false }], rights: { mayAnalyze: true, mayUseOriginalMedia: false, mayAdapt: true } };
}

function selection(ids: string[], version = 1): VersionedReferenceSelection {
  return { selectionId: `selection-${version}`, version, tenantId: 'tenant-1', upstreamTaskRef: workflowTask.taskId, status: 'selected', reason: 'inventory_covered', selected: ids.map((id, index) => ({ candidateId: id, evidenceId: `evidence-${id}`, evidenceVersion: 2, readiness: 'production_reference', taskRelevance: 0.9, transferability: 0.8, rightsClear: true, sceneIds: [`scene-${index + 1}`], sourceRef: `https://example.com/${id}` })), evidenceVersionRefs: ids.map(id => `evidence-${id}@2`), createdAt: '2026-09-26T00:00:00.000Z', supersedesSelectionId: null };
}

const brief: any = { title: '采购内容', objective: 'legacy', productRef: 'product-1', audience: null, markets: [], languages: [], platforms: [], formats: ['short_video'], aspectRatio: '9:16', cadence: null, requestedOutputCount: 1, weeklyBudgetCny: null, perItemBudgetCny: null, retryReserveCny: null, planningMode: 'auto_adjust', shootingWindowMinutes: 0, specialRequirements: null, dueAt: null, brandNotes: null, restrictions: [], callToAction: null, creationMode: 'material_processing', assetAvailability: 'none', managementMode: 'one_click_managed', productionMode: 'social_ready' };
const supply = createSocialAssetSupplyPlan({ creationMode: 'material_processing', planVersion: '1', confirmedFactRefs: ['enterprise_fact:fact-1@3'], shots: [{ shotId: 'scene-1', function: 'value', requestedDescription: '事实' }, { shotId: 'scene-2', function: 'call_to_action', requestedDescription: '行动' }] });

function workflowInput(ids: string[]) {
  return { taskId: workflowTask.taskId, taskVersion: '1', taskStatus: 'plan_review' as const, brief, sources: [], factSourceRefs: [], assetSupplyPlan: supply, referenceAnalysis: null, replicationScript: null, programRef: { type: 'social_program', id: 'program-1', version: 2 }, enterpriseProfileRef: weeklyPackage.enterpriseProfileRef!, weeklyPackage, weeklyWorkflowTask: workflowTask as any, publicationTask: publicationTask as any, businessGoal: goal, referenceSelection: selection(ids), selectedHandoffs: ids.map((id, index) => handoff(id, index ? 'visual_rhythm' : 'primary_structure')) };
}

test('authoritative adapter keeps ordinary multi-reference selection and frozen weekly facts', () => {
  const workflow = buildAuthoritativeSocialContentWorkflow(workflowInput(['candidate-1', 'candidate-2']));
  assert.equal(workflow.inspirationHandoffs.length, 2);
  assert.equal(workflow.weeklyPackage?.packageId, weeklyPackage.packageId);
  assert.deepEqual(workflow.directorBrief.accountRefs, ['account-1']);
  assert.deepEqual(workflow.directorBrief.factSourceRefs, ['enterprise_fact:fact-1@3']);
  assert.equal(workflow.directorBrief.callToAction, '提交询盘');
});

test('single-source fidelity fails closed unless T4 selected one production-ready primary', () => {
  const input: any = workflowInput(['candidate-1', 'candidate-2']);
  input.brief = { ...brief, creationMode: 'viral_replication', referenceMode: 'single_source_fidelity' };
  input.replicationContext = { referenceMode: 'single_source_fidelity' };
  assert.throws(() => buildAuthoritativeSocialContentWorkflow(input), /fidelity_primary_reference_required/);
});

test('DirectorBrief blocks overlapping scenes and dialogue that cannot fit the shot', () => {
  const input: any = workflowInput(['candidate-1']);
  input.replicationScript = {
    version: '1', referenceAnalysisId: 'analysis-candidate-1', status: 'confirmed', primaryHookId: 'hook', hookOptions: [],
    shots: [
      { shotId: 'scene-1', referenceShotId: null, startSeconds: 0, endSeconds: 1, purpose: 'value', visualInstruction: '事实', spokenText: '这是一段明显无法在一秒内完成的超长口播文案', captionText: null, audioAndTransition: null, fidelityPoints: [], mustDifferPoints: [], materialPlan: supply.shots[0], lockedRegions: [], risks: [] },
      { shotId: 'scene-2', referenceShotId: null, startSeconds: 0.5, endSeconds: 2, purpose: 'call_to_action', visualInstruction: '行动', spokenText: null, captionText: null, audioAndTransition: null, fidelityPoints: [], mustDifferPoints: [], materialPlan: supply.shots[1], lockedRegions: [], risks: [] },
    ], structureFidelitySummary: '', originalityDifferenceSummary: '', createdAt: '2026-09-26T00:00:00.000Z',
  };
  const workflow = buildAuthoritativeSocialContentWorkflow(input);
  assert.equal(workflow.directorBrief.status, 'blocked');
  assert.equal(workflow.executionPlanReview.approved, false);
});

class MemoryRepository implements Starter198Repository {
  rows = new Map<string, StarterRecord[]>();
  async list(collection: any, tenantId: string, query: any = {}) { const all = (this.rows.get(collection) ?? []).filter(row => row.tenant_id === tenantId); const items = all.filter(row => Object.entries(query.where ?? {}).every(([key, value]) => row[key] === value)); return { page: 1, perPage: 500, totalItems: items.length, totalPages: 1, items }; }
  async get() { return null; }
  async create(collection: any, tenantId: string, data: Record<string, unknown>) { const row = { id: `${collection}-${(this.rows.get(collection) ?? []).length + 1}`, tenant_id: tenantId, ...data }; this.rows.set(collection, [...(this.rows.get(collection) ?? []), row]); return row; }
  async update() { return; }
  async access(): Promise<any> { throw new Error('unused'); }
}

test('persists independent versions, preserves full lineage and invalidates only affected fact scenes', async () => {
  const workflow = buildAuthoritativeSocialContentWorkflow(workflowInput(['candidate-1', 'candidate-2']));
  const lineage = buildSocialContentAuthorityLineage({ version: '1', programRef: { type: 'social_program', id: 'program-1', version: 2 }, packageRef: { type: 'weekly_operating_package', id: 'package-1', version: 4 }, weeklyTaskRef: workflowTask.taskRef, publicationTaskRef: { type: 'weekly_publication_task', id: publicationTask.publicationTaskId, version: 4 }, businessGoalRef: weeklyPackage.businessContentGoalRef!, enterpriseProfileRef: weeklyPackage.enterpriseProfileRef!, enterpriseFactRefs: [fact], referenceSelectionRef: { type: 'reference_selection', id: 'selection-1', version: 1 }, candidateEvidenceRefs: [{ type: 'candidate_evidence', id: 'evidence-candidate-1', version: 2 }, { type: 'candidate_evidence', id: 'evidence-candidate-2', version: 2 }], inspirationHandoffs: workflow.inspirationHandoffs, directorBrief: workflow.directorBrief, now: new Date('2026-09-26T01:00:00.000Z') });
  const repository = new MemoryRepository();
  await persistAuthoritativeContentBundle({ repository, tenantId: 'tenant-1', lineage, handoffs: workflow.inspirationHandoffs, directorBrief: workflow.directorBrief });
  await persistAuthoritativeContentBundle({ repository, tenantId: 'tenant-1', lineage, handoffs: workflow.inspirationHandoffs, directorBrief: workflow.directorBrief });
  assert.equal(repository.rows.get(STARTER_COLLECTIONS.socialInspirationHandoffVersions)?.length, 2);
  assert.equal(repository.rows.get(STARTER_COLLECTIONS.socialDirectorBriefVersions)?.length, 1);
  assert.equal(repository.rows.get(STARTER_COLLECTIONS.socialContentLineage)?.length, 1);
  const directorBrief = { ...workflow.directorBrief, scenes: workflow.directorBrief.scenes.map((scene, index) => ({ ...scene, truthBoundary: { ...scene.truthBoundary, confirmedFactRefs: index === 0 ? ['enterprise_fact:fact-1@3'] : [] } })) } as SocialDirectorBrief;
  const invalidated = invalidateSocialContentLineage({ lineage, directorBrief, next: { packageRef: lineage.packageRef, weeklyTaskRef: lineage.weeklyTaskRef, businessGoalRef: lineage.businessGoalRef, enterpriseProfileRef: lineage.enterpriseProfileRef, enterpriseFactRefs: [{ ...fact, version: 4 }], referenceSelectionRef: lineage.referenceSelectionRef, candidateEvidenceRefs: lineage.candidateEvidenceRefs } });
  assert.equal(invalidated.invalidation.status, 'partially_invalid');
  assert.deepEqual(invalidated.invalidation.affectedObjects, ['director_brief']);
  assert.deepEqual(invalidated.invalidation.affectedSceneIds, ['scene-1']);
});

test('routes production reasons back to weekly work or the reshoot queue idempotently', async () => {
  const workflow = buildAuthoritativeSocialContentWorkflow(workflowInput(['candidate-1']));
  const lineage = buildSocialContentAuthorityLineage({ version: '1', programRef: { type: 'social_program', id: 'program-1', version: 2 }, packageRef: { type: 'weekly_operating_package', id: 'package-1', version: 4 }, weeklyTaskRef: workflowTask.taskRef, publicationTaskRef: { type: 'weekly_publication_task', id: 'publication-1', version: 4 }, businessGoalRef: weeklyPackage.businessContentGoalRef!, enterpriseProfileRef: weeklyPackage.enterpriseProfileRef!, enterpriseFactRefs: [fact], referenceSelectionRef: { type: 'reference_selection', id: 'selection-1', version: 1 }, candidateEvidenceRefs: [{ type: 'candidate_evidence', id: 'evidence-candidate-1', version: 2 }], inspirationHandoffs: workflow.inspirationHandoffs, directorBrief: workflow.directorBrief });
  assert.deepEqual(['asset_missing', 'continuity', 'dialogue', 'goal_degraded'].map(reason => routeProductionReturn({ lineage, reason: reason as any }).destination), ['reshoot_queue', 'reshoot_queue', 'weekly_task', 'weekly_task']);
  const repository = new MemoryRepository(); const item = routeProductionReturn({ lineage, reason: 'asset_missing', sceneId: 'scene-1' });
  await persistProductionReturn(repository, 'tenant-1', item); await persistProductionReturn(repository, 'tenant-1', item);
  assert.equal(repository.rows.get(STARTER_COLLECTIONS.socialContentReworkQueue)?.length, 1);
});
