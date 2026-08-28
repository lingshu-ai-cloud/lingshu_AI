import assert from 'node:assert/strict';
import { normalizeStoredPublishDraft, normalizeStoredPublishQueueItem } from './TrafficPage';

const legacyItem = normalizeStoredPublishQueueItem({ id: 'legacy-item' });
assert.ok(legacyItem);
assert.equal(legacyItem.videoPath, '');
assert.equal(legacyItem.title, '');
assert.equal(legacyItem.internalTitle, '未命名视频');
assert.deepEqual(legacyItem.targetAccountIds, []);
assert.deepEqual(legacyItem.platformCopy, {});
assert.equal(legacyItem.deliveryMode, 'now');
assert.equal(legacyItem.status, 'draft');

const malformedItem = normalizeStoredPublishQueueItem({
  id: 'malformed-item',
  videoPath: 42,
  title: null,
  targetAccountIds: 'not-an-array',
  platformCopy: [],
  deliveryMode: 'later',
  status: 'unknown',
  completedTargets: 'NaN',
});
assert.ok(malformedItem);
assert.equal(malformedItem.videoPath, '');
assert.equal(malformedItem.title, '');
assert.deepEqual(malformedItem.targetAccountIds, []);
assert.equal(malformedItem.completedTargets, 0);

const oldStudioItem = normalizeStoredPublishQueueItem({
  id: 'old-studio-item',
  title: '素材库智能生成 - 视频1 * 英语',
  description: 'Factory-direct home essentials for retail buyers. #homefinds',
});
assert.ok(oldStudioItem);
assert.equal(oldStudioItem.internalTitle, '素材库智能生成 - 视频1 * 英语');
assert.equal(oldStudioItem.title, 'Factory-direct home essentials for retail buyers.');

const partiallyMigratedStudioItem = normalizeStoredPublishQueueItem({
  id: 'partially-migrated-studio-item',
  internalTitle: '素材库智能生成 - 视频1 * 英语',
  title: '素材库智能生成 - 视频1 * 英语',
  description: 'Factory-direct home essentials for retail buyers. #homefinds',
});
assert.equal(partiallyMigratedStudioItem?.title, 'Factory-direct home essentials for retail buyers.');

const validItem = normalizeStoredPublishQueueItem({
  id: 'valid-item',
  selected: true,
  videoPath: '/api/overseas/publishing/local-videos/example.mp4',
  title: 'Example',
  internalTitle: '项目 A · 视频 1 · 英语',
  publishTitle: 'Buyer-facing precision assembly demo',
  description: 'Description',
  targetAccountIds: ['account-1', '', 7],
  platformCopy: { tiktok: { caption: 'Caption', hashtags: ['one', 2] } },
  deliveryMode: 'schedule',
  scheduledAt: '2026-08-27T20:00',
  status: 'ready',
  completedTargets: 1,
});
assert.ok(validItem);
assert.equal(validItem.internalTitle, '项目 A · 视频 1 · 英语');
assert.equal(validItem.title, 'Buyer-facing precision assembly demo');
assert.deepEqual(validItem.targetAccountIds, ['account-1']);
assert.deepEqual(validItem.platformCopy.tiktok.hashtags, ['one']);
assert.equal(validItem.deliveryMode, 'schedule');
assert.equal(validItem.status, 'ready');

const draft = normalizeStoredPublishDraft({
  title: 'Fallback title',
  internalTitle: '内部项目名',
  publishTitle: 'Public buyer title',
  description: null,
  items: [
    { videoPath: '/media/one.mp4', title: 'One', description: 'First', platform: 'tiktok' },
    null,
    { videoPath: 42, title: 'Legacy', description: 'Second', platform: 'unsupported' },
  ],
});
assert.ok(draft);
assert.equal(draft.internalTitle, '内部项目名');
assert.equal(draft.publishTitle, 'Public buyer title');
assert.equal(draft.description, '');
assert.equal(draft.items?.length, 2);
assert.equal(draft.items?.[1].videoPath, undefined);
assert.equal(draft.items?.[1].platform, undefined);

console.log('TrafficPage publish queue compatibility tests passed');
