import assert from 'node:assert/strict';
import type { DataStore, ListQuery } from '../storage/datastore.js';
import { sealAccountCredential } from '../lib/accountCredentials.js';
import { createWeeklyPublishingAdapter } from './weeklyPublishingAdapter.js';

type Row = { id: string; [key: string]: any };
function memoryStore(): DataStore & { rows: Map<string, Row[]> } {
  const rows = new Map<string, Row[]>();
  return {
    // Explicit isolated, controlled provider fixture capability.
    supportsAtomicOperationLease: () => true,
    rows,
    async list<T>(collection: string, query: ListQuery = {}) {
      let items = [...(rows.get(collection) || [])];
      for (const [key, value] of Object.entries(query.where || {})) items = items.filter(item => item[key] === value);
      const page = query.page ?? 1, perPage = query.perPage ?? 500, totalItems = items.length;
      return { items: items.slice((page - 1) * perPage, page * perPage) as T[], totalItems, totalPages: Math.ceil(totalItems / perPage), page, perPage };
    },
    async getById<T>(collection: string, id: string) { return ((rows.get(collection) || []).find(row => row.id === id) as T | undefined) ?? null; },
    async create<T>(collection: string, data: Record<string, unknown>) {
      const item = { id: `${collection}-${(rows.get(collection)?.length || 0) + 1}`, ...data };
      rows.set(collection, [...(rows.get(collection) || []), item]);
      return item as T;
    },
    async update() { return false; },
    async delete() { return false; },
  };
}

process.env.PLATFORM_TOKEN_ENCRYPTION_KEY = 'weekly-four-platform-adapter-test-key';
const dataStore = memoryStore();
dataStore.rows.set('youtube_accounts', [{
  id: 'youtube-1', tenantId: 'tenant-a', status: 'connected', clientId: 'client',
  clientSecret: sealAccountCredential('secret'), refreshToken: sealAccountCredential('refresh'), accessToken: '',
}]);
dataStore.rows.set('social_accounts', [
  { id: 'facebook-1', tenantId: 'tenant-a', platform: 'facebook', status: 'connected', accessToken: sealAccountCredential('facebook-token') },
  { id: 'instagram-1', tenantId: 'tenant-a', platform: 'instagram', status: 'connected', accessToken: sealAccountCredential('instagram-token') },
  { id: 'foreign-facebook', tenantId: 'tenant-b', platform: 'facebook', status: 'connected', accessToken: sealAccountCredential('foreign-token') },
]);
dataStore.rows.set('social_platform_capability_evidence', ['youtube', 'facebook', 'instagram'].map((platform, index) => ({
  id: `evidence-${index}`, tenant_id: 'tenant-a', account_id: `${platform}-1`, platform,
  capability: 'publishing.official', status: 'verified', evidence_source: 'provider_probe',
  evidence_ref: `provider:${platform}:account:${platform}-1`, verified_at: '2026-09-25T23:50:00Z',
  expires_at: '2026-09-26T00:05:00Z',
  created_at: '2026-09-25T23:50:00Z', updated_at: '2026-09-25T23:50:00Z',
})));

for (const platform of ['youtube', 'facebook', 'instagram'] as const) {
  const adapter = await createWeeklyPublishingAdapter({
    tenantId: 'tenant-a', accountId: `${platform}-1`, platform, dataStore,
    now: new Date('2026-09-26T00:00:00Z'),
  });
  assert.equal(adapter.platform, platform);
  assert.equal(adapter.capability, 'available', `${platform} should use the same account, credential and provider-evidence gate`);
}

const crossTenant = await createWeeklyPublishingAdapter({
  tenantId: 'tenant-a', accountId: 'foreign-facebook', platform: 'facebook', dataStore,
  now: new Date('2026-09-26T00:00:00Z'),
});
assert.equal(crossTenant.capability, 'unavailable');
assert.equal(crossTenant.unavailableReason, 'facebook_account_not_found');

dataStore.rows.set('social_platform_capability_evidence', dataStore.rows.get('social_platform_capability_evidence')!
  .filter(item => item.platform !== 'instagram'));
const noProviderProof = await createWeeklyPublishingAdapter({
  tenantId: 'tenant-a', accountId: 'instagram-1', platform: 'instagram', dataStore,
  now: new Date('2026-09-26T00:00:00Z'),
});
assert.equal(noProviderProof.capability, 'unavailable');
assert.equal(noProviderProof.unavailableReason, 'provider_publish_scope_missing');

console.log('weekly four-platform adapter gate tests passed');
