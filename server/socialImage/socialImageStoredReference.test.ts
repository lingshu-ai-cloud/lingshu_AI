import assert from 'node:assert/strict';
import test from 'node:test';
import { readStoredImagePostReference } from './socialImageStoredReference';

test('tenant image-post references read the persisted original and never collect a remote replacement', async () => {
  const reads: string[] = [];
  const ports = {
    readRecord: async () => ({ tenantId: 'tenant-a', aiAnalysis: JSON.stringify({ contentFormat: 'image', imageObjectKeys: ['original-1', 'original-2'] }) }),
    download: async (key: string) => { reads.push(key); return { bytes: Buffer.from('stored-image'), mimeType: 'image/png' }; },
    readFile: async () => null,
  };
  const result = await readStoredImagePostReference('tenant-a', '/api/overseas/videos/ref-1/image/1', ports);
  assert.equal(result?.bytes.toString(), 'stored-image'); assert.deepEqual(reads, ['original-2']);
  assert.ok(await readStoredImagePostReference('tenant-a', '/api/overseas/videos/ref-1/thumbnail', ports));
  assert.deepEqual(reads, ['original-2', 'original-1']);
});

test('cross-tenant, video records, invalid indices and remote URLs cannot access objects', async () => {
  let downloads = 0;
  const ports = {
    readRecord: async () => ({ tenantId: 'tenant-a', aiAnalysis: { contentFormat: 'image', imageObjectKeys: ['private'] } }),
    download: async () => { downloads++; return { bytes: Buffer.from('private'), mimeType: 'image/png' }; },
    readFile: async () => null,
  };
  assert.equal(await readStoredImagePostReference('tenant-b', '/api/overseas/videos/ref-1/image/0', ports), null);
  for (const url of ['https://evil.test/image.png', '/api/overseas/videos/ref-1/image/10', '/api/overseas/videos/ref-1/image/-1', '/api/overseas/videos/ref-1/image/999999999999999999999']) {
    assert.equal(await readStoredImagePostReference('tenant-a', url, ports), null);
  }
  assert.equal(await readStoredImagePostReference('tenant-a', '/api/overseas/videos/ref-1/image/0', {
    ...ports, readRecord: async () => ({ tenantId: 'tenant-a', aiAnalysis: { contentFormat: 'video', imageObjectKeys: ['private'] } }),
  }), null);
  assert.equal(downloads, 0);
});

test('stored thumbnail files recover without any external image fetch; non-image bytes are rejected', async () => {
  const ports = {
    readRecord: async () => ({ tenantId: 'tenant-a', thumbnailFile: 'original.png', aiAnalysis: { contentFormat: 'image' } }),
    download: async () => null,
    readFile: async (id: string, name: string) => { assert.equal(id, 'ref-1'); assert.equal(name, 'original.png'); return { bytes: Buffer.from('file'), mimeType: 'image/png' }; },
  };
  assert.equal((await readStoredImagePostReference('tenant-a', '/api/overseas/videos/ref-1/thumbnail', ports))?.bytes.toString(), 'file');
  assert.equal((await readStoredImagePostReference('tenant-a', '/api/overseas/videos/ref-1/thumbnail', {
    ...ports,
    readRecord: async () => ({ tenantId: 'tenant-a', thumbnailFile: 'original.png', aiAnalysis: { contentFormat: 'image', thumbnailObjectKey: 'unavailable-object' } }),
    download: async () => { throw new Error('object storage unavailable'); },
  }))?.bytes.toString(), 'file');
  assert.equal(await readStoredImagePostReference('tenant-a', '/api/overseas/videos/ref-1/thumbnail', {
    ...ports, readFile: async () => ({ bytes: Buffer.from('html'), mimeType: 'text/html' }),
  }), null);
});
