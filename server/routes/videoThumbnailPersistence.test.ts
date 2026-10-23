import assert from 'node:assert/strict';
import test from 'node:test';
import type { attachFile } from '../storage/files.js';
import type { store } from '../storage/index.js';
import {
  createVideoThumbnailPersistence,
  isExpiredSignedThumbnail,
  isSignedExpiringThumbnail,
  publicSourceThumbnail,
  recordThumbnailUrl,
  signedThumbnailExpiry,
} from './videoThumbnailPersistence.js';

test('signed thumbnail expiry and stable record URL remain source-independent', () => {
  const future = Math.floor((Date.now() + 5 * 60_000) / 1000);
  const past = Math.floor((Date.now() - 60_000) / 1000);
  assert.equal(signedThumbnailExpiry(`https://example.com/cover.jpg?x-expires=${future}`), future * 1000);
  assert.equal(isSignedExpiringThumbnail(`https://example.com/cover.jpg?x-expires=${future}`), true);
  assert.equal(isExpiredSignedThumbnail(`https://example.com/cover.jpg?x-expires=${past}`), true);
  assert.equal(signedThumbnailExpiry(`https://scontent.fbcdn.net/cover.jpg?oe=${future.toString(16)}`), future * 1000);
  assert.equal(isSignedExpiringThumbnail('/media/cover.jpg'), false);
  assert.equal(recordThumbnailUrl('video-1'), '/api/overseas/videos/video-1/thumbnail');
});

test('public YouTube and Instagram covers resolve without a provider request', async () => {
  assert.equal(await publicSourceThumbnail({ platform: 'youtube', sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }), 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
  assert.equal(await publicSourceThumbnail({ platform: 'instagram', sourceUrl: 'https://www.instagram.com/p/ABC123/?utm_source=test' }), 'https://www.instagram.com/p/ABC123/media/?size=l');
});

test('COS thumbnail writes evidence before returning the stable URL', async () => {
  const updates: Array<Record<string, unknown>> = [];
  const dataStore = {
    getById: async () => ({ id: 'video-1', aiAnalysis: JSON.stringify({ exact: true }) }),
    update: async (_collection: string, _id: string, patch: Record<string, unknown>) => { updates.push(patch); return patch; },
  } as unknown as typeof store;
  const persistence = createVideoThumbnailPersistence({
    collection: 'trend_videos', mediaDir: '/unused', dataStore,
    uploadObject: async (_id, role, body, type) => {
      assert.equal(role, 'thumbnail');
      assert.equal(body.toString(), 'image');
      assert.equal(type, 'image/png');
      return 'tenant/video-1/thumb.png';
    },
  });
  assert.equal(await persistence.storeThumbnailBuffer('video-1', Buffer.from('image'), 'image/png'), recordThumbnailUrl('video-1'));
  assert.deepEqual(JSON.parse(String(updates[0]?.aiAnalysis)), {
    exact: true, thumbnailStorage: 'cos', thumbnailObjectKey: 'tenant/video-1/thumb.png', thumbnailExtension: 'png',
  });
});

test('record-file fallback removes a stale COS key and retains the stable URL', async () => {
  const updates: Array<Record<string, unknown>> = [];
  const dataStore = {
    getById: async () => ({ id: 'video-1', aiAnalysis: JSON.stringify({ thumbnailObjectKey: 'stale', exact: true }) }),
    update: async (_collection: string, _id: string, patch: Record<string, unknown>) => { updates.push(patch); return patch; },
  } as unknown as typeof store;
  const persistence = createVideoThumbnailPersistence({
    collection: 'trend_videos', mediaDir: '/unused', dataStore,
    uploadObject: async () => { throw new Error('COS unavailable'); },
    attachFile: (async () => 'video-1-thumbnail.jpg') as typeof attachFile,
  });
  assert.equal(await persistence.storeThumbnailBuffer('video-1', Buffer.from('image'), 'image/jpeg'), recordThumbnailUrl('video-1'));
  assert.equal(updates[0]?.thumbnailFile, 'video-1-thumbnail.jpg');
  assert.equal(updates[0]?.thumbnailUrl, recordThumbnailUrl('video-1'));
  assert.deepEqual(JSON.parse(String(updates[0]?.aiAnalysis)), { exact: true, thumbnailStorage: 'record_file', thumbnailExtension: 'jpg' });
});
