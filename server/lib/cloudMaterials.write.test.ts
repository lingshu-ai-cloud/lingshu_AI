import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createCloudMaterial,
  deleteOwnedCloudMaterial,
  fetchCloudMaterial,
  upsertSocialTaskCloudMaterial,
} from './cloudMaterials.js';
import { objectStorageUpload } from '../storage/objectStorage.js';

const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'cloud-material-write-test-'));
try {
  const mediaPath = path.join(directory, 'clip.mp4');
  const bytes = Buffer.from('material-bytes');
  await fsp.writeFile(mediaPath, bytes);
  const sha256 = 'a'.repeat(64);
  let createCalls = 0;
  const created = await createCloudMaterial({
    tenantId: 'tenant-a',
    title: '生产线镜头',
    folder: 'upload',
    type: 'video',
    sizeBytes: bytes.length,
    sha256,
    media: { name: 'clip.mp4', path: mediaPath, contentType: 'video/mp4' },
    provenance: { uploadMethod: 'test' },
  }, async (requestPath, options = {}) => {
    createCalls += 1;
    assert.equal(requestPath, '/api/collections/materials/records');
    assert.equal(options.method, 'POST');
    const form = options.body as FormData;
    assert.equal(form.get('tenantId'), 'tenant-a');
    assert.equal(form.get('sha256'), sha256);
    assert.equal(form.get('scope'), 'own');
    assert.equal(form.get('usage'), 'editable');
    assert.equal(form.get('provenance'), JSON.stringify({ uploadMethod: 'test' }));
    assert.deepEqual(Buffer.from(await (form.get('videoFile') as Blob).arrayBuffer()), bytes);
    assert.ok((form.get('posterFile') as Blob).size > 0, 'required PB poster is attached without a server-side cache');
    return Response.json({ id: 'materialrecord1', tenantId: 'tenant-a', videoFile: 'clip.mp4', posterFile: 'poster.png' });
  });
  assert.equal(createCalls, 1);
  assert.equal(created.id, 'materialrecord1');

  const objectBacked = await createCloudMaterial({
    tenantId: 'tenant-a',
    title: '对象存储镜头',
    folder: 'upload',
    type: 'video',
    sizeBytes: bytes.length,
    sha256: 'b'.repeat(64),
    media: { key: 'materials/tenants/dGVuYW50LWE/hash.mp4', etag: 'media-v1', contentType: 'video/mp4' },
    poster: { key: 'material-posters/tenants/dGVuYW50LWE/hash.jpg', etag: 'poster-v1', contentType: 'image/jpeg' },
  }, async (_requestPath, options = {}) => {
    const form = options.body as FormData;
    assert.equal(form.get('objectKey'), 'materials/tenants/dGVuYW50LWE/hash.mp4');
    assert.equal(form.get('objectEtag'), 'media-v1');
    assert.equal(form.get('posterObjectKey'), 'material-posters/tenants/dGVuYW50LWE/hash.jpg');
    assert.equal(form.get('storageBackend'), 'object_storage');
    assert.equal(form.get('videoFile'), null);
    assert.equal(form.get('posterFile'), null);
    return Response.json({ id: 'objectrecord1', tenantId: 'tenant-a', objectKey: String(form.get('objectKey')) });
  });
  assert.equal(objectBacked.id, 'objectrecord1');
  const previousStorage = {
    driver: process.env.OBJECT_STORAGE_DRIVER,
    root: process.env.LOCAL_OBJECT_STORAGE_ROOT,
  };
  process.env.OBJECT_STORAGE_DRIVER = 'local';
  process.env.LOCAL_OBJECT_STORAGE_ROOT = path.join(directory, 'objects');
  try {
    await objectStorageUpload({ key: 'materials/tenants/dGVuYW50LWE/hash.mp4', body: Buffer.from('material-bytes'), contentType: 'video/mp4' });
    const playback = await fetchCloudMaterial('objectrecord1', 'videoFile', 'bytes=1-3', 'tenant-a', async () => Response.json({
      id: 'objectrecord1', tenantId: 'tenant-a', scope: 'own', objectKey: 'materials/tenants/dGVuYW50LWE/hash.mp4',
    }));
    assert.equal(playback?.status, 206);
    assert.equal(await playback?.text(), 'ate');
  } finally {
    if (previousStorage.driver === undefined) delete process.env.OBJECT_STORAGE_DRIVER;
    else process.env.OBJECT_STORAGE_DRIVER = previousStorage.driver;
    if (previousStorage.root === undefined) delete process.env.LOCAL_OBJECT_STORAGE_ROOT;
    else process.env.LOCAL_OBJECT_STORAGE_ROOT = previousStorage.root;
  }

  const patched: Array<Record<string, unknown>> = [];
  const reused = await upsertSocialTaskCloudMaterial({
    tenantId: 'tenant-a', taskId: 'task-2', taskFileRef: 'socialfile:file-2', productRef: '精华液',
    title: '同一原片', type: 'video', sizeBytes: bytes.length, sha256,
    media: { name: 'clip.mp4', buf: bytes, contentType: 'video/mp4' },
  }, async (requestPath, options = {}) => {
    if (requestPath.includes('?')) {
      assert.match(decodeURIComponent(requestPath), /tenantId = "tenant-a"/);
      return Response.json({ items: [{
        id: 'materialrecord1', tenantId: 'tenant-a', scope: 'own', sha256,
        title: '同一原片', type: 'video', videoFile: 'clip.mp4', posterFile: 'poster.png',
        provenance: { sourceTaskIds: ['task-1'], sourceTaskFileRefs: ['socialfile:file-1'] },
      }] });
    }
    assert.equal(options.method, 'PATCH');
    patched.push(JSON.parse(String(options.body)) as Record<string, unknown>);
    return Response.json({
      id: 'materialrecord1', tenantId: 'tenant-a', scope: 'own', sha256,
      title: '同一原片', type: 'video', videoFile: 'clip.mp4', posterFile: 'poster.png',
      ...patched[0],
    });
  });
  assert.equal(reused.id, 'pb-materialrecord1');
  assert.deepEqual((patched[0]!.provenance as Record<string, unknown>).sourceTaskIds, ['task-1', 'task-2']);
  assert.deepEqual((patched[0]!.provenance as Record<string, unknown>).sourceTaskFileRefs, ['socialfile:file-1', 'socialfile:file-2']);

  let deleteCalled = false;
  const denied = await deleteOwnedCloudMaterial('materialrecord1', 'tenant-a', async (_requestPath, options = {}) => {
    if (options.method === 'DELETE') deleteCalled = true;
    return Response.json({ id: 'materialrecord1', tenantId: 'tenant-b', scope: 'own' });
  });
  assert.equal(denied, 'not_found');
  assert.equal(deleteCalled, false, 'tenant mismatch must never reach PocketBase DELETE');
} finally {
  await fsp.rm(directory, { recursive: true, force: true });
}

console.log('cloud material database write tests passed');
