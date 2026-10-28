import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import express from 'express';
import { AssistantActionError, type AssistantActionService } from '../assistant/actionRouting.js';
import { Starter198RepositoryError, starter198Repository } from '../starter198/repository.js';
import { defaultBrief } from '../starter198/socialContentTaskSupport.js';
import { SocialContentWorkflowError } from '../starter198/socialContentValidation.js';
import type { DataStore, ListQuery } from '../storage/datastore.js';
import type { SocialContentTaskSummary } from '../../shared/contracts/socialContentTaskContract.js';

const previousEnvironment = {
  NODE_ENV: process.env.NODE_ENV,
  PB_URL: process.env.PB_URL,
  DISABLE_LOCAL_AUTH_FALLBACK: process.env.DISABLE_LOCAL_AUTH_FALLBACK,
};
process.env.NODE_ENV = 'test';
process.env.PB_URL = 'http://127.0.0.1:1';
process.env.DISABLE_LOCAL_AUTH_FALLBACK = 'false';

const { createAssistantThreadsRouter } = await import('./assistantThreads.js');

type Row = { id: string } & Record<string, unknown>;

function memoryStore(seed: Row[] = []): DataStore {
  const rows = new Map(seed.map(row => [row.id, structuredClone(row)]));
  return {
    async getById<T>(collection: string, id: string) {
      return (collection === 'assistant_threads' ? rows.get(id) : null) as T | null;
    },
    async create<T>(collection: string, data: Record<string, unknown>) {
      if (collection !== 'assistant_threads') return null;
      const value = { id: `thread-${rows.size + 1}`, ...structuredClone(data) };
      rows.set(value.id, value);
      return value as T;
    },
    async update(collection: string, id: string, data: Record<string, unknown>) {
      const current = collection === 'assistant_threads' ? rows.get(id) : null;
      if (!current) return false;
      rows.set(id, { ...current, ...structuredClone(data) });
      return true;
    },
    async compareAndSwap(collection, id, expected, data) {
      const current = collection === 'assistant_threads' ? rows.get(id) : null;
      if (!current || !Object.entries(expected).every(([key, value]) => current[key] === value)) return false;
      rows.set(id, { ...current, ...structuredClone(data) });
      return true;
    },
    async delete(_collection: string, id: string) { return rows.delete(id); },
    async list<T>(collection: string, query: ListQuery = {}) {
      const items = collection === 'assistant_threads'
        ? [...rows.values()].filter(row => Object.entries(query.where ?? {}).every(([key, value]) => row[key] === value))
        : [];
      return { items: items as T[], totalItems: items.length, totalPages: 1, page: 1, perPage: query.perPage ?? 20 };
    },
  };
}

function instantTask(taskId = 'content-one'): SocialContentTaskSummary {
  const timestamp = '2026-10-24T08:00:00.000Z';
  return {
    taskId, brief: defaultBrief({
      title: '青柠精华短视频', objective: '制作一条产品短视频', productId: 'product-one',
      productRef: '青柠精华', platforms: ['tiktok'], formats: ['video'], mode: 'instant',
    }),
    status: 'draft', version: '1', packageSelection: [], readiness: { complete: false, missing: ['material'] },
    runId: null, sourceCount: 0, knowledgeSourceCount: 0, materialSourceCount: 0, artifactCount: 0,
    approvedArtifactCount: 0, deliveryPackageCount: 0, publicationCount: 0, metricSubmissionCount: 0,
    createdAt: timestamp, updatedAt: timestamp, mode: 'instant', weeklyPlanId: null,
  };
}

const instantTaskRequest = {
  expectedThreadVersion: 0,
  idempotencyKey: 'assistant-content:0:12345678',
  message: '请为青柠精华制作一条短视频',
  task: {
    title: '青柠精华短视频', objective: '制作一条产品短视频', productId: 'product-one', productRef: '青柠精华',
    platforms: ['tiktok'], formats: ['video'], requestedOutputCount: 1, planningMode: 'auto_adjust',
    restrictions: [], dueAt: null, creationMode: 'material_processing', assetAvailability: 'none',
    managementMode: 'one_click_managed', productionMode: 'social_ready', productionApproach: 'ai_enhanced', mode: 'instant',
  },
};

