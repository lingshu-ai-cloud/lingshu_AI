import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { readFileSync } from 'node:fs';
import type { DataStore, ListQuery } from '../storage/datastore.js';
import { createVideoTenantListing } from './videoTenantListing.js';
import { registerVideoListingRoutes } from './videoListingRoutes.js';

test('video and image list endpoints remain under auth and use only verified tenant scope', async () => {
  const source = readFileSync(new URL('./videos.ts', import.meta.url), 'utf8');
  assert.ok(source.indexOf('registerVideoListingRoutes(videosRouter, {') > source.indexOf('videosRouter.use(requireAuth)'));

  const records: Record<string, unknown>[] = [
    { id: 'video-1', tenantId: 'tenant-a', contentFormat: 'video', title: 'Older target', thumbnailUrl: '/media/older.jpg', crawledAt: '2026-10-20T00:00:00Z' },
    { id: 'video-2', tenantId: 'tenant-a', contentFormat: 'video', title: 'Other video', crawledAt: '2026-10-22T00:00:00Z' },
    { id: 'foreign', tenantId: 'tenant-b', contentFormat: 'video', title: 'Foreign target', crawledAt: '2026-10-23T00:00:00Z' },
    { id: 'image-1', tenantId: 'tenant-a', contentFormat: 'image', platform: 'instagram', title: 'Image', sourceUrl: 'https://www.instagram.com/p/ABC123/', thumbnailUrl: '/media/image.jpg', crawledAt: '2026-10-21T00:00:00Z', aiAnalysis: { contentFormat: 'image', imageUrls: ['/media/image.jpg'] } },
  ];
  const dataStore = {
    async list<T>(collection: string, query: ListQuery = {}) {
      assert.equal(collection, 'trend_videos');
      const matched = records.filter(record => Object.entries(query.where || {}).every(([key, value]) => record[key] === value));
      const sorted = [...matched].sort((a, b) => String(b.crawledAt || '').localeCompare(String(a.crawledAt || '')));
      const page = query.page || 1;
      const perPage = query.perPage || 100;
      return { items: sorted.slice((page - 1) * perPage, page * perPage) as T[], totalItems: sorted.length, totalPages: Math.max(1, Math.ceil(sorted.length / perPage)), page, perPage };
    },
  } as DataStore;
  const listing = createVideoTenantListing({ store: dataStore, collection: 'trend_videos', isTestTenantId: async () => false });
  const queueReads: string[] = [];
  const app = express();
  app.use((req, res, next) => { res.locals.tenantId = req.headers['x-tenant']; next(); });
  const router = express.Router();
  registerVideoListingRoutes(router, {
    listing,
    tenantAnalysisQueuePositions: async tenantId => { queueReads.push(tenantId); return new Map(); },
    withSignedThumbnail: (record, tenantId) => ({ ...record, thumbnailUrl: String(record.thumbnailUrl || '').startsWith('/media/') ? `signed:${record.thumbnailUrl}:${tenantId}` : record.thumbnailUrl }),
  });
  app.use('/videos', router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/videos`;
  const get = async (path: string) => {
    const response = await fetch(`${base}${path}`, { headers: { 'x-tenant': 'tenant-a' } });
    assert.equal(response.status, 200);
    return { response, body: await response.json() as Record<string, unknown> };
  };
  try {
    const inventory = await get('/inventory-summary');
    assert.equal(inventory.response.headers.get('cache-control'), 'private, no-store, max-age=0');
    assert.equal(inventory.body.totalItems, 2);
    assert.equal(inventory.body.visibleItems, 2);

    const video = (await get('?search=target&perPage=1&tenantId=tenant-b')).body;
    assert.equal(video.inventoryTotalItems, 2);
    assert.deepEqual((video.items as Array<Record<string, unknown>>).map(item => item.id), ['video-1']);
    assert.equal((video.items as Array<Record<string, unknown>>)[0]?.thumbnailUrl, 'signed:/media/older.jpg:tenant-a');
    assert.deepEqual(queueReads, ['tenant-a']);

    const image = (await get('?contentFormat=image')).body;
    assert.equal(image.inventoryTotalItems, 1);
    assert.deepEqual((image.items as Array<Record<string, unknown>>).map(item => item.id), ['image-1']);
    assert.equal((image.items as Array<Record<string, unknown>>)[0]?.thumbnailUrl, 'signed:/media/image.jpg:tenant-a');
    assert.deepEqual(queueReads, ['tenant-a'], 'image listing must not read video queue positions');
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
