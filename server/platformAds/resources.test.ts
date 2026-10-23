import assert from 'node:assert/strict';
import type { DataStore, ListQuery, Record_ } from '../storage/datastore.js';
import type { AdConnection } from './connections.js';
import { AdProviderError } from './metaAdapter.js';
import { createPlatformAdResourceService } from './resources.js';

const tables = new Map<string, Map<string, Record_>>();
const table = (name: string) => tables.get(name) || (tables.set(name, new Map()), tables.get(name)!);
const dataStore: DataStore = {
  async getById<T>(collection: string, id: string) { return (table(collection).get(id) as T) || null; },
  async create<T>(collection: string, data: Record<string, unknown>) { table(collection).set(String(data.id), data as Record_); return data as T; },
  async update(collection: string, id: string, data: Record<string, unknown>) { const current = table(collection).get(id); if (!current) return false; table(collection).set(id, { ...current, ...data }); return true; },
  async delete(collection: string, id: string) { return table(collection).delete(id); },
  async list<T>(collection: string, query: ListQuery = {}) {
    const items = [...table(collection).values()].filter(item => Object.entries(query.where || {}).every(([key, value]) => item[key] === value)) as T[];
    return { items, totalItems: items.length, totalPages: items.length ? 1 : 0, page: 1, perPage: query.perPage || 30 };
  },
};
const connection: AdConnection = {
  id: 'connection-a', tenant_id: 'tenant-a', provider: 'meta', accountId: '123', name: 'Meta US', currency: 'USD',
  tokenCipher: 'cipher', status: 'connected', timezoneName: 'America/Los_Angeles', updatedAt: '2026-10-22T00:00:00.000Z',
};
table('platform_ad_connections').set(connection.id, connection);
let requested: string[] = [];
const responses: Record<string, unknown[]> = {
  campaigns: [{ id: '10', account_id: 'act_123', name: 'Campaign A', status: 'PAUSED', effective_status: 'PAUSED' }],
  adsets: [{ id: '20', account_id: '123', campaign_id: '10', name: 'Ad set A', status: 'ACTIVE', effective_status: 'ACTIVE' }],
  ads: [{ id: '30', account_id: '123', campaign_id: '10', adset_id: '20', name: 'Ad A', status: 'ACTIVE', effective_status: 'CAMPAIGN_PAUSED' }],
};
const service = createPlatformAdResourceService({
  dataStore,
  credential: async (tenantId, id) => {
    const current = await dataStore.getById<AdConnection>('platform_ad_connections', id);
    if (!current || tenantId !== current.tenant_id) throw new AdProviderError('missing', 'NOT_FOUND');
    return { connection: current, accessToken: 'secret-token' };
  },
  connection: async (tenantId, id) => {
    const current = await dataStore.getById<AdConnection>('platform_ad_connections', id);
    if (!current || tenantId !== current.tenant_id) throw new AdProviderError('missing', 'NOT_FOUND');
    return current;
  },
  adapter: token => ({ request: async path => { assert.equal(token, 'secret-token'); requested.push(path); return { data: responses[path.split('/').at(-1)!] }; } }),
  lock: async (_tenantId, _id, work) => work({ beforeEffect: async () => undefined }),
  now: () => new Date('2026-10-22T08:00:00.000Z'),
});

const synced = await service.sync('tenant-a', 'connection-a');
assert.deepEqual(synced.counts, { campaign: 1, adset: 1, ad: 1 });
assert.equal(synced.accountTimezone, 'America/Los_Angeles');
assert.deepEqual(requested, ['act_123/campaigns', 'act_123/adsets', 'act_123/ads']);
const ads = await service.list('tenant-a', 'connection-a', 'ad');
assert.equal(ads.items.length, 1);
assert.equal(ads.items[0].parentResourceId, '20');
assert.equal(ads.items[0].campaignId, '10');
assert.equal(ads.items[0].effectiveStatus, 'CAMPAIGN_PAUSED');
assert.equal(ads.items[0].accountTimezone, 'America/Los_Angeles');
assert.equal('tenant_id' in ads.items[0], false);
await assert.rejects(() => service.list('tenant-b', 'connection-a', 'campaign'), (error: unknown) => error instanceof AdProviderError && error.code === 'NOT_FOUND');

responses.ads = [{ id: '31', account_id: '999', campaign_id: '10', adset_id: '20' }];
const committedRun = (await dataStore.getById<AdConnection>('platform_ad_connections', connection.id))?.resourceSyncRunId;
await assert.rejects(() => service.sync('tenant-a', 'connection-a'), (error: unknown) => error instanceof AdProviderError && error.code === 'ACCOUNT_MISMATCH');
assert.equal((await dataStore.getById<AdConnection>('platform_ad_connections', connection.id))?.resourceSyncRunId, committedRun, 'failed sync must not publish a partial snapshot');
assert.equal((await service.list('tenant-a', 'connection-a', 'ad')).items[0].providerResourceId, '30');
console.log('platform ad resource synchronization tests passed');
