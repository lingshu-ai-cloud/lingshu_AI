import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LangGraphTestStore } from './langgraphTestStore.js';
import { createStarter198Repository, STARTER_COLLECTIONS } from '../server/starter198/repository.js';
import { createSocialContentTask, addSocialTaskSource } from '../server/starter198/socialContentTasks.js';
import { parseCreateSocialTask, socialRequestHash } from '../server/starter198/socialContentValidation.js';
import { readSocialTaskDetail } from '../server/starter198/socialContentRecords.js';
import { prepareSocialContentRevisionPlan, startPreparedSocialContentRevision } from '../server/starter198/socialContentRevisionPlan.js';
import { createSocialProductionExecutorCheckpoint, readSocialProductionGraphDetail } from '../server/starter198/socialContentProductionGraph.js';

async function fixture(t: any) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'revision-contract-')); t.after(() => rm(root, { recursive: true, force: true }));
  const store = new LangGraphTestStore(path.join(root, 'store.json')), repository = createStarter198Repository(store);
  const tenantId = 'revision-tenant', userId = 'revision-actor';
  const created = await createSocialContentTask({ repository, tenantId, userId, idempotencyKey: 'create', value: parseCreateSocialTask({ title: '八镜独立修订', objective: '真实审核后交付', mode: 'instant', themeId: 'customization_process' }) });
  const rows = await store.list<any>(STARTER_COLLECTIONS.socialContentTasks, { where: { tenant_id: tenantId, task_id: created.taskId } });
  const analysis: any = { analysisId: 'original-analysis', version: '1', status: 'ready', referenceSourceId: 'reference-source', referenceRecordId: 'tenant-reference', rightsNotice: 'analysis only', createdAt: new Date().toISOString(), hookAnalysis: { hookOptions: [], referencePoints: [] }, shots: Array.from({ length: 37 }, (_, i) => ({ shotId: `ref-${i + 1}`, startSeconds: i, endSeconds: i + 1, function: 'value', tags: { subjects: [], sceneTypes: [], actions: [], visualStyles: [] }, visualDescription: 'Neutral product', semanticLabel: { content: 'Product' }, camera: {}, fidelityPoints: [], mustDifferPoints: [], evidence: [] })) };
  const resolved: any = { match: null, referenceVideoAnalysis: analysis, shotMaterialMap: [], replicationScript: { version: '1', referenceAnalysisId: analysis.analysisId, status: 'draft', primaryHookId: 'hook-1', hookOptions: [{ hookId: 'hook-1' }, { hookId: 'hook-2' }, { hookId: 'hook-3' }], structureFidelitySummary: 'Eight selected structural beats', originalityDifferenceSummary: 'New brand copy', createdAt: new Date().toISOString(), shots: Array.from({ length: 8 }, (_, i) => ({ shotId: `S0${i + 1}`, referenceShotId: `ref-${i + 1}`, startSeconds: i * 4, endSeconds: i * 4 + 4, purpose: 'value', spokenText: i === 0 ? 'Beauty brands, build your next cleansing product with us.' : null, visualInstruction: 'Show owned product on a neutral background.', captionText: null, materialPlan: { requestedDescription: 'Owned product' }, voiceoverReplacement: { mode: 'identity_only', replacedEntityTypes: [] }, speechLines: [{ referenceText: 'Unlicensed source sentence', draftText: 'old', sourceWords: [{ text: 'old', start: 0, end: 1 }], sourcePrecision: 'phrase' }] })) } };
  await store.update(STARTER_COLLECTIONS.socialContentTasks, rows.items[0].id, { version: '51', status: 'asset_review', run_id: 'legacy-run', artifact_count: 1, reference_video_analysis: analysis });
  await store.create(STARTER_COLLECTIONS.runs, { id: 'legacy-run', tenant_id: tenantId, status: 'waiting_external' });
  await store.create(STARTER_COLLECTIONS.tasks, { id: 'legacy-step', tenant_id: tenantId, run_id: 'legacy-run', status: 'waiting_external' });
  const artifact = await store.create<any>(STARTER_COLLECTIONS.socialContentArtifacts, { tenant_id: tenantId, task_id: created.taskId, artifact_id: 'old-artifact', version: '1', kind: 'short_video', origin: 'agent', status: 'review_required', content: { providerTaskId: 'existing-real-receipt-reference' } });
  await store.create('content_execution_jobs', { id: 'legacy-job', tenant_id: tenantId, task_id: created.taskId, run_id: 'legacy-run', status: 'succeeded', provider_receipts: { original: { taskId: 'existing-real-receipt-reference' } } });
  const detail = await readSocialTaskDetail({ repository, tenantId, taskId: created.taskId }); assert.ok(detail);
  const input = { repository, tenantId, userId, taskId: created.taskId, idempotencyKey: 'revision-8', expectedTaskVersion: '51', parentArtifactId: 'old-artifact', expectedArtifactVersion: '1', expectedBriefHash: socialRequestHash(detail.brief), expectedReferenceAnalysisHash: socialRequestHash(analysis), expectedEnterpriseFactsHash: 'fact-version', referenceSha256: 'a'.repeat(64), resolved, verifyReferenceBytes: async () => true, readEnterpriseFactsHash: async () => 'fact-version' };
  return { input, store, repository, artifact };
}

