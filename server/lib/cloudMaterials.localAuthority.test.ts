import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';

const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'cloud-material-local-authority-'));
const original = {
  nodeEnv: process.env.NODE_ENV,
  localFallback: process.env.ENABLE_LOCAL_DEV_FALLBACK,
  localStore: process.env.LOCAL_STORE_DIR,
  materialLibrary: process.env.MATERIAL_LIBRARY_FILE,
  objectDriver: process.env.OBJECT_STORAGE_DRIVER,
  objectRoot: process.env.LOCAL_OBJECT_STORAGE_ROOT,
};

process.env.NODE_ENV = 'test';
process.env.ENABLE_LOCAL_DEV_FALLBACK = 'true';
process.env.LOCAL_STORE_DIR = path.join(directory, 'store');
process.env.MATERIAL_LIBRARY_FILE = path.join(directory, 'materials.json');
process.env.OBJECT_STORAGE_DRIVER = 'local';
process.env.LOCAL_OBJECT_STORAGE_ROOT = path.join(directory, 'objects');

const [{ runWithDataAuthority, dataAuthorityRequestScope }, cloud, objectStorage, materialLibrary, { cloudMaterialMediaRouter }, { signPathAssetUrl }] = await Promise.all([
  import('../storage/dataAuthority.js'),
  import('./cloudMaterials.js'),
  import('../storage/objectStorage.js'),
  import('./materialLibrary.js'),
  import('../routes/cloudMaterialMedia.js'),
  import('./assetAccess.js'),
]);

test.after(async () => {
  await fsp.rm(directory, { recursive: true, force: true });
  for (const [key, value] of Object.entries(original)) {
    const envKey = ({
      nodeEnv: 'NODE_ENV',
      localFallback: 'ENABLE_LOCAL_DEV_FALLBACK',
      localStore: 'LOCAL_STORE_DIR',
      materialLibrary: 'MATERIAL_LIBRARY_FILE',
      objectDriver: 'OBJECT_STORAGE_DRIVER',
      objectRoot: 'LOCAL_OBJECT_STORAGE_ROOT',
    } as const)[key as keyof typeof original];
    if (value === undefined) delete process.env[envKey];
    else process.env[envKey] = value;
  }
});

test('local-authenticated product-scene upload persists, lists, streams and deduplicates without PocketBase', async () => {
  const tenantId = 'local-tenant-a';
  const sha256 = 'c'.repeat(64);
  const mediaKey = 'materials/tenants/bG9jYWwtdGVuYW50LWE/scene.mp4';
  const posterKey = 'material-posters/tenants/bG9jYWwtdGVuYW50LWE/scene.jpg';
  const media = Buffer.from('real-local-scene-video-bytes');
  const poster = Buffer.from('real-local-scene-poster');
  await objectStorage.objectStorageUpload({ key: mediaKey, body: media, contentType: 'video/mp4' });
  await objectStorage.objectStorageUpload({ key: posterKey, body: poster, contentType: 'image/jpeg' });

  const created = await runWithDataAuthority('local', () => cloud.upsertTenantUploadCloudMaterial({
    tenantId,
    title: '产品 A · 预制场景 1',
    folder: 'product-scenes',
    type: 'video',
    duration: 8.25,
    width: 1920,
    height: 1080,
    sizeBytes: media.length,
    sha256,
    scope: 'own',
    usage: 'editable',
    sourceEntry: 'studio_workspace',
    sourceType: 'product-scene-preparation',
    productId: 'product-a',
    productName: '产品 A',
    licenseEvidence: 'tenant_product_scene_upload',
    commercialUseApproved: true,
    derivativesApproved: true,
    rawLibraryUseApproved: true,
    provenance: { productScenePreparation: { kind: 'scene-1', contentSha256: sha256 } },
    media: { key: mediaKey, contentType: 'video/mp4' },
    poster: { key: posterKey, contentType: 'image/jpeg' },
  }));
  assert.match(String(created.id), /^pb-materials_/);
  assert.equal(created.productId, 'product-a');
  assert.equal(created.duration, 8.25, 'local persistence must not reintroduce the old scene-duration limit');

  const recordId = String(created.id).replace(/^pb-/, '');
  const listed = await runWithDataAuthority('local', () => cloud.readCloudMaterialLibrary(tenantId));
  assert.equal(listed.source.state, 'ready');
  assert.equal(listed.items.length, 1);
  assert.equal(listed.items[0]?.id, created.id);
  const studioInventory = await runWithDataAuthority('local', () => materialLibrary.readMaterialLibrary(tenantId));
  assert.equal(studioInventory.status, 'ready');
  assert.equal(studioInventory.items.length, 1, 'Studio inventory must include local-authority cloud metadata');
  assert.equal(studioInventory.items[0]?.id, created.id);

  const streamed = await runWithDataAuthority('local', () => cloud.fetchCloudMaterial(recordId, 'videoFile', 'bytes=5-9', tenantId));
  assert.equal(streamed?.status, 206);
  assert.deepEqual(Buffer.from(await streamed!.arrayBuffer()), media.subarray(5, 10));

  const app = express();
  app.use(dataAuthorityRequestScope);
  app.use('/studio-media', cloudMaterialMediaRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('signed material test server unavailable');
  try {
    const signedVideo = runWithDataAuthority('local', () => signPathAssetUrl(`/studio-media/${recordId}/media.mp4`, tenantId));
    const signedPoster = runWithDataAuthority('local', () => signPathAssetUrl(`/studio-media/${recordId}/poster.jpg`, tenantId));
    const videoResponse = await fetch(`http://127.0.0.1:${address.port}${signedVideo}`, { headers: { Range: 'bytes=5-9' } });
    assert.equal(videoResponse.status, 206);
    assert.equal(videoResponse.headers.get('content-type'), 'video/mp4');
    assert.deepEqual(Buffer.from(await videoResponse.arrayBuffer()), media.subarray(5, 10));
    const posterResponse = await fetch(`http://127.0.0.1:${address.port}${signedPoster}`);
    assert.equal(posterResponse.status, 200);
    assert.equal(posterResponse.headers.get('content-type'), 'image/jpeg');
    assert.deepEqual(Buffer.from(await posterResponse.arrayBuffer()), poster);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }

  const rebound = await runWithDataAuthority('local', () => cloud.upsertTenantUploadCloudMaterial({
    tenantId,
    title: '产品 B · 预制场景 2',
    folder: 'product-scenes',
    type: 'video',
    duration: 8.25,
    width: 1920,
    height: 1080,
    sizeBytes: media.length,
    sha256,
    scope: 'own',
    usage: 'editable',
    sourceEntry: 'studio_workspace',
    sourceType: 'product-scene-preparation',
    productId: 'product-b',
    productName: '产品 B',
    provenance: { productScenePreparation: { kind: 'scene-2', contentSha256: sha256 } },
    verifiedDeduplicatedUpdate: {
      title: '产品 B · 预制场景 2',
      folder: 'product-scenes',
      type: 'video',
      duration: 8.25,
      width: 1920,
      height: 1080,
      sourceType: 'product-scene-preparation',
      productId: 'product-b',
      productName: '产品 B',
    },
    media: { key: mediaKey, contentType: 'video/mp4' },
    poster: { key: posterKey, contentType: 'image/jpeg' },
  }));
  assert.equal(rebound.id, created.id, 'same tenant/hash must reuse one material record');
  assert.equal(rebound.productId, 'product-b');
  const after = await runWithDataAuthority('local', () => cloud.readCloudMaterialLibrary(tenantId));
  assert.equal(after.items.length, 1);
  assert.equal(after.items[0]?.productId, 'product-b');
});
