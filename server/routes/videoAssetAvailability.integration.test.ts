import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { store } from '../storage/index.js';
import { createVideoAssetRoutes } from './videoAssetRoutes.js';

test('media resolver rejects absent objects and preserves authorization without collecting or analyzing', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'lingshu-media-'));
  const originalRoot = process.env.LOCAL_OBJECT_STORAGE_ROOT;
  const originalDriver = process.env.OBJECT_STORAGE_DRIVER;
  process.env.LOCAL_OBJECT_STORAGE_ROOT = root;
  process.env.OBJECT_STORAGE_DRIVER = 'local';
  t.after(async () => {
    if (originalRoot === undefined) delete process.env.LOCAL_OBJECT_STORAGE_ROOT; else process.env.LOCAL_OBJECT_STORAGE_ROOT = originalRoot;
    if (originalDriver === undefined) delete process.env.OBJECT_STORAGE_DRIVER; else process.env.OBJECT_STORAGE_DRIVER = originalDriver;
    await rm(root, { recursive: true, force: true });
  });
  await writeFile(path.join(root, 'present.mp4'), 'fixture-media');
  t.mock.method(store, 'getById', async (_collection: string, id: string) => ({
    id, tenantId: 'test-tenant', videoFileId: id === 'local-missing'
      ? 'tenants/test-tenant/reference-videos/local-missing.mp4' : `${id}.mp4`,
    aiAnalysis: JSON.stringify({ videoObjectKey: id === 'local-missing' ? undefined : `${id}.mp4` }),
  }));
  const app = express();
  const router = express.Router();
  app.use((req, res, next) => { res.locals.tenantId = req.get('x-test-tenant') || 'test-tenant'; next(); });
  app.use('/videos', router);
  const forbidden = () => { throw Error('media lookup must not trigger a provider or write'); };
  createVideoAssetRoutes({ videosRouter: router, streamCrawlerCosObject: forbidden,
    downloadVideoForAnalysis: forbidden, cleanupTempVideo: forbidden, extractPoster: forbidden,
    uploadCrawlerCosObject: forbidden, recoverCrawlerImageObjectKey: forbidden, storeThumbnailBuffer: forbidden,
  }).registerGetIdMediaUrl();
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const address = server.address() as import('node:net').AddressInfo;
  const base = `http://127.0.0.1:${address.port}/videos`;
  for (const id of ['missing', 'local-missing']) {
    const response = await fetch(`${base}/${id}/media-url`);
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error, 'video_media_missing');
  }
  const available = await fetch(`${base}/present/media-url`);
  assert.equal(available.status, 200);
  assert.match((await available.json()).url, /\/videos\/present\/media\?/);
  const foreign = await fetch(`${base}/present/media-url`, { headers: { 'x-test-tenant': 'other-tenant' } });
  assert.equal(foreign.status, 404);
});
