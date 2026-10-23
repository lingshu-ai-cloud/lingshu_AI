import assert from 'node:assert/strict';
import test from 'node:test';
import type { DataStore, ListQuery, ListResult, Record_ } from '../storage/datastore.js';
import { SOCIAL_WORK_PACKAGE_KINDS } from '../../shared/contracts/socialContentWorkflow.js';
import { SOCIAL_IMAGE_HARD_CHECKS } from '../../shared/contracts/socialImageCreation.js';
import { socialImageHookFactorIssues, type SocialImageHookFactorSpec } from '../../shared/contracts/socialImageProduction.js';
import { defaultBrief } from '../starter198/socialContentTaskSupport.js';
import { STARTER_COLLECTIONS } from '../starter198/repository.js';
import { readSocialImageTask, updateSocialImageTask } from './socialImageTask.js';
import {
  createOrResumeBoundSocialImageRun,
  createSocialImageDeliveryPackage,
  decideSocialImageCandidate,
  recordSocialImageNodeOutput,
  recordSocialImageDirectorReview,
} from './socialImageProductionRun.js';
import { projectSocialImageProductionSnapshot } from './socialImageProductionRuntime.js';
import { compileLuxuryProductHero } from './templates/luxuryProductHero.js';

class MemoryStore implements DataStore {
  private sequence = 0;
  readonly rows = new Map<string, Record_[]>();
  async getById<T = Record_>(collection: string, id: string): Promise<T | null> {
    return (this.rows.get(collection) || []).find(item => item.id === id) as T || null;
  }
  async create<T = Record_>(collection: string, data: Record<string, unknown>): Promise<T | null> {
    const rows = this.rows.get(collection) || [];
    const id = String(data.id || `row-${++this.sequence}`);
    if (rows.some(item => item.id === id)) return null;
    const record = { id, ...structuredClone(data) } as Record_;
    this.rows.set(collection, [...rows, record]);
    return record as T;
  }
  async update(collection: string, id: string, data: Record<string, unknown>): Promise<boolean> {
    const rows = this.rows.get(collection) || [];
    const index = rows.findIndex(item => item.id === id);
    if (index < 0) return false;
    rows[index] = { ...rows[index], ...structuredClone(data) };
    return true;
  }
  async delete(): Promise<boolean> { return false; }
  async list<T = Record_>(collection: string, query: ListQuery = {}): Promise<ListResult<T>> {
    const all = (this.rows.get(collection) || []).filter(row => Object.entries(query.where || {})
      .every(([key, value]) => String(row[key] ?? '') === String(value)));
    return { items: all as T[], totalItems: all.length, totalPages: all.length ? 1 : 0,
      page: query.page || 1, perPage: query.perPage || 20 };
  }
}

async function fixture() {
  const store = new MemoryStore();
  const now = '2026-10-24T02:00:00.000Z';
  await store.create(STARTER_COLLECTIONS.socialContentTasks, {
    id: 'content-row', tenant_id: 'tenant-a', task_id: 'content-a', status: 'plan_review', version: '7',
    brief: defaultBrief({ title: '秋季产品主视觉', objective: '让品牌采购理解产品低敏定位', mode: 'instant',
      productId: 'product-a', productRef: '产品 A', audience: '品牌采购', platforms: ['instagram'], languages: ['zh'],
      formats: ['social_image'], aspectRatio: '4:5', creationMode: 'material_processing' }),
    task_mode: 'instant', theme_selection: '', script_baseline: '', director_plan: '', material_requirements: [],
    package_selection: SOCIAL_WORK_PACKAGE_KINDS.map(kind => ({ kind, packageKey: kind, version: '1', name: kind })),
    run_id: '', weekly_plan_id: '', source_count: 0, knowledge_source_count: 0, material_source_count: 0,
    artifact_count: 0, approved_artifact_count: 0, delivery_package_count: 0, publication_count: 0,
    metric_submission_count: 0, created_at: now, updated_at: now,
  });
  return { store, now };
}

