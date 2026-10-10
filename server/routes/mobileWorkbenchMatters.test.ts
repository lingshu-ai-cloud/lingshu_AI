import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { DataStore, Record_ } from '../storage/datastore.js';
import { createMobileWorkbenchMattersRouter } from './mobileWorkbenchMatters.js';

function storeWith(rows: Record<string, Record_[]>): DataStore {
  return {
    getById: async <T>(collection: string, id: string) => (rows[collection] || []).find(row => row.id === id) as T || null,
    list: async <T>() => ({ items: [] as T[], totalItems: 0, totalPages: 1, page: 1, perPage: 100 }),
    create: async <T>() => null as T | null,
    update: async () => false,
    delete: async () => false,
  };
}

async function serve(dataStore: DataStore, role: 'admin' | 'customer_service' = 'admin') {
  const app = express();
  app.use((req, res, next) => { res.locals.tenantId = String(req.headers['x-tenant'] || 'tenant-a'); res.locals.userId = 'user-a'; next(); });
  app.use('/mobile-workbench', createMobileWorkbenchMattersRouter(dataStore, {
    resolveRole: async () => role,
    productionDetail: async input => ({ matterId: `task:${input.targetId}`, subjectVersion: 'quality-v2', title: '成片修复', source: { entityId: 'project-a' },
      actionOptions: [{ id: 'repair', kind: 'scoped_repair', enabled: true, payload: { sceneIds: ['scene-1'] } }] }),
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { get: async (path: string, tenant = 'tenant-a') => { const response = await fetch(base + path, { headers: { 'x-tenant': tenant } }); return { status: response.status, body: await response.json() as any }; },
    close: async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}

test('matter detail is tenant scoped and projects a frozen approval decision', async () => {
  const api = await serve(storeWith({ approval_requests: [{ id: 'approval-a', tenant_id: 'tenant-a', status: 'pending', subject_version: 7, action_summary: '确认发布' }] }));
  try {
    const result = await api.get('/mobile-workbench/matters/approval%3Aapproval-a');
    assert.equal(result.status, 200);
    assert.equal(result.body.matter.subjectVersion, '7');
    assert.deepEqual(result.body.matter.actionOptions.map((option: any) => option.kind), ['approval_decision', 'approval_decision']);
    assert.equal((await api.get('/mobile-workbench/matters/approval%3Aapproval-a', 'tenant-b')).status, 404);
  } finally { await api.close(); }
});

test('quality task uses production detail and disables actions outside the role capability', async () => {
  const dataStore = storeWith({ workflow_tasks: [{ id: 'task-a', tenant_id: 'tenant-a', task_key: 'content_quality_gate', status: 'blocked', output: {} }] });
  const api = await serve(dataStore, 'customer_service');
  try {
    const result = await api.get('/mobile-workbench/matters/task%3Atask-a');
    assert.equal(result.status, 200);
    assert.equal(result.body.matter.source.entityId, 'project-a');
    assert.equal(result.body.matter.actionOptions[0].enabled, false);
    assert.match(result.body.matter.actionOptions[0].disabledReason, /无权/);
  } finally { await api.close(); }
});

test('task intervention metadata resolves the existing account repair route but stays disabled without live recovery', async () => {
  const dataStore = storeWith({
    workflow_tasks: [{ id: 'task-a', tenant_id: 'tenant-a', status: 'blocked', output: { interventionType: 'authorization', accountId: 'account-a', requiredScopes: ['video.publish'], checkpointId: 'publish' } }],
    social_accounts: [{ id: 'account-a', tenantId: 'tenant-a', title: 'TikTok 主账号', platform: 'tiktok', status: 'expired', scope: 'user.info.basic', accessToken: 'must-not-leak' }],
  });
  const api = await serve(dataStore);
  try {
    const result = await api.get('/mobile-workbench/matters/task%3Atask-a');
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.matter.connection.missingScopes, ['video.publish']);
    assert.equal(result.body.matter.actionOptions[0].enabled, false);
    assert.match(result.body.matter.actionOptions[0].disabledReason, /尚未接通/);
    assert.equal(JSON.stringify(result.body).includes('must-not-leak'), false);
  } finally { await api.close(); }
});
