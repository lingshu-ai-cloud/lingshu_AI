import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { createProductionTestStore } from '../production/testStore.js';
import { createStarter198Repository, STARTER_COLLECTIONS } from './repository.js';
import { createSingleContentCreationRouter } from './singleContentCreationRouter.js';
import { DEFAULT_CONTENT_PREFERENCES } from '../../shared/contracts/singleContentCreation.js';
import { socialRequestHash } from './socialContentValidation.js';

test('HTTP preflight uses authenticated scope, revalidates evidence before writes, and has no supplier / queue side effects', async () => {
  const store = createProductionTestStore(), repository = createStarter198Repository(store);
  const seen: string[] = [];
  let localPreview = true;
  let enqueued = 0;
  const app = express(); app.use(express.json());
  app.use(createSingleContentCreationRouter({ repository,
    now: () => new Date('2026-10-24T14:00:00Z'), localPreview: () => localPreview,
    authorize: async (_req, _res, level) => { seen.push(level); return { tenantId: 'authenticated-tenant', userId: 'owner' }; },
    orchestratorQueue: { enqueue: async () => { enqueued++; throw Error('queue must not be called'); } },
    asyncRoute: handler => (req, res) => { void handler(req, res).catch(error => res.status(error.status || 500).json({ error: error.code || error.message })); },
    sourceOptions: {
      list: async () => ({ items: [], page: 1, perPage: 1, totalItems: 0, totalPages: 1, status: 'ready' }),
      resolve: async input => ({ optionId: 'enterprise-profile', kind: input.kind, sourceRef: input.sourceRef, sourceVersion: 'v1', label: '企业知识库', type: 'enterprise_profile', thumbnailHref: null }),
    },
    evidence: {
      profile: async tenant => { assert.equal(tenant, 'authenticated-tenant'); return { company: { name: '企业' }, products: { items: [{ id: 'p1', name: '产品1' }] } }; },
      presenters: async () => [{ id: 'presenter-a', name: '企业人物', authorized: true,
        avatarId: 'avatar-a', voiceId: 'voice-a', rightsEvidence: {
          authorizationRef: 'rights://heygen/presenter-a', consentRef: 'consent://heygen/presenter-a/voice',
          grantedAt: '2026-09-01T00:00:00Z', subjectAdultConfirmed: true,
          permittedProviders: ['heygen'], permittedUses: ['digital_presenter', 'voice_synthesis'],
        } }], references: async () => [], reference: async () => null,
      materials: async () => ({ status: 'ready', items: [] }),
    },
  }));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const request = async (route: string, body?: unknown, idempotencyKey = 'single-test-key') => {
    const response = await fetch(`http://127.0.0.1:${address.port}/${route.startsWith('tasks/') ? route : `single-creation/${route}`}`, {
      method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }); return { status: response.status, body: await response.json() };
  };
  try {
    const options = await request('options'); assert.equal(options.status, 200); assert.equal(options.body.products[0].id, 'p1');
    const selection = { productId: 'p1', objective: '介绍产品', dueAt: '2026-10-25T10:00:00Z', usePresenter: false, preferences: { ...DEFAULT_CONTENT_PREFERENCES, platform: 'facebook' } };
    const prepared = await request('prepare', selection);
    assert.equal(prepared.status, 200); assert.equal(prepared.body.canCreate, true); assert.equal(prepared.body.executionAvailable, false);
    const forgedScope = await request('prepare', { ...selection, tenantId: 'another-tenant' }); assert.equal(forgedScope.status, 400);
    const changed = await request('create', { selection: { ...selection, objective: '修改目标' }, fingerprint: prepared.body.fingerprint });
    assert.equal(changed.status, 409); assert.equal(changed.body.code, 'single_content_evidence_changed');
    assert.equal(store.rows.size, 0); assert.equal(enqueued, 0);
    assert.deepEqual(seen, ['read', 'start', 'start', 'start']);
    const unsupported = { ...selection, preferences: { ...selection.preferences, languages: ['en', 'es'] } };
    const blockedCheck = await request('prepare', unsupported);
    assert.equal(blockedCheck.body.canCreate, false);
    assert.match(blockedCheck.body.checks.find((item: { key: string }) => item.key === 'languages').message, /西班牙语/);
    const blockedCreate = await request('create', { selection: unsupported, fingerprint: blockedCheck.body.fingerprint });
    assert.equal(blockedCreate.status, 422); assert.equal(store.rows.size, 0); assert.equal(enqueued, 0);
    const multi = { ...selection, preferences: { ...selection.preferences, languages: ['en', 'zh'] } };
    const checked = await request('prepare', multi);
    const created = await request('create', { selection: multi, fingerprint: checked.body.fingerprint });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.variants.length, 2);
    assert.deepEqual(created.body.variants.map((variant: { task: { brief: { languages: string[] } } }) => variant.task.brief.languages), [['en'], ['zh']]);
    assert.equal(new Set(created.body.variants.map((variant: { task: { taskId: string } }) => variant.task.taskId)).size, 2);
    assert.ok(created.body.variants.every((variant: { task: { runId: string | null; dueAt: string } }) => !variant.task.runId));
    const replay = await request('create', { selection: multi, fingerprint: checked.body.fingerprint });
    // A saved task without a run must pass through preparation/start admission
    // again. Only fully started variants may use the direct replay response.
    assert.equal(replay.status, 201);
    assert.deepEqual(replay.body.variants.map((variant: { task: { taskId: string } }) => variant.task.taskId), created.body.variants.map((variant: { task: { taskId: string } }) => variant.task.taskId));
    assert.equal(enqueued, 0);
    const firstStored = (await repository.list(STARTER_COLLECTIONS.socialContentTasks, 'authenticated-tenant', {
      where: { task_id: created.body.variants[0].task.taskId }, perPage: 2,
    })).items[0]!;
    await repository.update(STARTER_COLLECTIONS.socialContentTasks, 'authenticated-tenant', firstStored.id, {
      run_id: 'existing-language-run', orchestrator_item_id: 'existing-language-queue',
    });
    const secondStored = (await repository.list(STARTER_COLLECTIONS.socialContentTasks, 'authenticated-tenant', {
      where: { task_id: created.body.variants[1].task.taskId }, perPage: 2,
    })).items[0]!;
    const interruptedOperationId = 'socialop_interrupted_language_start';
    await repository.create(STARTER_COLLECTIONS.socialContentOperations, 'authenticated-tenant', {
      operation_id: interruptedOperationId, idempotency_key: 'single-test-key:language:zh:start',
      request_hash: socialRequestHash({ expectedVersion: secondStored.version }), operation: 'start_social_content_task',
      target_id: created.body.variants[1].task.taskId, status: 'processing',
      result: { schemaVersion: 'social-content.operation-processing.v1', operationId: interruptedOperationId,
        targetId: created.body.variants[1].task.taskId, expectedVersion: secondStored.version },
      error_code: '', http_status: 0, created_by: 'owner', created_at: '2026-10-24T14:00:00.000Z',
      updated_at: '2026-10-24T14:00:00.000Z',
    });
    await repository.update(STARTER_COLLECTIONS.socialContentTasks, 'authenticated-tenant', secondStored.id, {
      version: '2', status: 'plan_review', last_operation_id: `${interruptedOperationId}:prestart`,
    });
    localPreview = false;
    const executable = await request('prepare', multi);
    assert.equal(executable.body.canCreate, true);
    const resumed = await request('create', { selection: multi, fingerprint: executable.body.fingerprint });
    assert.ok([201, 202].includes(resumed.status), JSON.stringify(resumed.body));
    assert.deepEqual(resumed.body.variants.map((variant: { task: { taskId: string } }) => variant.task.taskId), created.body.variants.map((variant: { task: { taskId: string } }) => variant.task.taskId));
    assert.equal(resumed.body.variants[0].task.runId, 'existing-language-run', 'an already-started language is not enqueued again');
    assert.equal(resumed.body.variants[1].task.status, 'plan_review');
    assert.equal(resumed.body.variants[1].receipt.blockedReason, 'social_content_execution_goal_degraded',
      'the missing language re-enters canonical start admission when execution becomes available');
    const operationsBeforeFailedReplay = (await repository.list(STARTER_COLLECTIONS.socialContentOperations,
      'authenticated-tenant', { perPage: 100 })).totalItems;
    const failedReplay = await request('create', { selection: multi, fingerprint: executable.body.fingerprint });
    assert.equal(failedReplay.body.variants[1].receipt.blockedReason, 'social_content_execution_goal_degraded');
    assert.equal((await repository.list(STARTER_COLLECTIONS.socialContentOperations,
      'authenticated-tenant', { perPage: 100 })).totalItems, operationsBeforeFailedReplay,
    'a failed original start remains the replay authority and is not bypassed with a new operation');
    assert.equal(enqueued, 0);
    localPreview = true;
    const firstTaskId = created.body.variants[0].task.taskId;
    const beforeInspection = JSON.stringify([...store.rows.entries()]);
    const inspected = await request(`tasks/${firstTaskId}/queue-inspection`);
    assert.equal(inspected.status, 200);
    assert.equal(inspected.body.taskId, firstTaskId);
    assert.equal(inspected.body.runtime.mode, 'preview');
    assert.equal(inspected.body.canRequestStart, false);
    assert.equal(inspected.body.job, null);
    assert.equal(JSON.stringify([...store.rows.entries()]), beforeInspection);
    assert.equal(enqueued, 0);
    const missing = await request('tasks/socialtask_other-tenant/queue-inspection');
    assert.equal(missing.status, 404);
    const presenterSelection = { ...selection, objective: '数字人口播', usePresenter: true,
      presenterId: 'presenter-a', preferences: { ...selection.preferences, materialPolicy: 'ai_enhanced' } };
    const presenterPrepared = await request('prepare', presenterSelection, 'presenter-test-key');
    assert.equal(presenterPrepared.body.canCreate, true);
    const presenterCreated = await request('create', {
      selection: presenterSelection, fingerprint: presenterPrepared.body.fingerprint,
    }, 'presenter-test-key');
    assert.equal(presenterCreated.status, 201, JSON.stringify(presenterCreated.body));
    assert.equal(presenterCreated.body.task.brief.presenterSpeechReviewPolicy, 'heygen_native_human_review');
    assert.equal(presenterCreated.body.task.brief.presenterAssetId, 'presenter-a');
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