test('ContentTask binding is deterministic, resumable and rejects changed scope', async () => {
  const { store, now } = await fixture();
  const input = { contentTaskId: 'content-a', expectedContentTaskVersion: '7', idempotencyKey: 'assistant-message-001',
    entrySource: 'assistant' as const, imageType: 'product_poster' as const };
  const first = await createOrResumeBoundSocialImageRun(store, 'tenant-a', input, now);
  assert.equal(first.resumed, false);
  assert.equal(first.task.schemaVersion, 'social-image-creation.v3');
  assert.equal(first.task.productionRuntime?.binding?.contentTaskId, 'content-a');
  assert.equal(first.task.deliverySpec.platform, 'instagram');
  assert.equal(first.task.deliverySpec.aspectRatio, '4:5');
  const replay = await createOrResumeBoundSocialImageRun(store, 'tenant-a', input, now);
  assert.equal(replay.resumed, true);
  assert.equal(replay.task.id, first.task.id);
  await assert.rejects(createOrResumeBoundSocialImageRun(store, 'tenant-a', { ...input, imageType: 'brand_news' }, now),
    /social_image_run_scope_conflict/);
  const staged = await updateSocialImageTask(store, 'tenant-a', first.task.id, replay.task.version, { outputs: [{
    id: 'candidate-before-content-change', role: 'single', label: '旧业务输入候选', state: 'quality_checking', version: 1,
    qualityChecks: SOCIAL_IMAGE_HARD_CHECKS.map(key => ({ key, verdict: 'uncertain', severity: 'hard', note: '旧候选' })),
  }] });
  assert.equal(staged.kind, 'updated');
  const contentRow = await store.getById<Record_>(STARTER_COLLECTIONS.socialContentTasks, 'content-row');
  await store.update(STARTER_COLLECTIONS.socialContentTasks, 'content-row', { version: '8',
    brief: { ...(contentRow!.brief as Record<string, unknown>), objective: '更新后的统一业务主张' } });
  const refreshed = await createOrResumeBoundSocialImageRun(store, 'tenant-a', { ...input, expectedContentTaskVersion: '8' }, now);
  assert.equal(refreshed.task.productionRuntime?.binding?.contentTaskVersion, '8');
  assert.equal(refreshed.task.contentBrief.coreClaim, '更新后的统一业务主张');
  assert.equal(refreshed.task.outputs[0]?.state, 'superseded');
  assert.equal(projectSocialImageProductionSnapshot(refreshed.task).currentStatus, 'stale');
  await assert.rejects(createOrResumeBoundSocialImageRun(store, 'tenant-b', input, now), /social_image_content_task_not_found/);
});

test('V3 approval requires independent review, exact bytes and explicit user evidence', async () => {
  const { store, now } = await fixture();
  const created = (await createOrResumeBoundSocialImageRun(store, 'tenant-a', {
    contentTaskId: 'content-a', expectedContentTaskVersion: '7', idempotencyKey: 'assistant-message-002', entrySource: 'assistant',
  }, now)).task;
  const output = { id: 'candidate-a', role: 'single' as const, label: '主视觉', state: 'quality_checking' as const,
    mediaUrl: '/api/overseas/social-images/renders/candidate.png', version: 1,
    qualityChecks: SOCIAL_IMAGE_HARD_CHECKS.map(key => ({ key, verdict: 'pass' as const, severity: 'hard' as const,
      checker: 'deterministic' as const, note: 'fixture pass' })),
  };
  const ready = await updateSocialImageTask(store, 'tenant-a', created.id, created.version, {
    outputs: [output], status: 'review_required', step: 'review',
    renderBrief: { headline: '低敏产品方案', subheadline: '面向品牌采购', originBadge: '', trustBadges: [], sellingPoints: [],
      process: [], categories: [], bottomBar: [], cta: '了解产品' },
    imageTextContract: { ...created.imageTextContract, headline: '低敏产品方案', caption: '基于企业资料' },
    layerGraph: compileLuxuryProductHero({ task: { ...created, imageTextContract: { ...created.imageTextContract, headline: '低敏产品方案' } },
      productId: 'product-a', productName: '产品 A' }),
  });
  assert.equal(ready.kind, 'updated');
  if (ready.kind !== 'updated') return;
  const forged = await updateSocialImageTask(store, 'tenant-a', created.id, ready.task.version, { status: 'approved' });
  assert.equal(forged.kind, 'invalid');
  const reviewed = await recordSocialImageDirectorReview({ store, tenantId: 'tenant-a', taskId: created.id,
    expectedVersion: ready.task.version, decision: { schemaVersion: 'social-image-director-review.v1',
      decision: 'accept_for_user_review', candidateId: output.id, candidateVersion: output.version,
      passedCriteria: ['核心主张清晰'], failedCriteria: [], factorResults: [], problemRegions: [], reasonCodes: [],
      repairInstructions: [], reviewConfidence: .92, reviewedAt: now } });
  const contentHash = 'a'.repeat(64);
  const accepted = await decideSocialImageCandidate({ store, tenantId: 'tenant-a', userId: 'user-a', taskId: created.id,
    expectedVersion: reviewed.version, candidateId: output.id, candidateVersion: output.version,
    expectedContentHash: contentHash, actualContentHash: contentHash, decision: 'approved', now });
  assert.equal(accepted.task.status, 'approved');
  assert.equal(accepted.task.publishable, true);
  assert.equal(accepted.decision.source, 'explicit_user_action');
  assert.equal(accepted.task.approvedArtifact?.contentTaskId, 'content-a');
  assert.equal(projectSocialImageProductionSnapshot(accepted.task).currentNode, 'delivery');
  assert.equal((await readSocialImageTask(store, 'tenant-a', created.id))?.approvedArtifact?.contentHash, contentHash);
  const delivered = await createSocialImageDeliveryPackage({ store, tenantId: 'tenant-a', taskId: created.id,
    expectedVersion: accepted.task.version, now });
  assert.equal(delivered.deliveryPackage.status, 'ready');
  assert.equal(delivered.task.publishable, true);
  assert.equal(projectSocialImageProductionSnapshot(delivered.task).currentStatus, 'completed');
  const replayedDelivery = await createSocialImageDeliveryPackage({ store, tenantId: 'tenant-a', taskId: created.id,
    expectedVersion: delivered.task.version, now });
  assert.equal(replayedDelivery.task.version, delivered.task.version);
  assert.equal(replayedDelivery.deliveryPackage.packageId, delivered.deliveryPackage.packageId);
});