test('v51 revision fences old waiting run, preserves provider receipts and review, freezes independent eight scenes', async t => {
  const { input, store, artifact } = await fixture(t), oldJob = await store.getById('content_execution_jobs', 'legacy-job');
  const prepared = await prepareSocialContentRevisionPlan(input); assert.equal(prepared.task.version, '52'); assert.equal(prepared.task.runId, null);
  assert.equal((await store.getById<any>(STARTER_COLLECTIONS.runs, 'legacy-run'))?.status, 'cancelled');
  assert.equal((await store.getById<any>(STARTER_COLLECTIONS.tasks, 'legacy-step'))?.status, 'cancelled');
  assert.deepEqual(await store.getById(STARTER_COLLECTIONS.socialContentArtifacts, artifact.id), artifact);
  assert.deepEqual(await store.getById('content_execution_jobs', 'legacy-job'), oldJob);
  const { finishExecution, failExecution } = await import('../server/starter198/socialContentProductionRuntimeSupport.js');
  const tables = [STARTER_COLLECTIONS.socialContentTasks, STARTER_COLLECTIONS.runs, STARTER_COLLECTIONS.tasks, STARTER_COLLECTIONS.socialContentArtifacts, STARTER_COLLECTIONS.socialDeliveryPackages, STARTER_COLLECTIONS.socialPublications];
  const before = await Promise.all(tables.map(table => store.list(table)));
  await finishExecution({ ...input, runId: 'legacy-run', artifactId: 'old-artifact' });
  await failExecution({ ...input, runId: 'legacy-run', error: new Error('old callback') });
  assert.deepEqual(await Promise.all(tables.map(table => store.list(table))), before, 'superseded callbacks must not mutate the new task or publish');
  assert.equal((await prepareSocialContentRevisionPlan(input)).planHash, prepared.planHash, 'retry must not revise twice');
  const row = (await store.list<any>(STARTER_COLLECTIONS.socialContentTasks, { where: { task_id: input.taskId } })).items[0], marker = row.brief._productionRevision;
  assert.equal(marker.resolved.replicationScript.shots.length, 8);
  assert.equal(marker.resolved.replicationScript.shots[0].voiceoverReplacement, undefined);
  assert.deepEqual(marker.resolved.replicationScript.shots[0].speechLines[0].sourceWords, []);
  assert.equal(marker.resolved.replicationScript.shots[0].speechLines[0].referenceText, '');
  assert.equal(marker.resolved.replicationScript.shots[0].speechLines[0].narrationOwnerShotId, 'S01');
  const binding = createSocialProductionExecutorCheckpoint(prepared.task, { SOCIAL_CONTENT_EXECUTOR: 'langgraph' }, prepared.planHash);
  assert.equal(binding.payload.approvedContext?.revisionPlanHash, prepared.planHash);
  await readSocialProductionGraphDetail(input, binding.payload.approvedContext!);
  await store.update(STARTER_COLLECTIONS.socialContentTasks, row.id, { brief: { ...row.brief, _productionRevision: { ...marker, referenceSha256: 'b'.repeat(64) } } });
  await assert.rejects(readSocialProductionGraphDetail(input, binding.payload.approvedContext!), /revision_plan_changed/);
});

test('stale version, changed reference/facts, invalid lineage and forged approval block without cancelling old run', async t => {
  const { input, store } = await fixture(t);
  for (const change of [ { expectedTaskVersion: '50' }, { verifyReferenceBytes: async () => false }, { readEnterpriseFactsHash: async () => 'other-facts' },
    { resolved: { ...input.resolved, replicationScript: { ...input.resolved.replicationScript, shots: input.resolved.replicationScript.shots.slice(0, 7) } } },
    { resolved: { ...input.resolved, humanApproved: true } } ]) {
    await assert.rejects(prepareSocialContentRevisionPlan({ ...input, ...change, idempotencyKey: `reject-${Object.keys(change)[0]}-${Math.random()}` }));
    assert.equal((await store.getById<any>(STARTER_COLLECTIONS.runs, 'legacy-run'))?.status, 'waiting_external');
  }
});

