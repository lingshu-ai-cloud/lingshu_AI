import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { registerVideoListingRoutes } from './videoListingRoutes.js';

test('listing dependency rejections return retryable 503 and leave the HTTP service alive', async () => {
  let failure: 'queue' | 'inventory' | 'listing' | null = null;
  const unavailable = async (source: typeof failure) => {
    if (failure === source) throw new Error('private-database-diagnostic');
  };
  const app = express();
  app.use((_req, res, next) => { res.locals.tenantId = 'tenant-a'; next(); });
  app.get('/health', (_req, res) => { res.json({ ok: true }); });
  const router = express.Router();
  registerVideoListingRoutes(router, {
    listing: {
      tenantInventoryTotal: async () => { await unavailable('inventory'); return 1; },
      listPublicVideosForTenant: async () => { await unavailable('listing'); return { items: [{ id: 'saved-video', tenantId: 'tenant-a' }], page: 1, perPage: 20, totalItems: 1, totalPages: 1 }; },
      clearTenantVisibleListCache: () => {},
    },
    tenantAnalysisQueuePositions: async () => { await unavailable('queue'); return new Map(); },
    withSignedThumbnail: record => record,
  });
  app.use('/videos', router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    for (const source of ['queue', 'inventory', 'listing'] as const) {
      failure = source;
      const routes = source === 'queue' ? ['/videos/'] : ['/videos/', '/videos/inventory-summary'];
      for (const path of routes) {
        const response = await fetch(base + path);
        assert.equal(response.status, 503);
        assert.equal(response.headers.get('retry-after'), '5');
        assert.match(response.headers.get('cache-control') || '', /no-store/);
        const body = await response.json();
        assert.deepEqual(body, { error: '素材列表暂时无法读取，请稍后重试', code: 'VIDEO_LIST_UNAVAILABLE', retryable: true });
        assert.equal('items' in body, false, 'failed reads must not pretend the saved library is empty');
        assert.equal((await fetch(base + '/health')).status, 200, 'unrelated local APIs survive the rejection');
      }
    }
    failure = null;
    const recovered = await fetch(base + '/videos/');
    assert.equal(recovered.status, 200);
    assert.equal((await recovered.json()).items[0].id, 'saved-video', 'retry uses the existing record when the dependency recovers');
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
