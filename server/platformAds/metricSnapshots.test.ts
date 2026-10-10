import assert from 'node:assert/strict';
import type { DataStore } from '../storage/datastore.js';
import { createAdMetricSnapshotService, metricHistoryWindow } from './metricSnapshots.js';
import type { PlatformAdMetricResource } from '../../shared/platformAdMetricHistory.js';
const records = new Map<string, any>();
let drop = false, loseLease = false, effects = 0, calls = 0;
const dataStore: DataStore = {
  async getById<T>(_collection: string, id: string) { return (records.get(id) || null) as T | null; },
  async create<T>(_collection: string, data: any) { const saved = structuredClone(data); if (drop) delete saved.values; records.set(data.id, saved); return saved as T; },
  async update(_collection, id, data) { records.set(id, structuredClone(data)); return true; },
  async delete(_collection, id) { return records.delete(id); },
  async list<T>(_collection: string, query: any) { const items = [...records.values()].filter(row => row.tenant_id === query.where.tenant_id); return { items: items as T[], totalPages: 1, totalItems: items.length, page: 1, perPage: 200 }; },
};
const resource: PlatformAdMetricResource = { provider: 'meta', accountId: 'acct1', campaignId: 'campaign1', currency: 'USD', metricDefinition: 'meta:thruplay', metricLabel: 'Meta ThruPlay', reportTimezone: '', daily: [{ date: '2026-09-27', spend: 10, impressions: 100, clicks: null, results: 5 }] };
let resources = [resource];
let source = 'provider';
const service = createAdMetricSnapshotService({ dataStore, taskExists: async (tenant, task) => tenant === 'other' || task === 'missing' ? null : {}, readMetrics: async () => { calls++; return { source, reportedAt: '2026-09-27T12:00:00Z', window: { since: '2026-09-21', until: '2026-09-27' }, resources }; }, lock: async (_tenant, _id, fn) => fn({ beforeEffect: async () => { effects++; if (loseLease) throw new Error('lease lost'); } }) });
assert.throws(() => metricHistoryWindow('2026-02-30', '2026-03-01'));
assert.throws(() => metricHistoryWindow('2025-01-01', '2026-01-02'));
await service.sync('tenant', 'task1');
assert.equal(records.size, 1);
resource.daily[0].spend = 12;
await service.sync('tenant', 'task1');
await service.sync('tenant', 'task2');
assert.equal(records.size, 1);
assert.equal([...records.values()][0].values.spend, 12);
assert.deepEqual([...records.values()][0].taskIds, ['task1', 'task2']);
const before = calls;
const history = await service.history('tenant', 'task1', '2026-09-01', '2026-09-27');
assert.equal(calls, before);
assert.equal(history.items.length, 1);
assert.equal(history.items[0].values.clicks, null);
assert.equal(history.items[0].reportTimezone, '');
assert.equal('taskIds' in history.items[0], false);
assert.equal('tenant_id' in history.items[0], false);
assert.equal((await service.history('tenant2', 'task1', '2026-09-01', '2026-09-27')).items.length, 0);
await assert.rejects(service.sync('other', 'task1'), /未找到/);
await assert.rejects(service.history('tenant', 'missing', '2026-09-01', '2026-09-27'), /未找到/);
resources = [resource, structuredClone(resource)];
await service.sync('tenant', 'task1');
assert.equal(records.size, 1);
resources[1].daily[0].spend = 15;
await assert.rejects(service.sync('tenant', 'task1'), /重复且不一致/);
resources = [{ ...resource, currency: 'CNY' }];
await service.sync('tenant', 'task1');
assert.equal(records.size, 2);
resources = [{ ...resource, daily: [] }];
assert.equal((await service.sync('tenant', 'task1')).savedRows, 0);
assert.equal(records.size, 2);
source = 'none';
await assert.rejects(service.sync('tenant', 'task1'), /尚无/);
source = 'provider';
resources = [{ ...resource, campaignId: 'new' }];
loseLease = true;
await assert.rejects(service.sync('tenant', 'task1'), /lease lost/);
assert.equal(records.size, 2);
loseLease = false;
drop = true;
await assert.rejects(service.sync('tenant', 'task1'), /读回校验/);
assert.ok(effects > 0);
console.log('platform ad metric snapshots tests passed');