test('separate start fails closed on missing graph executor or changed revision; no queue/supplier invoked', async t => {
  const { input } = await fixture(t), prepared = await prepareSocialContentRevisionPlan(input);
  let queues = 0; const env = process.env.SOCIAL_CONTENT_EXECUTOR; t.after(() => { if (env === undefined) delete process.env.SOCIAL_CONTENT_EXECUTOR; else process.env.SOCIAL_CONTENT_EXECUTOR = env; });
  const start = { ...input, expectedVersion: prepared.task.version, expectedPlanHash: prepared.planHash, orchestratorQueue: { enqueue: async () => { queues++; throw new Error('should not enqueue'); } } };
  delete process.env.SOCIAL_CONTENT_EXECUTOR; await assert.rejects(startPreparedSocialContentRevision(start), /graph_executor_required/);
  process.env.SOCIAL_CONTENT_EXECUTOR = 'langgraph'; await assert.rejects(startPreparedSocialContentRevision({ ...start, expectedPlanHash: 'wrong' }), /plan_changed/);
  assert.equal(queues, 0);
});

test('explicit revision start freezes eight scenes and admits a fresh sticky graph job without supplier submission', async t => {
  const f = await fixture(t), { store, input, repository } = f;
  const { STARTER_198_CAPABILITIES } = await import('../shared/contracts/starter198.js');
  const { STARTER_198_DEFAULT_LIMITS } = await import('../server/starter198/provisioning.js');
  const now = new Date();
  await store.create(STARTER_COLLECTIONS.access, { tenant_id: input.tenantId, product_profile: 'starter_198', profile_version: 'starter_198.v1', entitlement_snapshot_id: 'fixture', feature_entitlements: STARTER_198_CAPABILITIES.map(capability => ({ capability, enabled: true })), resource_limits: STARTER_198_DEFAULT_LIMITS, status: 'active', cycle_started_at: new Date(now.getTime() - 86_400_000).toISOString(), cycle_ends_at: new Date(now.getTime() + 86_400_000).toISOString(), updated_at: now.toISOString() });
  let row = (await store.list<any>(STARTER_COLLECTIONS.socialContentTasks, { where: { task_id: input.taskId } })).items[0];
  await store.update(STARTER_COLLECTIONS.socialContentTasks, row.id, { brief: { ...row.brief, creationMode: 'viral_replication' }, source_count: 1 });
  await store.create(STARTER_COLLECTIONS.socialTaskSources, { tenant_id: input.tenantId, task_id: input.taskId, source_id: 'reference-source', source_kind: 'reference_link', status: 'active', source_ref: 'https://example.test/analysis-only', created_at: now.toISOString(), updated_at: now.toISOString() });
  // Seed a source-bound reviewed reference fixture through the same validator;
  // this is preexisting reference evidence, never an approval written by revision.
  const { validatePresenterContinuity } = await import('../server/lib/referencePresenterContinuity.js');
  const rawDetails = Array.from({ length: 37 }, (_, i) => ({ time: `${i}-${i + 1}s`, visual: 'Owned reference product on table', purpose: 'Show product structure', camera: 'Stable close shot', observedFacts: 'Product on table', bgm: 'Observed music', voiceover: 'Observed source speech', soundEffects: ['Observed tap'], dialogue: 'Observed source speech', beats: [{ action: 'Product rotation' }], criticalShot: { classification: 'critical' as const, model: 'controlled-reference-fixture', provenance: 'source-bound-fixture-observation', primaryHook: i === 0, uniqueVisualMechanism: true, explicitAudioVisualSync: false, confidence: .95, reason: 'Controlled reference evidence', evidence: ['Product rotation'], actionEvents: [], syncPoints: [] } }));
  const validated = validatePresenterContinuity({ analysis: { theme: '产品', hooks: [], sellingPoints: [], mood: 'clear', structure: 'show', baseRequirements: 'product', recommendedScriptType: 'storyboard', scriptDetails15s: rawDetails }, sourceSha256: input.referenceSha256, videoId: 'tenant-reference', frames: rawDetails.flatMap((_, i) => [.1, .8].map(offset => ({ shotId: `shot-${i + 1}`, seconds: i + offset, base64: 'controlled-source-frame', mimeType: 'image/jpeg' }))) }, { shots: rawDetails.map((_, i) => ({ shotId: `shot-${i + 1}`, visibility: 'no_person', personContinuityId: '', confidence: .95, evidence: ['Controlled source product-only observation'], frameSeconds: [i + .1, i + .8] })) }, 'controlled-reference-model');
  await store.create('trend_videos', { id: 'tenant-reference', tenantId: input.tenantId, sourceUrl: 'https://example.test/analysis-only', durationSeconds: 37, aiAnalysis: { analysisRunId: 'reference-source-run', contentSha256: input.referenceSha256, durationSeconds: 37, analysisMode: 'exact', analysisQuality: 'video', gemini: { scriptDetails15s: validated.map(detail => ({ ...detail, materialEvidence: { extractionStatus: 'ready', clipRef: 'controlled-existing-clip', firstFrameRef: 'controlled-existing-frame' }, hookMotionEvidence: { status: 'verified' } })) } }, referenceVerifiedSpeech: { schemaVersion: 1, analysisRunId: 'reference-source-run', sourceSha256: input.referenceSha256, coverageConfirmed: true, reviewerId: 'preexisting-reference-fixture-reviewer', verifiedAt: now.toISOString(), lines: [{ start: .1, end: .9, text: 'Observed reference source speech', visibility: 'voiceover' }] } });
  const before = await readSocialTaskDetail(input); assert.ok(before);
  // Reuse the formally generated, safe supply contracts; the revision changes copy/scene count, not rights.
  input.resolved.replicationScript.shots.forEach((shot: any, i: number) => {
    shot.materialPlan = { ...structuredClone(before.assetSupplyPlan!.shots[0]), shotId: shot.shotId, sceneId: shot.shotId, function: i === 0 ? 'hook' : 'value' };
  });
  input.expectedBriefHash = socialRequestHash(before.brief);
  const prepared = await prepareSocialContentRevisionPlan(input);
  const intake = await addSocialTaskSource({ ...input, idempotencyKey: 'owned-product-intake', value: { kind: 'material', sourceRef: 'owned-product-front', sourceVersion: 'product-sha', label: 'Owned front', purpose: 'Own product pixels' }, sourceOptions: { resolve: async () => ({ sourceVersion: 'product-sha' }) } as any });
  assert.equal(intake.task.status, 'asset_review');
  assert.equal(intake.task.runId, null);
  const env = process.env.SOCIAL_CONTENT_EXECUTOR; process.env.SOCIAL_CONTENT_EXECUTOR = 'langgraph';
  t.after(() => { if (env === undefined) delete process.env.SOCIAL_CONTENT_EXECUTOR; else process.env.SOCIAL_CONTENT_EXECUTOR = env; });
  let queued = 0, job: any;
  const { admitContentExecutionJob } = await import('../server/contentExecution/durableQueue.js');
  const started = await startPreparedSocialContentRevision({ ...input, idempotencyKey: 'start-new-eight', expectedVersion: intake.task.version, expectedPlanHash: prepared.planHash,
    orchestratorQueue: { enqueue: async () => {
      queued++; const detail = await readSocialTaskDetail(input); assert.ok(detail);
      assert.equal(detail.scriptBaseline?.sceneCount, 8);
      assert.equal(detail.replicationScript?.shots.length, 8);
      assert.equal(detail.referenceVideoAnalysis?.shots.length, 37);
      assert.equal(detail.replicationScript?.status, 'confirmed');
      const persisted = (await store.list<any>(STARTER_COLLECTIONS.socialContentTasks, { where: { task_id: input.taskId } })).items[0];
      const { parseStoredSocialScriptBaseline } = await import('../server/starter198/socialContentScriptBaseline.js');
      assert.equal(parseStoredSocialScriptBaseline(persisted.script_baseline)?.scenes.length, 8);
      const forgedAsr = structuredClone(persisted.script_baseline); delete forgedAsr.scenes[0].scriptOrigin;
      assert.throws(() => parseStoredSocialScriptBaseline(forgedAsr), /baseline_record_invalid/, 'empty reference transcript is permitted only for explicit independent copy');
      const forgedPrecision = structuredClone(persisted.script_baseline); forgedPrecision.scenes[0].speechLines[0].sourcePrecision = 'phrase';
      assert.throws(() => parseStoredSocialScriptBaseline(forgedPrecision), /baseline_record_invalid/, 'authored timings cannot claim measured phrase ASR');
      const checkpoint = createSocialProductionExecutorCheckpoint(detail, process.env, prepared.planHash);
      job = await admitContentExecutionJob({ dataStore: store, tenantId: input.tenantId, userId: input.userId, taskId: input.taskId, runId: 'new-eight-run', taskType: 'social_content_instant', initialCheckpoints: { 'social.executor': checkpoint } });
      return { queueItemId: 'new-eight-item', runId: 'new-eight-run' };
    } } });
  assert.equal(queued, 1); assert.equal(started.runId, 'new-eight-run');
  assert.equal(job.checkpoints['social.executor'].payload.executor, 'langgraph');
  assert.equal(job.checkpoints['social.executor'].payload.approvedContext.revisionPlanHash, prepared.planHash);
  assert.equal(job.checkpoints['social.executor'].payload.approvedContext.agentWorkflow.executionPlan.scenes.length, 8);
  assert.equal(started.artifacts[0].status, 'review_required');
  assert.deepEqual(await store.getById(STARTER_COLLECTIONS.socialContentArtifacts, f.artifact.id), f.artifact);
});
