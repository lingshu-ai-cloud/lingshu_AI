import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';

test('record playback preserves original object keys, range reads and tenant isolation', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'material-playback-'));
  const settings = { NODE_ENV: 'test', ENABLE_LOCAL_DEV_FALLBACK: 'true', LOCAL_STORE_DIR: path.join(directory, 'store'),
    MATERIAL_LIBRARY_FILE: path.join(directory, 'materials.json'), OBJECT_STORAGE_DRIVER: 'local', LOCAL_OBJECT_STORAGE_ROOT: path.join(directory, 'objects') };
  const previous = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]]));
  Object.assign(process.env, settings);
  const [{ createStudioPrivateAssetRoutes }, { materialResponse }, storage, authority] = await Promise.all([
    import('./studioPrivateAssetRoutes.js'), import('./studioMaterialProjection.js'), import('../storage/objectStorage.js'), import('../storage/dataAuthority.js'),
  ]);
  const key = 'first-frames/tenants/tenant-a/project%3Avideo-1/source.jpg';
  const material = { id: 'frame-a', name: 'Frame', scope: 'own' as const, tenantId: 'tenant-a', objectKey: key,
    posterObjectKey: 'material-posters/tenants/dGVuYW50LWE/poster.jpg', type: 'image' as const, folder: 'presenter', file: '', url: '', duration: 0, size: '', createdAt: '' };
  await writeFile(settings.MATERIAL_LIBRARY_FILE, JSON.stringify([material, { ...material, id: 'frame-b', tenantId: 'tenant-b' }]));
  await storage.objectStorageUpload({ key, body: Buffer.from('original-image'), contentType: 'image/jpeg' });
  await storage.objectStorageUpload({ key: material.posterObjectKey, body: Buffer.from('poster-image'), contentType: 'image/jpeg' });
  const app = express();
  app.use(authority.dataAuthorityRequestScope, (_req, res, next) => { authority.bindDataAuthority('local'); res.locals.tenantId = 'tenant-a'; next(); });
  createStudioPrivateAssetRoutes({ studioRouter: app as unknown as express.Router, scopedStudioAssetUrl: () => '' }).registerGetPrivateAssetsNamespaceFile();
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  try {
    const address = server.address() as { port: number };
    const origin = `http://127.0.0.1:${address.port}`;
    const visible = await materialResponse(material, 'tenant-a');
    const mediaPath = new URL(visible.url, origin).pathname.replace('/api/overseas/studio', '');
    assert.match(mediaPath, /material-records\/frame-a\.media$/);
    const response = await fetch(origin + mediaPath);
    assert.equal(response.status, 200); assert.equal(await response.text(), 'original-image');
    assert.equal(response.headers.get('content-type'), 'image/jpeg');
    const range = await fetch(origin + mediaPath, { headers: { Range: 'bytes=0-3' } });
    assert.equal(range.status, 206); assert.equal(await range.text(), 'orig');
    assert.equal(await (await fetch(origin + mediaPath.replace('.media', '.poster'))).text(), 'poster-image');
    assert.equal((await fetch(origin + mediaPath.replace('frame-a', 'frame-b'))).status, 404);
    assert.equal((await fetch(origin + mediaPath.replace('frame-a', 'missing'))).status, 404);
    assert.equal((await fetch(origin + mediaPath.replace('.media', '.invalid'))).status, 404);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