test('explicit rejection may request repair before hard quality or director approval', async () => {
  const { store, now } = await fixture();
  const created = (await createOrResumeBoundSocialImageRun(store, 'tenant-a', {
    contentTaskId: 'content-a', expectedContentTaskVersion: '7', idempotencyKey: 'assistant-message-reject', entrySource: 'assistant',
  }, now)).task;
  const output = { id: 'candidate-reject', role: 'single' as const, label: '待修改主视觉', state: 'quality_checking' as const,
    mediaUrl: '/api/overseas/social-images/renders/reject.png', version: 1,
    qualityChecks: SOCIAL_IMAGE_HARD_CHECKS.map(key => ({ key, verdict: 'uncertain' as const, severity: 'hard' as const,
      checker: 'deterministic' as const, note: '尚未完成检查' })),
  };
  const staged = await updateSocialImageTask(store, 'tenant-a', created.id, created.version, {
    outputs: [output], status: 'review_required', step: 'review',
  });
  assert.equal(staged.kind, 'updated');
  if (staged.kind !== 'updated') return;
  const rejected = await decideSocialImageCandidate({ store, tenantId: 'tenant-a', userId: 'user-a', taskId: created.id,
    expectedVersion: staged.task.version, candidateId: output.id, candidateVersion: output.version,
    expectedContentHash: 'c'.repeat(64), actualContentHash: 'c'.repeat(64), decision: 'rejected', note: '产品主体过小', now });
  assert.equal(rejected.task.outputs[0]?.state, 'repair_required');
  assert.equal(rejected.task.status, 'review_required');
  assert.equal(rejected.task.approvalDecisions?.at(-1)?.decision, 'rejected');
  assert.equal(rejected.task.approvedArtifact, undefined);
});

