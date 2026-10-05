import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  objectStorageDelete,
  objectStorageConfigurationIssues,
  objectStorageDownload,
  objectStorageDriver,
  objectStorageEnabled,
  objectStorageGetObject,
  objectStorageHead,
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
    assert.equal(objectStorageDriver(), 'local'); assert.equal(objectStorageEnabled(), true);
    assert.equal(objectStorageSupplierDeliveryReady(), false);
    await objectStorageUpload({ key: 'materials/tenants/a/photo.jpg', body: Buffer.from('portrait'), contentType: 'image/jpeg' });
    assert.deepEqual(await objectStorageDownload('materials/tenants/a/photo.jpg'), { buf: Buffer.from('portrait'), contentType: 'image/jpeg' });
    assert.equal((await objectStorageHead('materials/tenants/a/photo.jpg'))?.size, 8);
    const range = await objectStorageGetObject('materials/tenants/a/photo.jpg', 'bytes=1-3');
    assert.equal(range?.contentRange, 'bytes 1-3/8');
    const rangeChunks: Uint8Array[] = [];
    for await (const chunk of range?.body || []) rangeChunks.push(chunk);
    assert.equal(Buffer.concat(rangeChunks).toString(), 'ort');
    assert.equal(await objectStorageSignedGetUrl('materials/tenants/a/photo.jpg'), '/media/object-storage/materials/tenants/a/photo.jpg');
    const source = path.join(root, 'source-upload.mp4');
    fs.writeFileSync(source, 'video');
    const first = await objectStorageEnsureFile({ key: 'materials/tenants/a/hash.mp4', filePath: source, contentType: 'video/mp4', contentLength: 5 });
    const second = await objectStorageEnsureFile({ key: 'materials/tenants/a/hash.mp4', filePath: source, contentType: 'video/mp4', contentLength: 5 });
    assert.equal(first.reused, false);
    assert.equal(second.reused, true);
    const inventory = await objectStorageList({ prefix: 'materials/tenants/a' });
    assert.deepEqual(inventory.items.map(item => item.key), ['materials/tenants/a/hash.mp4', 'materials/tenants/a/photo.jpg']);
    await objectStorageDelete('materials/tenants/a/photo.jpg'); assert.equal(await objectStorageHead('materials/tenants/a/photo.jpg'), null);
    await assert.rejects(() => objectStorageUpload({ key: '../escape', body: Buffer.from('x'), contentType: 'text/plain' }), /key/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previous)) { const name = key === 'driver' ? 'OBJECT_STORAGE_DRIVER' : key === 'root' ? 'LOCAL_OBJECT_STORAGE_ROOT' : key === 'publicBase' ? 'LOCAL_OBJECT_STORAGE_PUBLIC_BASE_URL' : 'NODE_ENV'; if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
});

test('local storage only becomes supplier-deliverable with an explicit HTTPS base', () => {
  const previous = process.env.LOCAL_OBJECT_STORAGE_PUBLIC_BASE_URL;
  process.env.OBJECT_STORAGE_DRIVER = 'local'; process.env.LOCAL_OBJECT_STORAGE_PUBLIC_BASE_URL = 'https://dev-assets.example';
  try { assert.equal(objectStorageSupplierDeliveryReady(), true); }
  finally { if (previous === undefined) delete process.env.LOCAL_OBJECT_STORAGE_PUBLIC_BASE_URL; else process.env.LOCAL_OBJECT_STORAGE_PUBLIC_BASE_URL = previous; }
});

test('production fails readiness unless Tencent COS is selected and fully configured', () => {
  assert.deepEqual(objectStorageConfigurationIssues({ NODE_ENV: 'production', OBJECT_STORAGE_DRIVER: 'local' }), ['production requires OBJECT_STORAGE_DRIVER=cos']);
  assert.deepEqual(objectStorageConfigurationIssues({ NODE_ENV: 'production', OBJECT_STORAGE_DRIVER: 'cos' }), ['COS_REGION', 'COS_BUCKET', 'COS_SECRET_ID', 'COS_SECRET_KEY']);
  assert.deepEqual(objectStorageConfigurationIssues({ NODE_ENV: 'production', OBJECT_STORAGE_DRIVER: 'cos', COS_REGION: 'ap-shanghai', COS_BUCKET: 'bucket-123', COS_SECRET_ID: 'id', COS_SECRET_KEY: 'secret' }), []);
});
