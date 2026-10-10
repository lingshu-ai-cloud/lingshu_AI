import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { DataStore, ListQuery, Record_ } from '../storage/datastore.js';
import { createMobileWorkbenchActionsRouter, createMobileWorkbenchDomainExecutor } from './mobileWorkbenchActions.js';

function memoryStore(seed: Record<string, Record_[]> = {}) {
  const rows = new Map<string, Record_[]>;
  for (const [collection, values] of Object.entries(seed)) rows.set(collection, values.map(value => ({ ...value })));
  const store: DataStore = {
    getById: async <T>(collection: string, id: string) => (rows.get(collection)?.find(row => row.id === id) ?? null) as T | null,
    create: async <T>(collection: string, data: Record<string, unknown>) => {
      const list = rows.get(collection) ?? [];
      if (list.some(row => row.id === data.id)) throw new Error('duplicate');
      const row = { ...data } as Record_;
      list.push(row); rows.set(collection, list); return row as T;
    },
    update: async (collection, id, data) => {
      const row = rows.get(collection)?.find(item => item.id === id);
      if (!row) return false;
      Object.assign(row, data); return true;
    },
    delete: async (collection, id) => {
      const list = rows.get(collection) ?? []; const next = list.filter(row => row.id !== id);
      rows.set(collection, next); return next.length !== list.length;
    },
    list: async <T>(collection: string, query?: ListQuery) => {
      const items = (rows.get(collection) ?? []).filter(row => Object.entries(query?.where ?? {}).every(([key, value]) => row[key] === value)) as T[];
      return { items, totalItems: items.length, totalPages: 1, page: 1, perPage: items.length || 1 };
    },
  };
  return { store, rows };
}

