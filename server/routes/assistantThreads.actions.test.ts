import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import express from 'express';
import { AssistantActionError, type AssistantActionService } from '../assistant/actionRouting.js';
import { Starter198RepositoryError, starter198Repository } from '../starter198/repository.js';
import type { DataStore, ListQuery } from '../storage/datastore.js';

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
    details: ['5 条母版', '18 条平台版本', '预算 50–75 元'],
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
  const valid = {
    messages: [{ role: 'user', content: '请规划本周内容' }, { role: 'assistant', content: '请确认计划。' }],
    draftInput: '我想先调整预算',
    scrollPosition: 288,
    unreadCount: 2,
    isFollowingLatest: false,
    paused: true,
    taskCards: { 'run:one': card },
    focusedTaskId: 'run:one',
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
    assert.equal(saved.focusedTaskId, 'run:one');
    assert.deepEqual(saved.taskCards['run:one'], {
      ...card,
      primaryAction: { id: 'confirm-plan', label: '确认并开始' },
    });

    const loaded = await fetch(`${base}/business`, { headers }).then(response => response.json());
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
    assert.equal(partialBody.paused, true);
    assert.equal(partialBody.focusedTaskId, 'run:one');
    assert.deepEqual(Object.keys(partialBody.taskCards), ['run:one']);

    const otherTenant = await fetch(`${base}/business`, {
      headers: { ...headers, 'x-test-tenant': 'tenant-b' },
    }).then(response => response.json());
    assert.deepEqual(otherTenant.taskCards, {});
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

    const malformed = await fetch(`${base}/business`, {
      method: 'PUT', headers,
      body: JSON.stringify({ ...valid, expectedVersion: 2, paused: 'yes' }),
    });
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json()).error, 'assistant_thread_pause_state_invalid');

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

test.after(() => {
  for (const [key, value] of Object.entries(previousEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
