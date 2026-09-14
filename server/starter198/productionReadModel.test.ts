import assert from 'node:assert/strict';
import type { DataStore, ListQuery } from '../storage/datastore.js';
import { readStarterProductionModel, StarterProductionReadError } from './productionReadModel.js';

const tenantId = 'tenant-read-a';
const queries: Array<{ collection: string; where: Record<string, unknown> }> = [];
const rows: Record<string, Array<Record<string, unknown> & { id: string }>> = {
  trend_videos: [{
    id: 'trend-a', tenantId, title: '德国经销商礼品趋势\u0000 contact@example.test', platform: 'tiktok',
    status: 'analyzed', crawledAt: '2026-09-12T08:00:00.000Z',
    sourceUrl: 'https://example.com/trend-a',
    aiAnalysis: { theme: '礼品定制', internalPrompt: 'must-not-be-projected' },
  }],
  studio_projects: [{
    id: 'project-a', tenant_id: tenantId, title: 'TB-750 首发内容 +86 138 0013 8000', status: 'ready_for_approval',
    updated_at: '2026-09-12T09:00:00.000Z',
    spec: { productInfo: 'TB-750', format: '15s', workflowRunId: 'run-a', providerSecret: 'must-not-be-projected' },
  }],
  whatsapp_customers: [{
    id: 'customer-a', tenant_id: tenantId, customer_id: 'buyer-a', name: '德国买家', stage: 'inquiry',
    last_active_at: '2026-09-12T10:00:00.000Z',
    payload: { handlingReason: '等待补充数量', source: 'manual_import', waNumber: 'must-not-be-projected' },
  }],
};

const dataStore = {
  async list(collection: string, query: ListQuery = {}) {
    queries.push({ collection, where: { ...(query.where ?? {}) } });
    const selected = (rows[collection] ?? []).filter(row => Object.entries(query.where ?? {})
      .every(([key, value]) => String(row[key] ?? '') === String(value)));
    return { items: selected, totalItems: selected.length, totalPages: 1, page: 1, perPage: query.perPage ?? 20 };
  },
  async getById() { return null; },
  async create() { return null; },
  async update() { return false; },
  async delete() { return false; },
} as DataStore;

const model = await readStarterProductionModel(tenantId, dataStore);
assert.deepEqual(queries, [
  { collection: 'trend_videos', where: { tenantId } },
  { collection: 'studio_projects', where: { tenant_id: tenantId } },
  { collection: 'whatsapp_customers', where: { tenant_id: tenantId } },
]);
assert.equal(model.inspiration.items[0].summary, '礼品定制');
assert.equal(model.content.items[0].summary, 'TB-750 · 15s');
assert.match(model.content.items[0].evidence ?? '', /^工作流已绑定 · [a-f0-9]{12}$/);
assert.equal(model.sales.items[0].summary, '阶段：inquiry');
assert.match(model.sales.items[0].title, /^客户线索 [A-F0-9]{6}$/);
assert.notEqual(model.sales.items[0].id, 'customer-a');
const serialized = JSON.stringify(model);
assert.equal(serialized.includes('must-not-be-projected'), false, 'raw prompts and provider secrets must not reach the read model');
assert.doesNotMatch(serialized, /德国买家|buyer-a|等待补充数量|waNumber|contact@example\.test|138\s*0013\s*8000|\u0000/,
  'customer identity, contact locators and display controls must not reach the read model');

const unavailableStore = {
  ...dataStore,
  async list() { throw new Error('collection unavailable'); },
} as DataStore;
const unavailable = await readStarterProductionModel(tenantId, unavailableStore);
assert.equal(unavailable.inspiration.available, false);
assert.equal(unavailable.content.available, false);
assert.equal(unavailable.sales.available, false);

const violatingStore = {
  ...dataStore,
  async list(collection: string, query: ListQuery = {}) {
    if (collection === 'studio_projects') {
      return {
        items: [{ id: 'foreign', tenant_id: 'tenant-read-b' }], totalItems: 1,
        totalPages: 1, page: 1, perPage: query.perPage ?? 20,
      };
    }
    return { items: [], totalItems: 0, totalPages: 0, page: 1, perPage: query.perPage ?? 20 };
  },
} as DataStore;
await assert.rejects(
  () => readStarterProductionModel(tenantId, violatingStore),
  (error: unknown) => error instanceof StarterProductionReadError
    && error.code === 'starter_198_production_read_tenant_violation',
);

console.log('starter_198 production read model passed');