test('content task endpoint binds one server task, message and authoritative card without starting paid production', async () => {
  const calls: string[] = [];
  const app = express(); app.use(express.json());
  app.use('/api/overseas/assistant-threads', createAssistantThreadsRouter({
    dataStore: memoryStore(),
    authorizeContentTaskCreation: async () => {},
    createInstantContentTask: async input => { calls.push(input.idempotencyKey); return instantTask(); },
    authMiddleware: (_req, res, next) => { res.locals.tenantId = 'tenant-a'; res.locals.userId = 'user-a'; next(); },
  }));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/overseas/assistant-threads`;
  try {
    const response = await fetch(`${base}/business/content-tasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(instantTaskRequest) });
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.deepEqual(calls, [instantTaskRequest.idempotencyKey]);
    assert.equal(body.task.taskId, 'content-one');
    assert.equal(body.task.runId, null, 'creating the task must not start a paid run');
    assert.equal(body.receipt.card.contentTaskId, 'content-one');
    assert.equal(body.receipt.card.cardVersion, '1');
    assert.equal(body.thread.focusedTaskId, 'social-content:content-one');
    assert.deepEqual(body.thread.messages.map((item: { role: string }) => item.role), ['user', 'assistant']);
    const replay = await fetch(`${base}/business/content-tasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(instantTaskRequest) });
    assert.equal(replay.status, 409, 'a stale thread version cannot append a duplicate conversation binding');
    assert.equal(calls.length, 1, 'version conflict must be checked before task creation');
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

test('a lost conversation bind retries the same idempotent task and appends the message once', async () => {
  const baseStore = memoryStore();
  let failCreate = true;
  const storeWithLostCreate: DataStore = {
    ...baseStore,
    async create<T>(collection: string, data: Record<string, unknown>) {
      if (collection === 'assistant_threads' && failCreate) { failCreate = false; return null; }
      return baseStore.create<T>(collection, data);
    },
  };
  const taskIds: string[] = [];
  const app = express(); app.use(express.json());
  app.use('/api/overseas/assistant-threads', createAssistantThreadsRouter({
    dataStore: storeWithLostCreate,
    authorizeContentTaskCreation: async () => {},
    createInstantContentTask: async input => { taskIds.push(`${input.idempotencyKey}:content-one`); return instantTask(); },
    authMiddleware: (_req, res, next) => { res.locals.tenantId = 'tenant-a'; res.locals.userId = 'user-a'; next(); },
  }));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/overseas/assistant-threads/business/content-tasks`;
  try {
    const first = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(instantTaskRequest) });
    assert.equal(first.status, 503);
    assert.equal((await first.json()).error, 'assistant_content_task_binding_pending');
    const retry = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(instantTaskRequest) });
    assert.equal(retry.status, 201);
    const result = await retry.json();
    assert.deepEqual(taskIds, [
      `${instantTaskRequest.idempotencyKey}:content-one`, `${instantTaskRequest.idempotencyKey}:content-one`,
    ]);
    assert.equal(result.task.taskId, 'content-one');
    assert.equal(result.thread.messages.length, 2);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

test('a task persisted before detail failure is recovered by one idempotent resend', async () => {
  const baseStore = memoryStore();
  const taskRows: Row[] = [];
  const dataStore: DataStore = {
    ...baseStore,
    async list<T>(collection: string, query: ListQuery = {}) {
      if (collection !== 'starter_social_content_tasks') return baseStore.list<T>(collection, query);
      const items = taskRows.filter(row => Object.entries(query.where ?? {}).every(([key, value]) => row[key] === value));
      return { items: items as T[], totalItems: items.length, totalPages: 1, page: 1, perPage: query.perPage ?? 20 };
    },
  };
  let firstDetailRead = true;
  const keys: string[] = [];
  const app = express(); app.use(express.json());
  app.use('/api/overseas/assistant-threads', createAssistantThreadsRouter({
    dataStore,
    authorizeContentTaskCreation: async () => {},
    createInstantContentTask: async input => {
      keys.push(input.idempotencyKey);
      if (!taskRows.length) taskRows.push({
        id: 'task-row', tenant_id: input.tenantId, task_id: 'content-once', task_mode: 'instant',
        created_by: input.userId, create_idempotency_key: input.idempotencyKey,
      });
      if (firstDetailRead) { firstDetailRead = false; throw new Error('detail read unavailable after create'); }
      return instantTask('content-once');
    },
    authMiddleware: (_req, res, next) => { res.locals.tenantId = 'tenant-a'; res.locals.userId = 'user-a'; next(); },
  }));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/overseas/assistant-threads/business/content-tasks`;
  try {
    const first = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(instantTaskRequest) });
    assert.equal(first.status, 503);
    assert.equal((await first.json()).contentTaskId, 'content-once');
    const retry = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(instantTaskRequest) });
    assert.equal(retry.status, 201);
    assert.equal((await retry.json()).task.taskId, 'content-once');
    assert.equal(taskRows.length, 1);
    assert.deepEqual(keys, [instantTaskRequest.idempotencyKey, instantTaskRequest.idempotencyKey]);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

test('content task endpoint rejects a caller without the canonical social-content write authority', async () => {
  let creates = 0;
  const app = express(); app.use(express.json());
  app.use('/api/overseas/assistant-threads', createAssistantThreadsRouter({
    dataStore: memoryStore(),
    authorizeContentTaskCreation: async () => { throw new SocialContentWorkflowError('social_content_write_forbidden', 403); },
    createInstantContentTask: async () => { creates += 1; return instantTask(); },
    authMiddleware: (_req, res, next) => { res.locals.tenantId = 'tenant-a'; res.locals.userId = 'viewer-a'; next(); },
  }));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/overseas/assistant-threads/business/content-tasks`;
  try {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(instantTaskRequest) });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error, 'social_content_write_forbidden');
    assert.equal(creates, 0);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

