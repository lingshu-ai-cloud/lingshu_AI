import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { isDeepStrictEqual } from 'node:util';
import type { AddressInfo } from 'node:net';
import type { DataStore, ListQuery, Record_ } from '../storage/datastore.js';
import {
  ENTERPRISE_ONBOARDING_SCHEMA_VERSION,
  validateEnterpriseOnboardingConfirmation,
  type EnterpriseOnboardingDraft,
} from '../../shared/contracts/enterpriseOnboarding.js';
import { claimEnterpriseOnboardingDraft, clearEnterpriseOnboardingDraft, createEnterpriseOnboardingDraftRouter, markEnterpriseOnboardingDraftRetryable } from './enterpriseOnboardingDraft.js';

function memoryStore() {
  const rows = new Map<string, Record_[]>();
  let sequence = 0;
  const store: DataStore = {
    supportsAtomicCompareAndSwapFor: async () => true,
    getById: async <T>(collection: string, id: string) => (rows.get(collection)?.find(row => row.id === id) || null) as T | null,
    create: async <T>(collection: string, data: Record<string, unknown>) => {
      const list = rows.get(collection) || [];
      if (list.some(row => row.tenant_id === data.tenant_id && row.user_id === data.user_id)) throw new Error('unique constraint');
      const row = { id: String(data.id || `row-${++sequence}`), ...structuredClone(data) } as Record_;
      list.push(row); rows.set(collection, list); return row as T;
    },
    update: async (collection, id, data) => {
      const row = rows.get(collection)?.find(item => item.id === id);
      if (!row) return false;
      Object.assign(row, structuredClone(data)); return true;
    },
    compareAndSwap: async (collection, id, expected, data) => {
      const row = rows.get(collection)?.find(item => item.id === id);
      if (!row || !Object.entries(expected).every(([key, value]) => isDeepStrictEqual(row[key], value))) return false;
      Object.assign(row, structuredClone(data)); return true;
    },
    delete: async (collection, id) => {
      const list = rows.get(collection) || []; const next = list.filter(row => row.id !== id);
      rows.set(collection, next); return next.length !== list.length;
    },
    list: async <T>(collection: string, query?: ListQuery) => {
      const items = (rows.get(collection) || []).filter(row => Object.entries(query?.where || {}).every(([key, value]) => row[key] === value));
      return { items: items as T[], totalItems: items.length, totalPages: items.length ? 1 : 0, page: 1, perPage: query?.perPage || 20 };
    },
  };
  return { store, rows };
}

function draft(step: 1 | 2 | 3 | 4 = 1): EnterpriseOnboardingDraft {
  return {
    schemaVersion: ENTERPRISE_ONBOARDING_SCHEMA_VERSION, revision: 0, currentStep: step,
    confirmationId: 'onboarding:draft-001', baseFactVersion: 'fact-v1',
    companyName: '灵枢科技', brandName: 'Aurelia', industry: '工业自动化', primaryBusiness: '视觉检测设备',
    companyIntro: '企业简介', brandTone: '专业清晰', products: [], focusProductIds: [], targetMarket: '', targetBuyer: '',
    primaryPlatform: '', language: '英语', primaryCta: '', sources: { companyName: 'user_provided' }, updatedAt: '',
  };
}

function completeDraft(): EnterpriseOnboardingDraft {
  return {
    ...draft(4), products: [{ id: 'product-1', name: '视觉检测设备', category: '检测设备', highlights: '高精度检测' }],
    focusProductIds: ['product-1'], targetMarket: '北美', targetBuyer: '采购经理', primaryPlatform: 'linkedin',
    language: '英语', contentStage: 'b2b_launch', primaryCta: '联系销售获取方案',
  };
}

