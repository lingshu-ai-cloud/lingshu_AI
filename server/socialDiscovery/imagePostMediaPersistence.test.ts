import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DataStore } from '../storage/datastore.js';
import { createImagePostMediaPersistence } from './imagePostMediaPersistence.js';

test('image post media persistence keeps one COS key per unique public image', async () => {
  const events: string[] = [];
  let row: Record<string, unknown> = { id: 'post-1', aiAnalysis: JSON.stringify({ caption: 'Product' }) };
  const store = { async getById() { return row; }, async update(_collection: string, _id: string, patch: Record<string, unknown>) {
    events.push('update'); row = { ...row, ...patch }; return true;
  } } as unknown as DataStore;
  const media = createImagePostMediaPersistence({ store, collection: 'trend_videos',
    async cacheThumbnail() { events.push('thumbnail'); return '/media/post-1.png'; },
    async fetchImage(url) { events.push(`fetch:${url}`); return { base64: Buffer.from(url).toString('base64'), mimeType: 'image/png' }; },
    async uploadObject(_recordId, role) { events.push(`upload:${role}`); return `tenant/post-1/${role}.png`; },
  });
  assert.equal(await media.persistThumbnail('post-1', 'https://example.test/1.png'), '/media/post-1.png');
  const urls = await media.persistImages('post-1', ['https://example.test/1.png', 'https://example.test/1.png', '/media/old.png']);
  assert.deepEqual(urls, ['/api/overseas/videos/post-1/image/0', '/media/old.png']);
  assert.deepEqual(JSON.parse(String(row.aiAnalysis)).imageObjectKeys, ['tenant/post-1/image-1.png']);
  assert.deepEqual(events, ['thumbnail', 'update', 'fetch:https://example.test/1.png', 'upload:image-1', 'update']);
});

test('failed media metadata write blocks visual analysis callers', async () => {
  const store = { async getById() { return { id: 'post-1', aiAnalysis: '{}' }; }, async update() { return false; } } as unknown as DataStore;
  const media = createImagePostMediaPersistence({ store, collection: 'trend_videos',
    async cacheThumbnail() { return null; }, async fetchImage() { return null; }, async uploadObject() { throw Error('unused'); },
  });
  await assert.rejects(media.persistImages('post-1', ['https://example.test/1.png']), /source_persistence_failed/);
});
