import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {runVisualFfmpeg} from '../lib/renderVisualQuality.js';
import type {DataStore, ListQuery, Record_} from '../storage/datastore.js';
import {createStarter198Repository, STARTER_COLLECTIONS} from './repository.js';
import {STARTER_198_CAPABILITIES} from '../../shared/contracts/starter198.js';
import {createSocialContentTask, startSocialContentTask, addSocialTaskSource} from './socialContentTasks.js';
import {parseStoredSocialScriptBaseline} from './socialContentScriptBaseline.js';
import {readSocialTaskDetail} from './socialContentRecords.js';
import {resolveSocialTaskReferenceScript} from './socialContentScriptResolvers.js';
import {parseCreateSocialTask, parseSocialSource} from './socialContentValidation.js';
import {createStarter198OrchestratorQueue} from './orchestratorQueue.js';
import {normalizeSceneVisualContract} from '../../shared/sceneVisualContract.js';
import {buildMaterialScriptAnalysis} from '../../shared/materialScriptAnalysis.js';
type Row = Record_ & Record<string, unknown>;

class MemoryStore implements DataStore {
  readonly rows = new Map<string, Row[]>();
  private sequence = 0;

  constructor(collections: string[]) {
    for (const name of collections) this.rows.set(name, []);
  }

  async getById<T = Record_>(collection: string, id: string): Promise<T | null> {
    return (this.rows.get(collection)?.find(row => row.id === id) as T | undefined) ?? null;
  }

  async create<T = Record_>(collection: string, data: Record<string, unknown>): Promise<T | null> {
    const bucket = this.rows.get(collection) ?? [];
    const duplicate = collection === 'durable_operation_leases'
      ? bucket.some(row => row.tenant_id === data.tenant_id && row.lease_scope === data.lease_scope && row.subject_id === data.subject_id)
      : collection === 'starter_social_content_operations'
        ? bucket.some(row => row.tenant_id === data.tenant_id && row.idempotency_key === data.idempotency_key)
        : collection === 'starter_social_content_tasks'
          ? bucket.some(row => row.tenant_id === data.tenant_id && row.create_idempotency_key === data.create_idempotency_key)
          : 'last_operation_id' in data
            ? bucket.some(row => row.tenant_id === data.tenant_id && row.last_operation_id === data.last_operation_id)
            : false;
    if (duplicate) return null;
    this.sequence += 1;
    const row = { id: String(data.id || `row${String(this.sequence).padStart(12, '0')}`), ...structuredClone(data) } as Row;
    bucket.push(row);
    this.rows.set(collection, bucket);
    return structuredClone(row) as T;
  }

  async update(collection: string, id: string, data: Record<string, unknown>): Promise<boolean> {
    const row = this.rows.get(collection)?.find(item => item.id === id);
    if (!row) return false;
    Object.assign(row, structuredClone(data));
    return true;
  }

  async delete(collection: string, id: string): Promise<boolean> {
    const bucket = this.rows.get(collection) ?? [];
    const index = bucket.findIndex(row => row.id === id);
    if (index < 0) return false;
    bucket.splice(index, 1);
    return true;
  }

  async list<T = Record_>(collection: string, query: ListQuery = {}) {
    let items = (this.rows.get(collection) ?? []).filter(row => Object.entries(query.where ?? {})
      .every(([key, value]) => String(row[key] ?? '') === String(value)));
    if (query.sort) {
      const descending = query.sort.startsWith('-');
      const key = descending ? query.sort.slice(1) : query.sort;
      items = [...items].sort((left, right) => String(left[key] ?? '').localeCompare(String(right[key] ?? '')) * (descending ? -1 : 1));
    }
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 20;
    return {
      items: items.slice((page - 1) * perPage, page * perPage).map(item => structuredClone(item)) as T[],
      totalItems: items.length,
      totalPages: Math.ceil(items.length / perPage),
      page,
      perPage,
    };
  }
}

const limits = {
  workspaceCount: 1, brandCount: 1, memberCount: 3, agentTeamCount: 1,
  productCount: 1, marketCount: 1, buyerPersonaCount: 2, languageCount: 2,
  primaryPlatformCount: 2, concurrentRunCount: 1, contentArtifactCountPerCycle: 20,
  contentRevisionCountPerCycle: 3, publicationPackageCountPerContent: 2,
  assistedSessionCount: 5, inquiryAiCountPerCycle: 100, quoteDraftCountPerCycle: 20,
  highCostVideoCount: 0, budgetCnyPerCycle: 100,
  agentBudgetCny: { orchestrator: 25, content: 25, traffic: 25, sales: 25 },
};