test('content task endpoint reserves conversation capacity before creating a business task', async () => {
  const fullCard = (index: number) => ({
    taskId: `old:${index}`, title: `旧任务 ${index}`, conclusion: '旧任务状态', details: [], status: 'completed',
    notificationReason: 'routine', secondaryActions: [], updatedAt: index + 1,
  });
  const dataStore = memoryStore([
    { id: 'message-full', tenantId: 'tenant-a', userId: 'user-a', agentId: 'business', source: 'desktop', version: 1,
      messages: Array.from({ length: 119 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: `消息 ${index}` })), taskCards: {} },
    { id: 'card-full', tenantId: 'tenant-a', userId: 'user-a', agentId: 'content', source: 'desktop', version: 1,
      messages: [], taskCards: Object.fromEntries(Array.from({ length: 50 }, (_, index) => [`old:${index}`, fullCard(index)])) },
  ]);
  let creates = 0;
  const app = express(); app.use(express.json());
  app.use('/api/overseas/assistant-threads', createAssistantThreadsRouter({
    dataStore, authorizeContentTaskCreation: async () => {},
    createInstantContentTask: async () => { creates += 1; return instantTask(); },
    authMiddleware: (_req, res, next) => { res.locals.tenantId = 'tenant-a'; res.locals.userId = 'user-a'; next(); },
  }));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/overseas/assistant-threads`;
  try {
    for (const agent of ['business', 'content']) {
      const response = await fetch(`${base}/${agent}/content-tasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...instantTaskRequest, expectedThreadVersion: 1 }) });
      assert.equal(response.status, 413);
      assert.equal((await response.json()).error, 'assistant_content_task_thread_full');
    }
    assert.equal(creates, 0, 'capacity must be rejected before the canonical ContentTask write');
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

