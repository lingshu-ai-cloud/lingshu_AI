import assert from 'node:assert/strict';
import test from 'node:test';
import type { DataStore, ListQuery } from '../storage/datastore.js';
import { createVideoTenantListing, matchesCrawlRange, matchesVideoSearch } from './videoTenantListing.js';

function listingStore(records: Record<string, unknown>[]): DataStore {
  return {
    async list<T>(collection: string, query: ListQuery = {}) {
      assert.equal(collection, 'trend_videos');
      const where = query.where || {};
      const matched = records.filter(record => Object.entries(where).every(([key, value]) => record[key] === value));
      const sorted = [...matched].sort((a, b) => String(b.crawledAt || '').localeCompare(String(a.crawledAt || '')));
      const page = query.page || 1;
      const perPage = query.perPage || 100;
      return {
        items: sorted.slice((page - 1) * perPage, page * perPage) as T[],
        totalItems: sorted.length,
        totalPages: Math.max(1, Math.ceil(sorted.length / perPage)),
        page,
        perPage,
      };
    },
  } as DataStore;
}

test('tenant video search scans across pages without exposing another tenant', async () => {
  const records = [
    { id: 'other', tenantId: 'other', contentFormat: 'video', title: 'Needle', crawledAt: '2026-10-22T12:00:00Z' },
    { id: 'first', tenantId: 'ours', contentFormat: 'video', title: 'Unrelated', crawledAt: '2026-10-21T12:00:00Z' },
    { id: 'second', tenantId: 'ours', contentFormat: 'video', title: 'Needle', crawledAt: '2026-10-20T12:00:00Z' },
  ];
  const listing = createVideoTenantListing({ store: listingStore(records), collection: 'trend_videos', isTestTenantId: async () => false });
  const result = await listing.listPublicVideosForTenant({ tenantId: 'ours', contentFormat: 'video', page: 1, perPage: 1, search: 'needle' });
  assert.deepEqual(result.items.map(item => item.id), ['second']);
  assert.equal(result.totalItems, 1);
  assert.equal(result.totalPages, 1);
  assert.equal(matchesVideoSearch({ tags: ['Factory', 'B2B'] }, 'b2b'), true);
  assert.equal(matchesCrawlRange({ crawledAt: 'invalid' }, '7d'), false);
});

test('image scan deduplicates sources and keeps failed analysis visible', async () => {
  const base = { tenantId: 'ours', contentFormat: 'image', platform: 'instagram', sourceUrl: 'https://www.instagram.com/p/ABC123/', thumbnailUrl: 'https://cdn.example.test/image.jpg', aiAnalysis: { contentFormat: 'image', imageAnalysisQueueState: 'failed', imageUrls: ['https://cdn.example.test/image.jpg'] } };
  const records = [
    { ...base, id: 'first', title: 'Factory bottle', crawledAt: '2026-10-22T12:00:00Z' },
    { ...base, id: 'duplicate', title: 'Factory bottle', crawledAt: '2026-10-21T12:00:00Z' },
    { ...base, id: 'hidden', title: 'Factory bottle', sourceUrl: 'https://www.instagram.com/p/HIDDEN/', aiAnalysis: { contentFormat: 'image', userVisible: false }, crawledAt: '2026-10-20T12:00:00Z' },
    { ...base, id: 'other', tenantId: 'other', title: 'Factory bottle', crawledAt: '2026-10-19T12:00:00Z' },
  ];
  const listing = createVideoTenantListing({ store: listingStore(records), collection: 'trend_videos', isTestTenantId: async () => false });
  const result = await listing.listPublicVideosForTenant({ tenantId: 'ours', contentFormat: 'image', page: 1, perPage: 1, search: 'bottle' });
  assert.deepEqual(result.items.map(item => item.id), ['first']);
  assert.equal(result.totalItems, 1);
});

test('inventory counts legacy videos by excluding explicit image records', async () => {
  const records = [
    { id: 'legacy', tenantId: 'ours' },
    { id: 'video', tenantId: 'ours', contentFormat: 'video' },
    { id: 'image', tenantId: 'ours', contentFormat: 'image' },
    { id: 'other', tenantId: 'other', contentFormat: 'image' },
  ];
  const listing = createVideoTenantListing({ store: listingStore(records), collection: 'trend_videos', isTestTenantId: async () => false });
  assert.equal(await listing.tenantInventoryTotal('ours', 'video'), 2);
  assert.equal(await listing.tenantInventoryTotal('ours', 'image'), 1);
});

test('test-tenant visibility cache can be invalidated after a source write', async () => {
  const records: Record<string, unknown>[] = [
    { id: 'first', tenantId: 'ours', contentFormat: 'video', sourceUrl: 'https://www.youtube.com/watch?v=first', crawledAt: '2026-10-22T12:00:00Z', aiAnalysis: { usage: 'reference_only', contentSha256: 'sha-first' } },
  ];
  const listing = createVideoTenantListing({ store: listingStore(records), collection: 'trend_videos', isTestTenantId: async () => true });
  const input = { tenantId: 'ours', contentFormat: 'video' as const, page: 1, perPage: 10 };
  assert.equal((await listing.listPublicVideosForTenant(input)).totalItems, 1);
  records.push({ id: 'second', tenantId: 'ours', contentFormat: 'video', sourceUrl: 'https://www.youtube.com/watch?v=second', crawledAt: '2026-10-23T12:00:00Z', aiAnalysis: { usage: 'reference_only', contentSha256: 'sha-second' } });
  assert.equal((await listing.listPublicVideosForTenant(input)).totalItems, 1);
  listing.clearTenantVisibleListCache();
  assert.deepEqual((await listing.listPublicVideosForTenant(input)).items.map(item => item.id), ['second', 'first']);
});