async function verifyAdmission(cachedReference: boolean) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'typed-admission-'));
  const tenantId = 'typed-local-tenant';
  const store = new MemoryStore([...Object.values(STARTER_COLLECTIONS), 'durable_operation_leases', 'trend_videos']);
  const now = new Date('2026-09-14T08:00:00.000Z');
  await store.create(STARTER_COLLECTIONS.access, {id: 'access', tenant_id: tenantId,
    product_profile: 'starter_198', profile_version: 'starter_198.v1', entitlement_snapshot_id: 'snapshot',
    feature_entitlements: STARTER_198_CAPABILITIES.map(capability => ({capability, enabled: true})),
    resource_limits: limits, status: 'active', cycle_started_at: '2026-09-01T00:00:00.000Z',
    cycle_ends_at: '2026-10-01T00:00:00.000Z', updated_at: now.toISOString()});
  const materials: any[] = [];
  const repository = createStarter198Repository(store, {materialLibrary: async () => ({items: materials} as never)});
  try {
    const created = await createSocialContentTask({repository, tenantId, userId: 'operator',
      idempotencyKey: 'typed-create', now,
      value: parseCreateSocialTask({title: '本地动作完整覆盖', objective: '制作完整产品内容', mode: 'instant',
        themeId: 'product_value', creationMode: cachedReference ? 'viral_replication' : 'material_processing', productRef: 'SKU-1', perItemBudgetCny: 10})});
    assert.equal(created.brief.materialRoutingPolicyVersion, 'type-aware.v1');
    let currentVersion = created.version;
    let currentDetail = created;
    if (cachedReference) {
      const descriptions = ['工厂流水线生产产品', '手持产品包装晃一圈', '消费者在生活场景使用产品', '产品包装静止展示'];
      const boundaries = [0, 9, 18, 28, 38];
      const analysis = {analysisRunId: 'cached-38-verified', contentSha256: 'a'.repeat(64), analysisMode: 'exact', analysisQuality: 'video',
        gemini: {theme: '产品介绍', scriptDetails15s: descriptions.map((visual, i) => ({time: `${boundaries[i]}-${boundaries[i + 1]}`,
          purpose: i === 0 ? '工厂钩子' : i === 3 ? '产品行动引导' : '产品展示', visual,
          shot: '近景', camera: '固定镜头', dialogue: visual, confidence: .99,
          hookMotionEvidence: {status: 'verified', observations: [{time: boundaries[i]}, {time: boundaries[i + 1]}],
            transitions: [{from: boundaries[i], to: boundaries[i + 1], action: visual}]}})),
          audioTranscript: {segments: descriptions.map((text, i) => ({start: boundaries[i], end: boundaries[i + 1], text,
            timingPrecision: 'phrase', provenance: 'fixture-cached-asr'}))}}};
      await store.create('trend_videos', {id: 'cached-38', tenantId, sourceUrl: 'https://example.com/fixture-cached-38',
        duration: 38, aiAnalysis: JSON.stringify(analysis)});
      const selected = await addSocialTaskSource({repository, tenantId, userId: 'operator', taskId: created.taskId,
        idempotencyKey: 'select-cached-38', now,
        value: parseSocialSource({kind: 'reference_link', sourceRef: 'https://example.com/fixture-cached-38',
          label: '已有38秒精确分析', cachedReferenceRecordId: 'cached-38'}), referenceResolver: resolveSocialTaskReferenceScript});
      currentVersion = selected.task.version;
      currentDetail = selected.task;
      assert.equal(selected.task.referenceVideoAnalysis?.durationSeconds, 38);
      assert.ok(selected.task.replicationScript?.shots.length);
    }
    const row = store.rows.get(STARTER_COLLECTIONS.socialContentTasks)!.find(item => item.task_id === created.taskId)!;
    const baseline = parseStoredSocialScriptBaseline(row.script_baseline)!;
    const sceneDefinitions = baseline.scenes.map(scene => {
      const reference = currentDetail.referenceVideoAnalysis?.shots.find(shot => shot.shotId === scene.inspirationNodeId);
      const action = reference?.visualDescription || scene.action;
      const type = /工厂|生产线|流水线/.test(action) ? 'factory'
        : /消费者|使用|试用|生活/.test(action) ? 'person_usage' : 'product';
      return {...scene, action, reference, type, duration: reference ? reference.endSeconds - reference.startSeconds : 4,
        interaction: type === 'factory' ? 'factory_process' : type === 'person_usage' ? 'person_using_product'
          : /手持|手握|拿/.test(action) ? 'person_holding_product' : 'product_only_display'};
    });
    for (const scene of sceneDefinitions) {
      const file = path.join(root, `${scene.sceneId}.mp4`);
      const ffmpeg = await runVisualFfmpeg( ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=160x284:r=12',
        '-t', String(scene.duration), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', file], false, {timeoutMs: 120000});
      assert.equal(ffmpeg.ok, true, ffmpeg.stderr);
      const visual = normalizeSceneVisualContract(scene.reference?.visualContract ?? {subjects: scene.type === 'factory' ? ['factory'] : scene.interaction === 'product_only_display' ? ['product'] : ['person', 'product'],
        interaction: {kind: scene.interaction, description: scene.action}, action: {path: scene.action}, productRef: 'SKU-1', productPolicy: 'locked'});
      const analysis = buildMaterialScriptAnalysis({materialId: scene.sceneId, name: scene.subject,
        sourceRevision: 'fixture-v1', duration: scene.duration, productRef: 'SKU-1',
        segments: [{id: scene.sceneId, start: 0, end: scene.duration, confidence: .99,
          boundaryConfidence: .99, cleanEntry: true, cleanExit: true,
          subject: [scene.subject], action: scene.action, observedFacts: [scene.subject, scene.action, scene.voiceover, scene.narration], visualContract: visual}]});
      analysis.shots[0]!.visualContract = visual;
      analysis.shots[0]!.materialRoles = [scene.type as never];
      materials.push({id: scene.sceneId, tenantId, type: 'video', sourceType: 'social_task_upload',
        name: scene.subject, url: file, duration: scene.duration, productRef: 'SKU-1', productName: 'SKU-1',
        sourceRevision: 'fixture-v1', scriptAnalysis: analysis, rightsStatus: 'owned', width: 160, height: 284,
        contentSha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
        commercialUseApproved: true, licenseEvidence: `fixture-owned:${scene.sceneId}`});
    }
    const initial = await readSocialTaskDetail({repository, tenantId, taskId: created.taskId});
    assert.ok(initial?.assetSupplyPlan);
    assert.ok(initial.assetSupplyPlan.shots.every(shot => shot.materialRouting?.localMatch.state === 'matched'), JSON.stringify({baseline: baseline.scenes, plan: initial.assetSupplyPlan.shots}));
    const inspected = await readSocialTaskDetail({repository, tenantId, taskId: created.taskId});
    if (cachedReference) {
      const review = inspected?.agentWorkflow?.executionPlanReview;
      assert.ok(review);
      assert.ok(review.sceneResults.every(scene => scene.approved), JSON.stringify(review));
      assert.equal(review.approved, false,
        'local semantic matches do not grant missing original-reference extraction or presenter rights');
      const actualQueue = createStarter198OrchestratorQueue({repository, dataStore: store, now: () => now});
      await assert.rejects(startSocialContentTask({repository, tenantId, userId: 'operator', taskId: created.taskId,
        expectedVersion: currentVersion, idempotencyKey: 'typed-start-blocked-reference', now, orchestratorQueue: actualQueue}),
        /social_content_execution_director_review_required/);
      assert.equal(store.rows.get(STARTER_COLLECTIONS.runs)!.length, 0);
      return;
    }
    assert.equal(inspected?.agentWorkflow?.executionPlanReview?.approved, true, JSON.stringify({execution: inspected?.agentWorkflow?.executionPlan, director: inspected?.agentWorkflow?.directorBrief, review: inspected?.agentWorkflow?.executionPlanReview}));
    const actualQueue = createStarter198OrchestratorQueue({repository, dataStore: store, now: () => now});
    const admitted = await startSocialContentTask({repository, tenantId, userId: 'operator', taskId: created.taskId,
      expectedVersion: currentVersion, idempotencyKey: 'typed-start', now, orchestratorQueue: actualQueue});
    if (cachedReference) assert.ok(row.replication_script, 'real cached package builder persists the script through source service');
    else assert.equal(row.replication_script ?? '', '', 'normal baseline is tested without a fabricated replication script');
    assert.equal(admitted.brief.materialRoutingPolicyVersion, 'type-aware.v1');
    assert.equal(admitted.status, 'producing');
    assert.equal(admitted.agentWorkflow?.executionPlanReview?.approved, true);
    assert.ok(admitted.assetSupplyPlan);
    assert.ok(admitted.assetSupplyPlan.shots.every(shot => shot.sourceStrategy === 'customer_real_asset'));
    assert.ok(admitted.assetSupplyPlan.shots.every(shot => shot.materialRouting?.localMatch.state === 'matched'));
    assert.deepEqual(admitted.assetSupplyPlan.shots.map(shot => shot.materialRouting?.materialType),
      cachedReference ? ['factory', 'product', 'consumer_demo', 'product'] : ['product', 'product', 'consumer_demo', 'product']);
    assert.deepEqual(row.script_baseline, baseline, 'normal create baseline is preserved verbatim');
    assert.ok(admitted.assetSupplyPlan.shots.every(shot => shot.selectedMaterialSegment
      && shot.selectedMaterialSegment.endSeconds > shot.selectedMaterialSegment.startSeconds));
    assert.equal(admitted.brief.perItemBudgetCny, 10);
    assert.equal(admitted.agentWorkflow?.executionPlan.estimatedTotalCostCny, 0);
    assert.equal(store.rows.get(STARTER_COLLECTIONS.runs)!.length, 1);
  } finally {fs.rmSync(root, {recursive: true, force: true});}
}

test('normal unaltered product_value baseline admits complete local semantic evidence', () => verifyAdmission(false));
test('normal cached38 builds matched factory/product/consumer scenes but missing original-reference gates block dispatch', () => verifyAdmission(true));
