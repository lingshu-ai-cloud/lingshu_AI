import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import { auth } from './index.js';
import { requireScopedAsset, signAssetUrl, verifyAssetToken } from '../lib/assetAccess.js';
import { materialAssetObjectKey } from './materialAssets.js';
import {
  objectStorageDelete,
  objectStorageConfigurationIssues,
  objectStorageDownload,
  objectStorageDriver,
  objectStorageEnabled,
  objectStorageGetObject,
  objectStorageHead,
  objectStorageLocalRoot,
  objectStorageEnsureFile,
  objectStorageList,
  objectStorageSignedGetUrl,
  objectStorageSupplierDeliveryReady,
  objectStorageUpload,
} from './objectStorage.js';

test('development defaults to private local system storage', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-local-storage-'));
  const previous = { driver: process.env.OBJECT_STORAGE_DRIVER, root: process.env.LOCAL_OBJECT_STORAGE_ROOT,
    publicBase: process.env.LOCAL_OBJECT_STORAGE_PUBLIC_BASE_URL, nodeEnv: process.env.NODE_ENV };
  process.env.OBJECT_STORAGE_DRIVER = 'local'; process.env.LOCAL_OBJECT_STORAGE_ROOT = root;
  delete process.env.LOCAL_OBJECT_STORAGE_PUBLIC_BASE_URL;
  try {
    const key = materialAssetObjectKey('tenant-a', 'photo.jpg');
    assert.equal(objectStorageDriver(), 'local'); assert.equal(objectStorageEnabled(), true);
    assert.equal(objectStorageSupplierDeliveryReady(), false);
    await objectStorageUpload({ key, body: Buffer.from('portrait'), contentType: 'image/jpeg' });
    assert.deepEqual(await objectStorageDownload(key), { buf: Buffer.from('portrait'), contentType: 'image/jpeg' });
    assert.equal((await objectStorageHead(key))?.size, 8);
    const range = await objectStorageGetObject(key, 'bytes=1-3');
    assert.equal(range?.contentRange, 'bytes 1-3/8');
    const rangeChunks: Uint8Array[] = [];
    for await (const chunk of range?.body || []) rangeChunks.push(chunk);
    assert.equal(Buffer.concat(rangeChunks).toString(), 'ort');
    const signed = new URL(await objectStorageSignedGetUrl(key), 'http://local');
    assert.equal(verifyAssetToken(signed.searchParams.get('assetToken'), signed.pathname)?.tenantId, 'tenant-a');
    const source = path.join(root, 'source-upload.mp4');
    fs.writeFileSync(source, 'video');
    const first = await objectStorageEnsureFile({ key: 'materials/tenants/a/hash.mp4', filePath: source, contentType: 'video/mp4', contentLength: 5 });
    const second = await objectStorageEnsureFile({ key: 'materials/tenants/a/hash.mp4', filePath: source, contentType: 'video/mp4', contentLength: 5 });
    assert.equal(first.reused, false);
    assert.equal(second.reused, true);
    const inventory = await objectStorageList({ prefix: 'materials/tenants/a' });
    assert.deepEqual(inventory.items.map(item => item.key), ['materials/tenants/a/hash.mp4']);
    await objectStorageDelete(key); assert.equal(await objectStorageHead(key), null);
    await assert.rejects(() => objectStorageUpload({ key: '../escape', body: Buffer.from('x'), contentType: 'text/plain' }), /key/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previous)) { const name = key === 'driver' ? 'OBJECT_STORAGE_DRIVER' : key === 'root' ? 'LOCAL_OBJECT_STORAGE_ROOT' : key === 'publicBase' ? 'LOCAL_OBJECT_STORAGE_PUBLIC_BASE_URL' : 'NODE_ENV'; if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
});

