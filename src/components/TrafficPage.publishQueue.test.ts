import assert from 'node:assert/strict';
import { normalizeStoredPublishDraft, normalizeStoredPublishQueueItem } from './TrafficPage';

const legacyItem = normalizeStoredPublishQueueItem({ id: 'legacy-item' });
assert.ok(legacyItem);
assert.equal(legacyItem.videoPath, '');
assert.equal(legacyItem.title, '');
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

const validItem = normalizeStoredPublishQueueItem({
  id: 'valid-item',
  selected: true,
  videoPath: '/api/overseas/publishing/local-videos/example.mp4',
  title: 'Example',
  description: 'Description',
  targetAccountIds: ['account-1', '', 7],
  platformCopy: { tiktok: { caption: 'Caption', hashtags: ['one', 2] } },
  deliveryMode: 'schedule',
  scheduledAt: '2026-08-27T20:00',
  status: 'ready',
  completedTargets: 1,
});
assert.ok(validItem);
assert.deepEqual(validItem.targetAccountIds, ['account-1']);
assert.deepEqual(validItem.platformCopy.tiktok.hashtags, ['one']);
assert.equal(validItem.deliveryMode, 'schedule');
assert.equal(validItem.status, 'ready');

const draft = normalizeStoredPublishDraft({
  title: 'Fallback title',
  description: null,
  items: [
    { videoPath: '/media/one.mp4', title: 'One', description: 'First', platform: 'tiktok' },
    null,
    { videoPath: 42, title: 'Legacy', description: 'Second', platform: 'unsupported' },
  ],
});
assert.ok(draft);
assert.equal(draft.description, '');
assert.equal(draft.items?.length, 2);
assert.equal(draft.items?.[1].videoPath, undefined);
assert.equal(draft.items?.[1].platform, undefined);

console.log('TrafficPage publish queue compatibility tests passed');
