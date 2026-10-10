import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { DataStore, ListQuery, Record_ } from '../storage/datastore.js';
import type { OrganizationRole } from '../lib/organizationRole.js';
import {
  createMobileWorkbenchActionsRouter,
  createMobileWorkbenchDomainExecutor,
  mobileWorkbenchActionCapabilityAllowed,
} from './mobileWorkbenchActions.js';

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
      let items = (rows.get(collection) ?? []).filter(row => Object.entries(query?.where ?? {}).every(([key, value]) => row[key] === value));
      if (query?.sort) {
        const descending = query.sort.startsWith('-'); const field = descending ? query.sort.slice(1) : query.sort;
        items = [...items].sort((left, right) => String(left[field] ?? '').localeCompare(String(right[field] ?? '')) * (descending ? -1 : 1));
      }
      const page = query?.page ?? 1; const perPage = query?.perPage ?? (items.length || 1); const totalItems = items.length;
      items = items.slice((page - 1) * perPage, page * perPage);
      return { items: items as T[], totalItems, totalPages: Math.max(1, Math.ceil(totalItems / perPage)), page, perPage };
    },
  };
  return { store, rows };
}

async function serve(
  store: DataStore,
  executor?: Parameters<typeof createMobileWorkbenchActionsRouter>[1],
  resolveRole: Parameters<typeof createMobileWorkbenchActionsRouter>[2] = async req => String(req.headers['x-role'] || 'super_admin') as OrganizationRole,
) {
  const app = express();
  app.use((req, res, next) => {
    if (!req.headers['x-tenant']) { res.sendStatus(401); return; }
    res.locals.tenantId = req.headers['x-tenant']; res.locals.userId = req.headers['x-user'] || 'user-a';
    if (req.headers['x-support']) res.locals.supportAccess = { requestId: 'support' };
    next();
  });
  app.use('/mobile', createMobileWorkbenchActionsRouter(store, executor, resolveRole));
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
    assert.equal(first.body.contractVersion, 1); assert.equal(first.body.receipt.terminal, false);
    assert.deepEqual(first.body.receipt.recovery, { pollAfterMs: 1500, canRetry: false, outcomeKnown: false, needsReconciliation: false });
    const replay = await api.request('/mobile/actions', {
      method: 'POST', body: JSON.stringify({ ...approvalAction, payload: { note: '可以执行', decision: 'approved' } }),
    });
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

test('organization roles grant only their server-side action capabilities', async () => {
  assert.equal(mobileWorkbenchActionCapabilityAllowed('super_admin', 'approval_decision'), true);
  assert.equal(mobileWorkbenchActionCapabilityAllowed('admin', 'approval_decision'), true);
  assert.equal(mobileWorkbenchActionCapabilityAllowed('social_operator', 'approval_decision'), false);
  assert.equal(mobileWorkbenchActionCapabilityAllowed('customer_service', 'approval_decision'), false);
  assert.equal(mobileWorkbenchActionCapabilityAllowed('social_operator', 'retry_task'), true);
  assert.equal(mobileWorkbenchActionCapabilityAllowed('customer_service', 'retry_task'), true);
  assert.equal(mobileWorkbenchActionCapabilityAllowed(null, 'retry_task'), false);

  const { store, rows } = memoryStore({
    approval_requests: [{ id: 'approval-a', tenant_id: 'tenant-a', status: 'pending', subject_version: 3 }],
    workflow_tasks: [{ id: 'task-a', tenant_id: 'tenant-a', status: 'failed', task_version: 2 }],
  });
  const executed: string[] = [];
  const api = await serve(store, async input => { executed.push(input.action.kind); return { ok: true }; });
  try {
    for (const role of ['social_operator', 'customer_service'] as const) {
      const denied = await api.request('/mobile/actions', {
        method: 'POST', body: JSON.stringify({ ...approvalAction, idempotencyKey: `approval-${role}` }), headers: { 'x-role': role },
      });
      assert.equal(denied.status, 403);
      assert.equal(denied.body.error, 'mobile_action_capability_required');
      assert.equal(denied.body.capability, 'approval.decide');

      const retry = await api.request('/mobile/actions', {
        method: 'POST',
        body: JSON.stringify({ kind: 'retry_task', targetId: 'task-a', expectedVersion: '2', idempotencyKey: `retry-${role}`, payload: {} }),
        headers: { 'x-role': role },
      });
      assert.equal(retry.status, 200);
      assert.equal(retry.body.receipt.status, 'succeeded');
    }

    for (const role of ['admin', 'super_admin'] as const) {
      const allowed = await api.request('/mobile/actions', {
        method: 'POST', body: JSON.stringify({ ...approvalAction, idempotencyKey: `approval-${role}` }), headers: { 'x-role': role },
      });
      assert.equal(allowed.status, 200);
      assert.equal(allowed.body.receipt.status, 'succeeded');
    }
    assert.deepEqual(executed.sort(), ['approval_decision', 'approval_decision', 'retry_task', 'retry_task'].sort());
    assert.equal(rows.get('mobile_workbench_action_receipts')?.length, 4);
  } finally { await api.close(); }
});

test('missing roles, authorization outages, and support sessions fail closed before receipt creation', async () => {
  const seed = { approval_requests: [{ id: 'approval-a', tenant_id: 'tenant-a', status: 'pending', subject_version: 3 }] };
  for (const scenario of [
    { expectedStatus: 403, expectedError: 'mobile_action_capability_required', resolve: async () => null },
    { expectedStatus: 503, expectedError: 'mobile_action_authorization_unavailable', resolve: async () => { throw new Error('role store unavailable'); } },
  ]) {
    const { store, rows } = memoryStore(seed);
    const api = await serve(store, undefined, scenario.resolve);
    try {
      const response = await api.request('/mobile/actions', { method: 'POST', body: JSON.stringify(approvalAction) });
      assert.equal(response.status, scenario.expectedStatus);
      assert.equal(response.body.error, scenario.expectedError);
      assert.equal(rows.get('mobile_workbench_action_receipts')?.length ?? 0, 0);
    } finally { await api.close(); }
  }

  const { store, rows } = memoryStore(seed);
  let roleLookups = 0;
  const api = await serve(store, undefined, async () => { roleLookups += 1; return 'super_admin'; });
  try {
    const response = await api.request('/mobile/actions', {
      method: 'POST', body: JSON.stringify(approvalAction), headers: { 'x-support': '1', 'x-role': 'super_admin' },
    });
    assert.equal(response.status, 403);
    assert.equal(response.body.error, 'support_access_read_only');
    assert.equal(roleLookups, 0, 'support read-only gate must run before organization authorization');
    assert.equal(rows.get('mobile_workbench_action_receipts')?.length ?? 0, 0);
  } finally { await api.close(); }
});

test('receipt list restores only the authenticated user in-flight commands by default', async () => {
  const { store } = memoryStore({ mobile_workbench_action_receipts: [
    { id: '111111111111111111111111', tenant_id: 'tenant-a', user_id: 'user-a', kind: 'retry_task', target_id: 'task-1', expected_version: '1', status: 'accepted', accepted_at: '2026-10-10T01:00:00.000Z' },
    { id: '222222222222222222222222', tenant_id: 'tenant-a', user_id: 'user-a', kind: 'retry_task', target_id: 'task-2', expected_version: '1', status: 'running', accepted_at: '2026-10-10T02:00:00.000Z', started_at: '2026-10-10T02:01:00.000Z' },
    { id: '333333333333333333333333', tenant_id: 'tenant-a', user_id: 'user-a', kind: 'retry_task', target_id: 'task-3', expected_version: '1', status: 'succeeded', accepted_at: '2026-10-10T03:00:00.000Z', finished_at: '2026-10-10T03:01:00.000Z', result: { runId: 'run-3' } },
    { id: '444444444444444444444444', tenant_id: 'tenant-a', user_id: 'user-b', kind: 'retry_task', target_id: 'task-4', expected_version: '1', status: 'running', accepted_at: '2026-10-10T04:00:00.000Z' },
    { id: '555555555555555555555555', tenant_id: 'tenant-b', user_id: 'user-a', kind: 'retry_task', target_id: 'task-5', expected_version: '1', status: 'running', accepted_at: '2026-10-10T05:00:00.000Z' },
  ] });
  const api = await serve(store);
  try {
    const inflight = await api.request('/mobile/actions');
    assert.equal(inflight.status, 200); assert.equal(inflight.body.contractVersion, 1);
    assert.deepEqual(inflight.body.receipts.map((receipt: any) => receipt.id), ['222222222222222222222222', '111111111111111111111111']);
    assert.ok(inflight.body.receipts.every((receipt: any) => receipt.terminal === false));
    const all = await api.request('/mobile/actions?scope=all&limit=2');
    assert.deepEqual(all.body.receipts.map((receipt: any) => receipt.id), ['333333333333333333333333', '222222222222222222222222']);
    assert.equal((await api.request('/mobile/actions?scope=unknown')).status, 400);
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