test('assistant action endpoint is authenticated, tenant-scoped and mounted on the existing thread router', async () => {
  const contexts: Array<{ tenantId: string; userId: string }> = [];
  const actionService: AssistantActionService = {
    async route(input, context) {
      contexts.push({ tenantId: context.tenantId, userId: context.userId });
      return {
        status: 'completed',
        actionId: 'open_workspace',
        requestId: String((input as { requestId?: string }).requestId),
        notification: null,
        card: { kind: 'operation_result', title: '已打开', summary: '工作区已准备好', details: [], secondaryActions: [] },
      };
    },
  };
  const dataStore = memoryStore([
    { id: 'thread-a', tenantId: 'tenant-a', userId: 'user-tenant-a', agentId: 'content', version: 1, messages: [{ role: 'user', content: 'tenant-a-secret' }] },
    { id: 'mobile-a', tenantId: 'tenant-a', userId: 'user-tenant-a', agentId: 'mobile_workbench', source: 'mobile_workbench', messages: [{role:'user',content:'mobile-private'}] },
    { id: 'thread-b', tenantId: 'tenant-b', userId: 'user-tenant-b', agentId: 'content', version: 1, messages: [{ role: 'user', content: 'tenant-b-secret' }] },
  ]);
  const app = express();
  app.use(express.json());
  app.use('/api/overseas/assistant-threads', createAssistantThreadsRouter({
    dataStore,
    actionService,
    authMiddleware: (req, res, next) => {
      const tenantId = String(req.headers['x-test-tenant'] || '');
      if (!tenantId) { res.sendStatus(401); return; }
      res.locals.tenantId = tenantId;
      res.locals.userId = `user-${tenantId}`;
      next();
    },
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/overseas/assistant-threads`;
  try {
    const unauthenticated = await fetch(`${base}/content/actions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    assert.equal(unauthenticated.status, 401);

    const action = await fetch(`${base}/content/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-tenant': 'tenant-a' },
      body: JSON.stringify({
        source: 'button', actionId: 'open_workspace', requestId: 'route-action-001',
        parameters: { tenantId: 'tenant-b' },
      }),
    });
    assert.equal(action.status, 200);
    assert.deepEqual(contexts, [{ tenantId: 'tenant-a', userId: 'user-tenant-a' }]);

    const threads = await fetch(base, { headers: { 'x-test-tenant': 'tenant-a' } }).then(response => response.json());
    assert.equal(threads.items.length, 1);
    assert.deepEqual(threads.items[0].messages, [{ role: 'user', content: 'tenant-a-secret' }]);
    assert.doesNotMatch(JSON.stringify(threads), /tenant-b-secret/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('default action routing visibly rejects unsupported tenant writes from language and buttons', async () => {
  const previousAccess = starter198Repository.access;
  starter198Repository.access = async () => {
    throw new Starter198RepositoryError('starter_198_not_provisioned');
  };
  const app = express();
  app.use(express.json());
  app.use('/api/overseas/assistant-threads', createAssistantThreadsRouter({
    dataStore: memoryStore(),
    authMiddleware: (_req, res, next) => {
      res.locals.tenantId = 'enterprise-tenant';
      res.locals.userId = 'enterprise-user';
      next();
    },
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/overseas/assistant-threads/content/actions`;
  const target = { objectType: 'run', objectId: 'run-1', expectedVersion: 'running:v1' };
  try {
    const natural = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'natural_language', requestId: 'unsupported-natural-002',
        text: '请暂停当前任务', target,
      }),
    });
    assert.equal(natural.status, 422);
    const naturalBody = await natural.json() as {
      status: string;
      actionId: string;
      errorCode?: string;
      notification?: { reason?: string };
      card?: { title?: string; summary?: string };
    };
    assert.equal(naturalBody.status, 'missing_required_input');
    assert.equal(naturalBody.actionId, 'delegate_to_agent');
    assert.equal(naturalBody.errorCode, 'assistant_mutation_not_supported');
    assert.equal(naturalBody.notification?.reason, 'missing_required_input');
    assert.match(naturalBody.card?.title ?? '', /尚未执行/);
    assert.match(naturalBody.card?.summary ?? '', /没有修改任何内容/);

    const button = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'button', actionId: 'pause_task', requestId: 'unsupported-button-002', target,
      }),
    });
    assert.equal(button.status, 403);
    const buttonBody = await button.json() as { error: string; notification?: { reason?: string } };
    assert.equal(buttonBody.error, 'assistant_action_not_supported');
    assert.equal(buttonBody.notification?.reason, 'failure');
  } finally {
    starter198Repository.access = previousAccess;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('assistant thread state persists bounded task cards and rejects malformed or oversized state', async () => {
  const dataStore = memoryStore([{
    id: 'legacy-corrupt', tenantId: 'tenant-a', userId: 'user-tenant-a', agentId: 'customer', version: 1,
    messages: [{ role: 'system', content: 'must not be returned' }],
    draftInput: 'x'.repeat(9_000), scrollPosition: -1, unreadCount: -5,
    isFollowingLatest: 'yes', paused: 'no', taskCards: { '__proto__': { polluted: true } },
    focusedTaskId: '__proto__', updatedAt: '2026-10-09T00:00:00.000Z',
  }]);
  const app = express();
  app.use(express.json());
  app.use('/api/overseas/assistant-threads', createAssistantThreadsRouter({
    dataStore,
    actionService: {
      async route() { throw new Error('not used'); },
    },
    authMiddleware: (req, res, next) => {
      const tenantId = String(req.headers['x-test-tenant'] || '');
      if (!tenantId) { res.sendStatus(401); return; }
      res.locals.tenantId = tenantId;
      res.locals.userId = `user-${tenantId}`;
      next();
    },
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/overseas/assistant-threads`;
  const headers = { 'Content-Type': 'application/json', 'x-test-tenant': 'tenant-a' };
  const card = {
    taskId: 'run:one',
    title: '确认本周计划',
    conclusion: '四个平台将稳定更新。',
    details: ['5 条独立视频', '18 条平台版本', '预算 50–75 元'],
    status: 'approval',
    notificationReason: 'approval_required',
    primaryAction: {
      id: 'confirm-plan', label: '确认并开始', actionId: 'confirm_choice',
      target: { objectType: 'approval', objectId: 'approval-1', expectedVersion: 'v1' },
      parameters: { option: 'approve', value: 'approved', parameters: {} },
    },
    secondaryActions: [{ id: 'open-plan', label: '查看排期', href: '/?page=digitalEmployees' }],
    workspace: { label: '查看排期', href: '/?page=digitalEmployees&focus=run%3Aone' },
    updatedAt: 1_796_000_000_000,
  };
  const creationDraft = { referenceId: 'ref-one', productIds: ['product-one'], shotIds: [], evidenceVersion: 'a'.repeat(64) };
  const creation = { stage: 'products', selection: creationDraft, referenceTitle: '参考 A', products: [{ id: 'product-one', name: '产品 A' }], shots: [], narrations: [], gaps: [], presenterIds: [] };
  const businessScenePrompt = { sceneId: 'CS-02', preferredId: 'customer-one' };
  const businessScene = { sceneId: 'CS-02', customerId: 'customer-one', from: '2026-10-21', to: '2026-10-27' };
  const valid = {
    creationDraft,
    messages: [{ role: 'user', content: '请规划本周内容', referenceMedia: { kind: 'video', title: '爆款参考视频', platform: 'tiktok', referenceId: 'video-1', duration: 18, thumbnailUrl: '/api/overseas/videos/video-1/thumbnail', sourceUrl: 'https://video.example.test/watch/1' } }, { role: 'assistant', content: '请确认计划。', creation },
      { role: 'assistant', content: '你还想再看看这位客户的其他信息吗？', businessScenePrompt },
      { role: 'assistant', content: '这位客户的会话摘要。', businessScene }],
    draftInput: '我想先调整预算',
    scrollPosition: 288,
    unreadCount: 2,
    isFollowingLatest: false,
    paused: true,
    taskCards: { 'run:one': card },
    focusedTaskId: 'run:one',
    pendingContentTaskBinding: {
      intentFingerprint: 'assistant-content-intent:12345678',
      idempotencyKey: 'assistant-content:0:12345678',
      contentTaskId: null,
      createdAt: '2026-10-24T08:00:00.000Z',
    },
  };
  try {
    const savedResponse = await fetch(`${base}/business`, {
      method: 'PUT', headers, body: JSON.stringify({ ...valid, expectedVersion: 0 }),
    });
    assert.equal(savedResponse.status, 200);
    const saved = await savedResponse.json();
    assert.equal(saved.tenantId, 'tenant-a');
    assert.equal(saved.agentId, 'business');
    assert.equal(saved.userId, 'user-tenant-a');
    assert.equal(saved.version, 1);
    assert.equal(saved.isFollowingLatest, false);
    assert.equal(saved.paused, true);
    assert.deepEqual(saved.messages[0].referenceMedia, valid.messages[0].referenceMedia);
    assert.deepEqual(saved.messages[1].creation, creation);
    assert.equal(saved.focusedTaskId, 'run:one');
    assert.equal(saved.pendingContentTaskBinding.contentTaskId, null);
    assert.deepEqual(saved.taskCards['run:one'], {
      ...card,
      primaryAction: { id: 'confirm-plan', label: '确认并开始' },
    });

    const loaded = await fetch(`${base}/business`, { headers }).then(response => response.json());
    assert.deepEqual(loaded.creationDraft, creationDraft);
    assert.deepEqual(loaded.messages[1].creation, creation);
    assert.deepEqual(loaded.messages[2].businessScenePrompt, businessScenePrompt, 'inline customer selection survives server reload');
    assert.deepEqual(loaded.messages[3].businessScene, businessScene, 'the chosen customer remains available for the next question');
    assert.equal(loaded.draftInput, valid.draftInput);
    assert.equal(loaded.scrollPosition, 288);
    assert.equal(loaded.taskCards['run:one'].primaryAction.actionId, undefined,
      'client thread snapshots cannot persist executable actions or targets');

    const legacyPartial = await fetch(`${base}/business`, {
      method: 'PUT', headers, body: JSON.stringify({ expectedVersion: 1, draftInput: '旧客户端只更新草稿' }),
    });
    assert.equal(legacyPartial.status, 200);
    const partialBody = await legacyPartial.json();
    assert.equal(partialBody.draftInput, '旧客户端只更新草稿');
    assert.equal(partialBody.version, 2);
    assert.deepEqual(partialBody.creationDraft, creationDraft, 'old-client partial updates preserve creation selection');
    assert.equal(partialBody.paused, true);
    assert.equal(partialBody.focusedTaskId, 'run:one');
    assert.deepEqual(Object.keys(partialBody.taskCards), ['run:one']);
    assert.equal(partialBody.pendingContentTaskBinding.idempotencyKey, 'assistant-content:0:12345678');

    const otherTenant = await fetch(`${base}/business`, {
      headers: { ...headers, 'x-test-tenant': 'tenant-b' },
    }).then(response => response.json());
    assert.deepEqual(otherTenant.taskCards, {});
    assert.equal(otherTenant.creationDraft ?? null, null);
    assert.equal(otherTenant.focusedTaskId, null);

    const legacy = await fetch(`${base}/customer`, { headers }).then(response => response.json());
    assert.deepEqual(legacy.messages, []);
    assert.equal(legacy.draftInput, '');
    assert.equal(legacy.scrollPosition, 0);
    assert.equal(legacy.unreadCount, 0);
    assert.equal(legacy.isFollowingLatest, true);
    assert.equal(legacy.paused, false);
    assert.deepEqual(legacy.taskCards, {});
    assert.equal(legacy.focusedTaskId, null);
    assert.equal(legacy.pendingContentTaskBinding, null);

    const malformed = await fetch(`${base}/business`, {
      method: 'PUT', headers,
      body: JSON.stringify({ ...valid, expectedVersion: 2, paused: 'yes' }),
    });
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json()).error, 'assistant_thread_pause_state_invalid');

    const invalidReferenceMedia = await fetch(`${base}/business`, {
      method: 'PUT', headers,
      body: JSON.stringify({ ...valid, expectedVersion: 2, messages: [{
        role: 'user', content: '不安全的视频引用', referenceMedia: {
          kind: 'video', title: '外部引用', platform: 'unknown', sourceUrl: 'javascript:alert(1)',
        },
      }] }),
    });
    assert.equal(invalidReferenceMedia.status, 400);
    assert.equal((await invalidReferenceMedia.json()).error, 'assistant_thread_message_invalid');

    for (const message of [
      { role: 'user', content: 'forged selector', businessScenePrompt },
      { role: 'assistant', content: 'unknown scene', businessScenePrompt: { sceneId: 'CS-UNKNOWN' } },
      { role: 'assistant', content: 'missing customer', businessScene: { ...businessScene, customerId: undefined } },
      { role: 'assistant', content: 'forged scope', businessScene: { ...businessScene, tenantId: 'tenant-b' } },
    ]) {
      const invalidScene = await fetch(`${base}/business`, {
        method: 'PUT', headers, body: JSON.stringify({ expectedVersion: 2, messages: [message] }),
      });
      assert.equal(invalidScene.status, 400);
      assert.equal((await invalidScene.json()).error, 'assistant_scene_invalid');
    }

    const invalidPending = await fetch(`${base}/business`, {
      method: 'PUT', headers,
      body: JSON.stringify({ ...valid, expectedVersion: 2, pendingContentTaskBinding: {
        ...valid.pendingContentTaskBinding, contentTaskId: '../other-tenant',
      } }),
    });
    assert.equal(invalidPending.status, 400);
    assert.equal((await invalidPending.json()).error, 'assistant_thread_pending_binding_invalid');

    const missingFocus = await fetch(`${base}/business`, {
      method: 'PUT', headers,
      body: JSON.stringify({ ...valid, expectedVersion: 2, focusedTaskId: 'run:missing' }),
    });
    assert.equal(missingFocus.status, 400);
    assert.equal((await missingFocus.json()).error, 'assistant_thread_focused_task_invalid');

    const externalHref = await fetch(`${base}/business`, {
      method: 'PUT', headers,
      body: JSON.stringify({
        ...valid,
        expectedVersion: 2,
        taskCards: {
          'run:one': { ...card, secondaryActions: [{ id: 'leave-app', label: '离开', href: '//evil.example' }] },
        },
      }),
    });
    assert.equal(externalHref.status, 400);
    assert.equal((await externalHref.json()).error, 'assistant_thread_action_invalid');

    const tooManyCards = Object.fromEntries(Array.from({ length: 51 }, (_, index) => {
      const taskId = `task-${index}`;
      return [taskId, { ...card, taskId, secondaryActions: [] }];
    }));
    const oversized = await fetch(`${base}/business`, {
      method: 'PUT', headers,
      body: JSON.stringify({ ...valid, expectedVersion: 2, taskCards: tooManyCards, focusedTaskId: null }),
    });
    assert.equal(oversized.status, 413);
    assert.equal((await oversized.json()).error, 'assistant_thread_task_cards_too_many');

    const unchanged = await fetch(`${base}/business`, { headers }).then(response => response.json());
    assert.equal(unchanged.paused, true, 'invalid writes must not replace the last valid snapshot');
    assert.deepEqual(Object.keys(unchanged.taskCards), ['run:one']);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('assistant threads isolate users inside one tenant and reject stale full-snapshot writes', async () => {
  const dataStore = memoryStore([
    {
      id: 'owned-a', tenantId: 'shared-tenant', userId: 'user-a', agentId: 'business', version: 3,
      messages: [{ role: 'user', content: 'user-a-private' }], draftInput: 'a-draft',
    },
    {
      id: 'owned-b', tenantId: 'shared-tenant', userId: 'user-b', agentId: 'business', version: 7,
      messages: [{ role: 'user', content: 'user-b-private' }], draftInput: 'b-draft',
    },
    {
      id: 'legacy-unowned', tenantId: 'shared-tenant', agentId: 'business', version: 0,
      messages: [{ role: 'user', content: 'legacy-owner-unknown' }],
    },
  ]);
  const app = express();
  app.use(express.json());
  app.use('/api/overseas/assistant-threads', createAssistantThreadsRouter({
    dataStore,
    actionService: { async route() { throw new Error('not used'); } },
    authMiddleware: (req, res, next) => {
      const userId = String(req.headers['x-test-user'] || '');
      if (!userId) { res.sendStatus(401); return; }
      res.locals.tenantId = 'shared-tenant';
      res.locals.userId = userId;
      next();
    },
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/overseas/assistant-threads`;
  const userAHeaders = { 'Content-Type': 'application/json', 'x-test-user': 'user-a' };
  const userBHeaders = { 'Content-Type': 'application/json', 'x-test-user': 'user-b' };
  try {
    const listA = await fetch(base, { headers: userAHeaders }).then(response => response.json());
    assert.equal(listA.items.length, 1);
    assert.match(JSON.stringify(listA), /user-a-private/);
    assert.doesNotMatch(JSON.stringify(listA), /user-b-private|legacy-owner-unknown/);

    const listB = await fetch(base, { headers: userBHeaders }).then(response => response.json());
    assert.equal(listB.items.length, 1);
    assert.match(JSON.stringify(listB), /user-b-private/);
    assert.doesNotMatch(JSON.stringify(listB), /user-a-private|legacy-owner-unknown/);

    const missingPrecondition = await fetch(`${base}/business`, {
      method: 'PUT', headers: userAHeaders, body: JSON.stringify({ draftInput: 'unsafe' }),
    });
    assert.equal(missingPrecondition.status, 428);
    assert.equal((await missingPrecondition.json()).error, 'assistant_thread_version_required');

    const freshWrite = await fetch(`${base}/business`, {
      method: 'PUT', headers: userAHeaders,
      body: JSON.stringify({ expectedVersion: 3, draftInput: 'newest-a-draft' }),
    });
    assert.equal(freshWrite.status, 200);
    const fresh = await freshWrite.json();
    assert.equal(fresh.version, 4);
    assert.equal(fresh.draftInput, 'newest-a-draft');

    const staleWrite = await fetch(`${base}/business`, {
      method: 'PUT', headers: userAHeaders,
      body: JSON.stringify({ expectedVersion: 3, draftInput: 'late-old-draft' }),
    });
    assert.equal(staleWrite.status, 409);
    const conflict = await staleWrite.json();
    assert.equal(conflict.error, 'assistant_thread_version_conflict');
    assert.equal(conflict.current.version, 4);
    assert.equal(conflict.current.draftInput, 'newest-a-draft');

    const userBAfter = await fetch(`${base}/business`, { headers: userBHeaders }).then(response => response.json());
    assert.equal(userBAfter.version, 7);
    assert.equal(userBAfter.draftInput, 'b-draft');
    assert.doesNotMatch(JSON.stringify(userBAfter), /newest-a-draft|late-old-draft/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('assistant thread writes report storage failures instead of returning phantom success', async () => {
  const baseStore = memoryStore([{ id: 'existing', tenantId: 'tenant-a', userId: 'user-a', agentId: 'business', version: 1 }]);
  const failingStore: DataStore = {
    ...baseStore,
    async update() { return false; },
    async compareAndSwap() { return false; },
    async create() { return null; },
  };
  const app = express();
  app.use(express.json());
  app.use('/api/overseas/assistant-threads', createAssistantThreadsRouter({
    dataStore: failingStore,
    actionService: { async route() { throw new Error('not used'); } },
    authMiddleware: (_req, res, next) => {
      res.locals.tenantId = 'tenant-a';
      res.locals.userId = 'user-a';
      next();
    },
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/overseas/assistant-threads`;
  try {
    const update = await fetch(`${base}/business`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedVersion: 1, draftInput: 'x' }),
    });
    assert.equal(update.status, 503);
    assert.equal((await update.json()).error, 'assistant_thread_storage_unavailable');

    const create = await fetch(`${base}/content`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedVersion: 0, draftInput: 'x' }),
    });
    assert.equal(create.status, 503);
    assert.equal((await create.json()).error, 'assistant_thread_storage_unavailable');
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('assistant thread writes fail closed when a backend has no atomic compare-and-swap', async () => {
  const baseStore = memoryStore([{ id: 'existing', tenantId: 'tenant-a', userId: 'user-a', agentId: 'business', version: 1 }]);
  let unsafeUpdates = 0;
  const noCasStore: DataStore = {
    getById: baseStore.getById,
    create: baseStore.create,
    async update() { unsafeUpdates += 1; return true; },
    delete: baseStore.delete,
    list: baseStore.list,
  };
  const app = express();
  app.use(express.json());
  app.use('/api/overseas/assistant-threads', createAssistantThreadsRouter({
    dataStore: noCasStore,
    actionService: { async route() { throw new Error('not used'); } },
    authMiddleware: (_req, res, next) => {
      res.locals.tenantId = 'tenant-a';
      res.locals.userId = 'user-a';
      next();
    },
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/overseas/assistant-threads/business`;
  try {
    const response = await fetch(endpoint, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedVersion: 1, draftInput: 'x' }),
    });
    assert.equal(response.status, 503);
    assert.equal(unsafeUpdates, 0, 'the route must never fall back to an unguarded update');
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('assistant action endpoint preserves known client and service HTTP failures', async () => {
  const actionService: AssistantActionService = {
    async route(input) {
      const status = Number((input as { status?: number }).status);
      if ([400, 403, 404, 503].includes(status)) {
        throw new AssistantActionError(`assistant_test_${status}`, status, `failure-${status}`);
      }
      throw new Error('unexpected transport failure');
    },
  };
  const app = express();
  app.use(express.json());
  app.use('/api/overseas/assistant-threads', createAssistantThreadsRouter({
    dataStore: memoryStore(),
    actionService,
    authMiddleware: (_req, res, next) => {
      res.locals.tenantId = 'tenant-a';
      res.locals.userId = 'user-a';
      next();
    },
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/overseas/assistant-threads`;
  try {
    for (const status of [400, 403, 404, 503]) {
      const response = await fetch(`${base}/content/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      assert.equal(response.status, status);
      const body = await response.json() as { error: string; notification?: { reason?: string } };
      assert.equal(body.error, `assistant_test_${status}`);
      assert.equal(body.notification?.reason, 'failure');
    }

    const unexpected = await fetch(`${base}/content/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(unexpected.status, 503);
    assert.equal((await unexpected.json() as { error: string }).error, 'assistant_action_unavailable');
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('conversation lifecycle clears context, fences stale saves, isolates owners and preserves business records', async () => {
  const dataStore = memoryStore();
  const writes: string[] = [];
  const originalCas = dataStore.compareAndSwap!;
  dataStore.compareAndSwap = async (collection, ...args) => { writes.push(collection); return originalCas(collection, ...args); };
  const app = express(); app.use(express.json());
  app.use('/threads', createAssistantThreadsRouter({ dataStore, authMiddleware: (req, res, next) => {
    res.locals.tenantId = req.headers['x-tenant'] || 'tenant-a'; res.locals.userId = req.headers['x-user'] || 'user-a'; next();
  } }));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/threads`;
  const call = async (url: string, method = 'GET', body?: unknown, headers = {}) => {
    const response = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  try {
    const saved = await call('/business', 'PUT', { expectedVersion: 0, messages: [{ role: 'user', content: '保密的聊天上下文' }], draftInput: '未发草稿' });
    assert.equal(saved.status, 200);
    assert.equal((await call('/business/clear', 'POST', { expectedVersion: 1 }, { 'x-user': 'other' })).status, 404);
    assert.equal((await call('/business', 'DELETE', { expectedVersion: 1 }, { 'x-tenant': 'other' })).status, 404);
    assert.equal((await call('/business/clear', 'POST', {})).status, 428);
    const cleared = await call('/business/clear', 'POST', { expectedVersion: 1 });
    assert.equal(cleared.status, 200); assert.deepEqual(cleared.body.messages, []);
    assert.equal(cleared.body.draftInput, ''); assert.equal(cleared.body.creationDraft, null);
    assert.equal(cleared.body.title, saved.body.title); assert.equal(cleared.body.conversationResetVersion, 2);
    const stale = await call('/business', 'PUT', { expectedVersion: 1, messages: saved.body.messages });
    assert.equal(stale.status, 409); assert.deepEqual(stale.body.current.messages, []);
    assert.equal((await call('/business', 'DELETE', { expectedVersion: 1 })).status, 409);
    assert.equal((await call('/business', 'DELETE', { expectedVersion: 2 })).status, 200);
    assert.equal((await call('/')).body.items.length, 0);
    assert.equal((await call('/business', 'PUT', { expectedVersion: 3, messages: saved.body.messages })).status, 410);
    assert.equal((await call('/conversation:new-test', 'PUT', { expectedVersion: 0, messages: [{ role: 'user', content: '新会话' }] })).status, 200);
    assert.equal((await call('/')).body.items.length, 1);
    assert.ok(writes.every(collection => collection === 'assistant_threads'), 'no task, material, memory or enterprise writes');
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('conversation lifecycle cancels only an unstarted image draft without a formal child run', async () => {
  const baseStore = memoryStore([{ id: 'thread-draft', tenantId: 'tenant-a', userId: 'user-a', agentId: 'business',
    source: 'desktop', version: 1, messages: [
      { role: 'assistant', content: '待提交草稿', creationPortal: { id: 'portal-pending', imageReplication: { intake: { submitted: true } } } },
      { role: 'assistant', content: '已有正式任务', creationPortal: { id: 'portal-formal', imageReplication: { intake: { submitted: true, imageTaskId: 'formal-run' } } } },
      { role: 'assistant', content: '尚未提交', creationPortal: { id: 'portal-idle', imageReplication: { intake: { submitted: false } } } },
    ], taskCards: {} }]);
  const tasks: Row[] = ['pending', 'formal', 'idle'].map(kind => ({ id: `row-${kind}`, tenant_id: 'tenant-a',
    task_id: `task-${kind}`, created_by: 'user-a', create_idempotency_key: `portal-${kind}:content`, task_mode: 'instant',
    status: 'draft', version: '1', run_id: '', weekly_plan_id: '', source_count: 0, artifact_count: 0,
    delivery_package_count: 0, publication_count: 0, metric_submission_count: 0 }));
  const childRuns: Row[] = [{ id: 'formal-run', tenant_id: 'tenant-a', workflow_task_id: 'task-formal' }];
  const dataStore: DataStore = {
    ...baseStore,
    async list<T>(collection: string, query: ListQuery = {}) {
      const source = collection === 'starter_social_content_tasks' ? tasks
        : collection === 'studio_projects' ? childRuns : null;
      if (!source) return baseStore.list<T>(collection, query);
      const items = source.filter(row => Object.entries(query.where ?? {}).every(([key, value]) => row[key] === value));
      return { items: items as T[], totalItems: items.length, totalPages: 1, page: 1, perPage: query.perPage ?? 20 };
    },
    async compareAndSwap(collection, id, expected, data) {
      if (collection !== 'starter_social_content_tasks') return baseStore.compareAndSwap!(collection, id, expected, data);
      const row = tasks.find(item => item.id === id);
      if (!row || !Object.entries(expected).every(([key, value]) => row[key] === value)) return false;
      Object.assign(row, structuredClone(data)); return true;
    },
  };
  const app = express(); app.use(express.json());
  app.use('/threads', createAssistantThreadsRouter({ dataStore, authMiddleware: (_req, res, next) => {
    res.locals.tenantId = 'tenant-a'; res.locals.userId = 'user-a'; next();
  } }));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/threads/business/clear`;
  try {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedVersion: 1 }) });
    assert.equal(response.status, 200);
    assert.equal(tasks.find(row => row.task_id === 'task-pending')?.status, 'cancelled');
    assert.equal(tasks.find(row => row.task_id === 'task-pending')?.cancellation_reason, 'assistant_conversation_discarded');
    assert.equal(tasks.find(row => row.task_id === 'task-formal')?.status, 'draft', 'a bound child run is a formal task');
    assert.equal(tasks.find(row => row.task_id === 'task-idle')?.status, 'draft', 'an unsubmitted intake is only conversation state');
    const restored = await fetch(endpoint.replace('/clear', '/restore'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedVersion: 2 }) });
    assert.equal(restored.status, 200);
    const restoredBody = await restored.json() as { messages: Array<{ creationPortal: { id: string; imageReplication: { intake: { submitted: boolean } } } }> };
    assert.equal(restoredBody.messages[0]?.creationPortal.imageReplication.intake.submitted, false);
    assert.match(restoredBody.messages[0]?.creationPortal.id || '', /^portal-pending-retry-3$/);
    assert.equal(restoredBody.messages[1]?.creationPortal.id, 'portal-formal', 'formal task checkpoints remain resumable');
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test.after(() => {
  for (const [key, value] of Object.entries(previousEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
