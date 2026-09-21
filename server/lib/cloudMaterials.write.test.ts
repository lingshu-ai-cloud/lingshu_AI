import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createCloudMaterial,
  deleteOwnedCloudMaterial,
  upsertSocialTaskCloudMaterial,
} from './cloudMaterials.js';

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