async function serve(store: DataStore, executor?: Parameters<typeof createMobileWorkbenchActionsRouter>[1]) {
  const app = express();
  app.use((req, res, next) => {
    if (!req.headers['x-tenant']) { res.sendStatus(401); return; }
    res.locals.tenantId = req.headers['x-tenant']; res.locals.userId = req.headers['x-user'] || 'user-a';
    if (req.headers['x-support']) res.locals.supportAccess = { requestId: 'support' };
    next();
  });
  app.use('/mobile', createMobileWorkbenchActionsRouter(store, executor));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = async (path: string, init: RequestInit = {}, tenant = 'tenant-a', user = 'user-a') => {
    const response = await fetch(base + path, { ...init, headers: { 'Content-Type': 'application/json', 'x-tenant': tenant, 'x-user': user, ...(init.headers || {}) } });
    return { status: response.status, body: await response.json() as any };
  };
  return { request, close: async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}

const approvalAction = {
  kind: 'approval_decision', targetId: 'approval-a', expectedVersion: '3', idempotencyKey: 'approve-0001',
  payload: { decision: 'approved', note: '可以执行' },
};

test('accepted receipt is durable, idempotent, user scoped, and does not claim business completion', async () => {
  const { store, rows } = memoryStore({ approval_requests: [
    { id: 'approval-a', tenant_id: 'tenant-a', status: 'pending', subject_version: 3 },
    { id: 'approval-b', tenant_id: 'tenant-b', status: 'pending', subject_version: 1 },
  ] });
  const api = await serve(store);
  try {
    const first = await api.request('/mobile/actions', { method: 'POST', body: JSON.stringify(approvalAction) });
    assert.equal(first.status, 202); assert.equal(first.body.receipt.status, 'accepted'); assert.equal(first.body.receipt.result, null);
    const replay = await api.request('/mobile/actions', { method: 'POST', body: JSON.stringify(approvalAction) });
    assert.equal(replay.status, 202); assert.equal(replay.body.replayed, true); assert.equal(replay.body.receipt.id, first.body.receipt.id);
    assert.equal(rows.get('mobile_workbench_action_receipts')?.length, 1);
    const read = await api.request(`/mobile/actions/${first.body.receipt.id}`);
    assert.equal(read.status, 200); assert.equal(read.body.receipt.status, 'accepted');
    assert.equal((await api.request(`/mobile/actions/${first.body.receipt.id}`, {}, 'tenant-b')).status, 404);
    assert.equal((await api.request(`/mobile/actions/${first.body.receipt.id}`, {}, 'tenant-a', 'user-b')).status, 404);
    const conflict = await api.request('/mobile/actions', { method: 'POST', body: JSON.stringify({ ...approvalAction, payload: { decision: 'rejected' } }) });
    assert.equal(conflict.status, 409); assert.equal(conflict.body.error, 'mobile_action_idempotency_conflict');
    assert.equal((await api.request('/mobile/actions', { method: 'POST', body: JSON.stringify({ ...approvalAction, targetId: 'approval-b', idempotencyKey: 'approve-0002', expectedVersion: '1' }) })).status, 404);
  } finally { await api.close(); }
});

test('version, actionability, payload and support permissions fail before a receipt is created', async () => {
  const { store, rows } = memoryStore({
    approval_requests: [{ id: 'approval-a', tenant_id: 'tenant-a', status: 'pending', subject_version: 3 }],
    workflow_tasks: [{ id: 'task-a', tenant_id: 'tenant-a', status: 'succeeded', task_version: 2 }],
  });
  const api = await serve(store);
  try {
    assert.equal((await api.request('/mobile/actions', { method: 'POST', body: JSON.stringify({ ...approvalAction, expectedVersion: '2' }) })).body.error, 'mobile_action_version_conflict');
    assert.equal((await api.request('/mobile/actions', { method: 'POST', body: JSON.stringify({ ...approvalAction, payload: { decision: 'maybe' } }) })).status, 400);
    const retry = { kind: 'retry_task', targetId: 'task-a', expectedVersion: '2', idempotencyKey: 'retry-0001', payload: {} };
    assert.equal((await api.request('/mobile/actions', { method: 'POST', body: JSON.stringify(retry) })).body.error, 'mobile_action_not_actionable');
    assert.equal((await api.request('/mobile/actions', { method: 'POST', body: JSON.stringify(approvalAction), headers: { 'x-support': '1' } })).status, 403);
    assert.equal(rows.get('mobile_workbench_action_receipts')?.length ?? 0, 0);
  } finally { await api.close(); }
});

test('executor transitions through running and preserves a queryable failure', async () => {
  const { store, rows } = memoryStore({ approval_requests: [{ id: 'approval-a', tenant_id: 'tenant-a', status: 'pending', subject_version: 3 }] });
  const seen: string[] = [];
  const api = await serve(store, async input => {
    seen.push(String(rows.get('mobile_workbench_action_receipts')?.find(row => row.id === input.receiptId)?.status));
    throw new Error('domain_permission_denied');
  });
  try {
    const failed = await api.request('/mobile/actions', { method: 'POST', body: JSON.stringify(approvalAction) });
    assert.equal(failed.status, 200); assert.deepEqual(seen, ['running']);
    assert.equal(failed.body.receipt.status, 'failed'); assert.equal(failed.body.receipt.error.code, 'domain_permission_denied');
    const queried = await api.request(`/mobile/actions/${failed.body.receipt.id}`);
    assert.equal(queried.body.receipt.status, 'failed');
    const replay = await api.request('/mobile/actions', { method: 'POST', body: JSON.stringify(approvalAction) });
    assert.equal(replay.body.receipt.status, 'failed'); assert.equal(replay.body.replayed, true); assert.equal(seen.length, 1);
  } finally { await api.close(); }
});

test('domain executor delegates approval and retry without weakening scoped inputs', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const executor = createMobileWorkbenchDomainExecutor({
    decideApproval: async input => { calls.push({ type: 'approval', ...input }); return { state: 'decided' }; },
    retryTask: async input => { calls.push({ type: 'retry', ...input }); return { runId: 'run-a' }; },
  });
  await executor({ tenantId: 'tenant-a', userId: 'user-a', receiptId: 'receipt-a', subject: { id: 'approval-a' }, action: approvalAction as any });
  await executor({ tenantId: 'tenant-a', userId: 'user-a', receiptId: 'receipt-b', subject: { id: 'task-a' }, action: { kind: 'retry_task', targetId: 'task-a', expectedVersion: '7', idempotencyKey: 'retry-0001', payload: { instruction: '再试一次', rerunDownstream: false } } });
  assert.deepEqual(calls, [
    { type: 'approval', tenantId: 'tenant-a', userId: 'user-a', approvalId: 'approval-a', decision: 'approved', note: '可以执行', expectedSubjectVersion: '3' },
    { type: 'retry', tenantId: 'tenant-a', userId: 'user-a', taskId: 'task-a', expectedTaskVersion: '7', instruction: '再试一次', rerunDownstream: false },
  ]);
});