test('formal node outputs survive restart and stale their downstream evidence', async () => {
  const { store, now } = await fixture();
  const created = (await createOrResumeBoundSocialImageRun(store, 'tenant-a', {
    contentTaskId: 'content-a', expectedContentTaskVersion: '7', idempotencyKey: 'assistant-message-003', entrySource: 'assistant',
  }, now)).task;
  const directorValue = (headline: string) => ({ objective: '产品认知', singleCoreClaim: headline, headline, supportingText: '',
    caption: '', cta: '', requiredFacts: [], prohibitedInferences: [], visualMustShow: ['产品 A'], visualMustNotImply: [],
    compositionIntent: '产品居中', imageTextRelation: 'image_contextualizes_copy', visualProof: 'product_hero',
    brandAndOriginalityRules: [], acceptanceCriteria: [{ criterionId: 'product', observableTarget: '产品清晰', validator: 'human_review' }],
    factorSpecRef: null, adaptationSpecRef: null });
  const director = await recordSocialImageNodeOutput({ store, tenantId: 'tenant-a', taskId: created.id,
    expectedVersion: created.version, nodeId: 'director_brief', status: 'completed',
    value: directorValue('第一版主张'), inputRefs: [], createdBy: { kind: 'agent', id: 'image_director' },
    taskPatch: { step: 'plan', renderBrief: { headline: '第一版主张', subheadline: '', originBadge: '', trustBadges: [],
      sellingPoints: [], process: [], categories: [], bottomBar: [], cta: '' },
    imageTextContract: { ...created.imageTextContract, headline: '第一版主张' } }, now });
  const planned = await recordSocialImageNodeOutput({ store, tenantId: 'tenant-a', taskId: created.id,
    expectedVersion: director.version, nodeId: 'execution_plan', status: 'completed', value: {
      productionStrategy: 'compose_assets', selectedAssetRefs: [], assetRoles: [], renderRoute: 'layered_compositor',
      candidateCount: 1, layerPlan: [], estimatedCost: { currency: 'CNY', amount: 0 }, estimatedDurationSeconds: 10,
      fallbackRoutes: [], unmetCriteria: [],
    },
    inputRefs: [{ objectType: 'social-image-node-envelope.v1', id: director.productionRuntime!.nodeOutputs.at(-1)!.id,
      version: 1, contentHash: director.productionRuntime!.nodeOutputs.at(-1)!.contentHash }],
    createdBy: { kind: 'agent', id: 'content_agent' }, now });
  const revised = await recordSocialImageNodeOutput({ store, tenantId: 'tenant-a', taskId: created.id,
    expectedVersion: planned.version, nodeId: 'director_brief', status: 'completed', value: directorValue('第二版主张'),
    inputRefs: [], createdBy: { kind: 'agent', id: 'image_director' },
    taskPatch: { step: 'plan', renderBrief: { headline: '第二版主张', subheadline: '', originBadge: '', trustBadges: [],
      sellingPoints: [], process: [], categories: [], bottomBar: [], cta: '' },
    imageTextContract: { ...planned.imageTextContract, headline: '第二版主张' } }, now });
  assert.equal(revised.productionRuntime?.nodeOutputs.filter(output => output.nodeId === 'execution_plan').at(-1)?.status, 'stale');
  assert.equal(projectSocialImageProductionSnapshot(revised).currentNode, 'execution_plan');
  assert.equal(projectSocialImageProductionSnapshot(revised).currentStatus, 'stale');
  const restarted = new MemoryStore();
  for (const [collection, rows] of store.rows) restarted.rows.set(collection, structuredClone(rows));
  const recovered = await readSocialImageTask(restarted, 'tenant-a', created.id);
  assert.ok(recovered);
  assert.equal(projectSocialImageProductionSnapshot(recovered!).currentStatus, 'stale');
  assert.equal(recovered?.productionRuntime?.events.at(-1)?.nodeId, 'execution_plan');
});

test('hook factors are evidence-bound, capped at five and the fifth must be independent', () => {
  const ref = { objectType: 'image_region', id: 'region-a', version: 1, contentHash: 'b'.repeat(64) };
  const factor = (rank: 1 | 2 | 3 | 4 | 5) => ({ factorId: `factor-${rank}`, regionRefs: ['region-a'], priorityRank: rank,
    category: 'visual', observableDescription: `observable ${rank}`, causalRole: 'attention' as const, importance: 'high' as const,
    evidenceRefs: [ref], analysisConfidence: .8, causalConfidence: .4, effectStatus: 'visual_hypothesis' as const,
    transferability: 'high' as const, validator: { kind: 'saliency_order' as const, observableTarget: 'first fixation' } });
  const invalid: SocialImageHookFactorSpec = { schemaVersion: 'social-image-hook-factor-spec.v1',
    factors: [factor(1), factor(2), factor(3), factor(4), factor(5)], ordinaryVisualNotes: [], evidenceGaps: [] };
  assert.ok(socialImageHookFactorIssues(invalid).includes('social_image_hook_fifth_not_independent'));
  invalid.factors[4] = { ...invalid.factors[4]!, causalRole: 'conversion', validator: { kind: 'human_review', observableTarget: 'CTA clarity' } };
  assert.deepEqual(socialImageHookFactorIssues(invalid), []);
  invalid.factors.push({ ...factor(5), factorId: 'factor-6' });
  assert.ok(socialImageHookFactorIssues(invalid).includes('social_image_hook_count_invalid'));
  assert.doesNotThrow(() => socialImageHookFactorIssues({
    schemaVersion: 'social-image-hook-factor-spec.v1', factors: undefined, ordinaryVisualNotes: [], evidenceGaps: undefined,
  } as unknown as SocialImageHookFactorSpec));
});