async function serve(store: DataStore) {
  const app = express(); app.use(express.json());
  app.use((req, res, next) => {
    res.locals.tenantId = String(req.headers['x-tenant'] || 'tenant-a');
    res.locals.userId = String(req.headers['x-user'] || 'user-a'); next();
  });
  app.use('/draft', createEnterpriseOnboardingDraftRouter(store));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/draft`;
  const request = async (method: 'GET' | 'PUT', payload?: unknown, headers: Record<string, string> = {}) => {
    const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json', ...headers }, ...(payload ? { body: JSON.stringify(payload) } : {}) });
    return { status: response.status, body: await response.json() as any };
  };
  return { request, close: async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}

test('draft route resumes per user, uses CAS, and replays an uncertain exact save', async () => {
  const memory = memoryStore(); const api = await serve(memory.store);
  try {
    const empty = await api.request('GET');
    assert.equal(empty.body.draft, null); assert.equal(empty.body.revision, 0);
    const created = await api.request('PUT', { draft: draft(2), expectedRevision: 0 });
    assert.equal(created.status, 200); assert.equal(created.body.draft.revision, 1);
    assert.equal((await api.request('GET')).body.draft.currentStep, 2);
    assert.equal((await api.request('GET', undefined, { 'x-user': 'user-b' })).body.draft, null);

    const exactRetry = await api.request('PUT', { draft: draft(2), expectedRevision: 0 });
    assert.equal(exactRetry.status, 200); assert.equal(exactRetry.body.draft.revision, 1);

    const conflict = await api.request('PUT', { draft: { ...draft(3), companyName: '另一家企业' }, expectedRevision: 0 });
    assert.equal(conflict.status, 409); assert.equal(conflict.body.draft.companyName, '灵枢科技');

    const updated = await api.request('PUT', { draft: { ...created.body.draft, currentStep: 3 }, expectedRevision: 1 });
    assert.equal(updated.status, 200); assert.equal(updated.body.draft.revision, 2);
  } finally { await api.close(); }
});

test('draft clear requires the same authenticated owner and confirmation id', async () => {
  const memory = memoryStore(); const api = await serve(memory.store);
  try {
    const saved = await api.request('PUT', { draft: completeDraft(), expectedRevision: 0 });
    await assert.rejects(clearEnterpriseOnboardingDraft(memory.store, { tenantId: 'tenant-a', userId: 'user-a' }, 'different', null));
    assert.equal((await api.request('GET')).body.draft.confirmationId, 'onboarding:draft-001');
    await assert.rejects(clearEnterpriseOnboardingDraft(memory.store, { tenantId: 'tenant-a', userId: 'user-b' }, 'onboarding:draft-001', null));
    assert.equal((await api.request('GET')).body.draft.confirmationId, 'onboarding:draft-001');
    const confirmation = validateEnterpriseOnboardingConfirmation({ ...saved.body.draft, draftRevision: 1 }).confirmation!;
    const token = await claimEnterpriseOnboardingDraft(memory.store, { tenantId: 'tenant-a', userId: 'user-a' }, confirmation);
    assert.equal((await api.request('PUT', { draft: completeDraft(), expectedRevision: 2 })).status, 409);
    await clearEnterpriseOnboardingDraft(memory.store, { tenantId: 'tenant-a', userId: 'user-a' }, 'onboarding:draft-001', token);
    const cleared = await api.request('GET');
    assert.equal(cleared.body.draft, null); assert.equal(cleared.body.revision, 3);
    const restarted = await api.request('PUT', { draft: { ...draft(1), confirmationId: 'onboarding:draft-002' }, expectedRevision: 3 });
    assert.equal(restarted.status, 200); assert.equal(restarted.body.draft.revision, 4);
  } finally { await api.close(); }
});

test('same confirmation has one live claimant and stale recovery fences the former owner', async () => {
  const memory = memoryStore(); const api = await serve(memory.store);
  try {
    const saved = await api.request('PUT', { draft: completeDraft(), expectedRevision: 0 });
    const confirmation = validateEnterpriseOnboardingConfirmation({ ...saved.body.draft, draftRevision: 1 }).confirmation!;
    const owner = await claimEnterpriseOnboardingDraft(memory.store, { tenantId: 'tenant-a', userId: 'user-a' }, confirmation);
    assert.ok(owner);
    await assert.rejects(
      claimEnterpriseOnboardingDraft(memory.store, { tenantId: 'tenant-a', userId: 'user-a' }, confirmation),
      (error: unknown) => error instanceof Error && error.message.includes('原确认正在处理'),
    );
    const row = memory.rows.get('enterprise_onboarding_drafts')![0];
    row.updated_at = new Date(Date.now() - 11 * 60_000).toISOString();
    const recovered = await claimEnterpriseOnboardingDraft(memory.store, { tenantId: 'tenant-a', userId: 'user-a' }, confirmation);
    assert.ok(recovered && recovered !== owner);
    await assert.rejects(clearEnterpriseOnboardingDraft(memory.store, { tenantId: 'tenant-a', userId: 'user-a' }, confirmation.confirmationId, owner));
    await clearEnterpriseOnboardingDraft(memory.store, { tenantId: 'tenant-a', userId: 'user-a' }, confirmation.confirmationId, recovered);
    assert.equal(await claimEnterpriseOnboardingDraft(memory.store, { tenantId: 'tenant-a', userId: 'user-a' }, confirmation), null);
  } finally { await api.close(); }
});

test('positively known no-write failure permits immediate replay of the exact confirmation', async () => {
  const memory = memoryStore(); const api = await serve(memory.store);
  try {
    const saved = await api.request('PUT', { draft: completeDraft(), expectedRevision: 0 });
    const confirmation = validateEnterpriseOnboardingConfirmation({ ...saved.body.draft, draftRevision: 1 }).confirmation!;
    const first = await claimEnterpriseOnboardingDraft(memory.store, { tenantId: 'tenant-a', userId: 'user-a' }, confirmation);
    await markEnterpriseOnboardingDraftRetryable(memory.store, { tenantId: 'tenant-a', userId: 'user-a' }, confirmation.confirmationId, first);
    assert.equal((await api.request('PUT', { draft: completeDraft(), expectedRevision: 2 })).status, 409);
    const second = await claimEnterpriseOnboardingDraft(memory.store, { tenantId: 'tenant-a', userId: 'user-a' }, confirmation);
    assert.ok(second && second !== first);
    await assert.rejects(clearEnterpriseOnboardingDraft(memory.store, { tenantId: 'tenant-a', userId: 'user-a' }, confirmation.confirmationId, first));
    await clearEnterpriseOnboardingDraft(memory.store, { tenantId: 'tenant-a', userId: 'user-a' }, confirmation.confirmationId, second);
  } finally { await api.close(); }
});

test('confirmation rejects a stale tab and changed content even with the same confirmation id', async () => {
  const memory = memoryStore(); const api = await serve(memory.store);
  try {
    const first = await api.request('PUT', { draft: completeDraft(), expectedRevision: 0 });
    const stale = validateEnterpriseOnboardingConfirmation({ ...first.body.draft, draftRevision: 1 }).confirmation!;
    const second = await api.request('PUT', { draft: { ...first.body.draft, primaryCta: '申请样品' }, expectedRevision: 1 });
    assert.equal(second.status, 200);
    await assert.rejects(claimEnterpriseOnboardingDraft(memory.store, { tenantId: 'tenant-a', userId: 'user-a' }, stale), /确认资料已在另一个窗口更新/);
    await assert.rejects(claimEnterpriseOnboardingDraft(memory.store, { tenantId: 'tenant-a', userId: 'user-a' }, { ...stale, draftRevision: 2 }), /确认资料已在另一个窗口更新/);
    assert.equal((await api.request('GET')).body.draft.primaryCta, '申请样品');
  } finally { await api.close(); }
});