test('supplier can fetch only a signed tenant-local object over the media route', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-supplier-media-'));
  const previousRoot = process.env.LOCAL_OBJECT_STORAGE_ROOT;
  const previousDriver = process.env.OBJECT_STORAGE_DRIVER;
  const originalVerify = auth.verifyToken;
  process.env.OBJECT_STORAGE_DRIVER = 'local';
  process.env.LOCAL_OBJECT_STORAGE_ROOT = path.join(temp, 'object-storage');
  auth.verifyToken = async () => null;
  const key = materialAssetObjectKey('tenant-a', 'voice.mp3');
  const app = express();
  const mediaRouter = express.Router();
  mediaRouter.use('/object-storage', express.static(objectStorageLocalRoot()));
  app.use('/media', requireScopedAsset, mediaRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('media test server unavailable');
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    await objectStorageUpload({ key, body: Buffer.from('spoken audio'), contentType: 'audio/mpeg' });
    const signed = await objectStorageSignedGetUrl(key);
    assert.equal((await fetch(`${origin}${signed}`)).status, 200);
    const firstFrameKey = 'first-frames/tenants/tenant-a/video-1/frame.jpg';
    await objectStorageUpload({ key: firstFrameKey, body: Buffer.from('image'), contentType: 'image/jpeg' });
    const signedFirstFrame = await objectStorageSignedGetUrl(firstFrameKey);
    assert.equal((await fetch(`${origin}${signedFirstFrame}`)).status, 200);
    assert.equal((await fetch(`${origin}${signed.split('?')[0]}`)).status, 401);
    const forged = signAssetUrl(signed.split('?')[0]!, 'tenant-b');
    assert.equal((await fetch(`${origin}${forged}`)).status, 404);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    auth.verifyToken = originalVerify;
    if (previousRoot === undefined) delete process.env.LOCAL_OBJECT_STORAGE_ROOT; else process.env.LOCAL_OBJECT_STORAGE_ROOT = previousRoot;
    if (previousDriver === undefined) delete process.env.OBJECT_STORAGE_DRIVER; else process.env.OBJECT_STORAGE_DRIVER = previousDriver;
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('local storage gives suppliers a signed HTTPS URL only with an explicit public base', async () => {
  const previous = process.env.LOCAL_OBJECT_STORAGE_PUBLIC_BASE_URL;
  process.env.OBJECT_STORAGE_DRIVER = 'local'; process.env.LOCAL_OBJECT_STORAGE_PUBLIC_BASE_URL = 'https://dev-assets.example';
  try {
    assert.equal(objectStorageSupplierDeliveryReady(), true);
    const signed = new URL(await objectStorageSignedGetUrl(materialAssetObjectKey('tenant-a', 'voice.mp3')));
    assert.equal(signed.origin, 'https://dev-assets.example');
    assert.equal(verifyAssetToken(signed.searchParams.get('assetToken'), signed.pathname)?.tenantId, 'tenant-a');
    const nested = new URL(await objectStorageSignedGetUrl('first-frames/tenants/tenant-a/video-1/frame.jpg'));
    assert.equal(nested.origin, 'https://dev-assets.example');
    assert.equal(verifyAssetToken(nested.searchParams.get('assetToken'), nested.pathname)?.tenantId, 'tenant-a');
  }
  finally { if (previous === undefined) delete process.env.LOCAL_OBJECT_STORAGE_PUBLIC_BASE_URL; else process.env.LOCAL_OBJECT_STORAGE_PUBLIC_BASE_URL = previous; }
});

test('production fails readiness unless Tencent COS is selected and fully configured', () => {
  assert.deepEqual(objectStorageConfigurationIssues({ NODE_ENV: 'production', OBJECT_STORAGE_DRIVER: 'local' }), ['production requires OBJECT_STORAGE_DRIVER=cos']);
  assert.deepEqual(objectStorageConfigurationIssues({ NODE_ENV: 'production', OBJECT_STORAGE_DRIVER: 'cos' }), ['COS_REGION', 'COS_BUCKET', 'COS_SECRET_ID', 'COS_SECRET_KEY']);
  assert.deepEqual(objectStorageConfigurationIssues({ NODE_ENV: 'production', OBJECT_STORAGE_DRIVER: 'cos', COS_REGION: 'ap-shanghai', COS_BUCKET: 'bucket-123', COS_SECRET_ID: 'id', COS_SECRET_KEY: 'secret' }), []);
});
