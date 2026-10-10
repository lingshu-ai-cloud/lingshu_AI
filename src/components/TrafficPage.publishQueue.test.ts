import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  classifyDirectPublishResponse,
  normalizeStoredPublishDraft,
  normalizeStoredPublishQueueItem,
  PUBLISH_STATUS_META,
  publishStorageKey,
  publishSourceRequestFields,
  studioGenerationIsVerified,
} from './TrafficPage';
import { directPublishOutcome, pendingDirectPublishAccountIds } from '../lib/publishQueueState';

assert.equal(publishStorageKey('ow_publish_queue', 'tenant A'), 'ow_publish_queue:tenant%20A');
assert.notEqual(publishStorageKey('ow_publish_queue', 'tenant-a'), publishStorageKey('ow_publish_queue', 'tenant-b'));

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
  sourceProjectId: 'project-1',
  generationKind: 'script',
  generationProvenance: 'ai',
  qualityStatus: 'passed',
  publishable: true,
  generationRecordId: 'script-v1',
  copyAudit: {
    enterpriseFactVersion: 'enterprise-facts-v7-publishing',
    enterpriseFactsHash: 'a'.repeat(64),
    sourceHash: 'b'.repeat(64),
    outputHash: 'c'.repeat(64),
    checkedAt: '2026-09-14T00:00:00.000Z',
    projectId: 'project-1',
    targetPlatforms: ['tiktok'],
  },
});
assert.ok(validItem);
assert.deepEqual(validItem.targetAccountIds, ['account-1']);
assert.deepEqual(validItem.platformCopy.tiktok.hashtags, ['one']);
assert.equal(validItem.deliveryMode, 'schedule');
assert.equal(validItem.status, 'ready');
assert.equal(validItem.sourceVideoPath, validItem.videoPath);
assert.equal(studioGenerationIsVerified(validItem), true);
assert.equal(validItem.copyAudit?.projectId, 'project-1');
assert.equal(validItem.copyAudit?.enterpriseFactVersion, 'enterprise-facts-v7-publishing');
assert.equal(studioGenerationIsVerified({ ...validItem, generationProvenance: 'manual_draft' }), false);
assert.deepEqual(publishSourceRequestFields(validItem), {
  sourceKind: 'project', projectId: 'project-1', sourceVideoPath: validItem.videoPath,
  generationKind: 'script', generationProvenance: 'ai', qualityStatus: 'passed',
  publishable: true, generationRecordId: 'script-v1',
  enterpriseFactVersion: 'enterprise-facts-v7-publishing', copyAudit: validItem.copyAudit,
});
assert.equal(publishSourceRequestFields({ ...validItem, sourceProjectId: undefined }).sourceKind, 'manual_upload');

const partiallyDelivered = {
  ...validItem,
  targetAccountIds: ['youtube-id', 'instagram-id', 'tiktok-id', 'facebook-id'],
  deliveryResults: {
    'youtube-id': { platform: 'youtube' as const, deliveryStatus: 'published' as const, platformPostId: 'yt-video' },
    'instagram-id': { platform: 'instagram' as const, deliveryStatus: 'provider_accepted' as const, providerReceiptId: 'ig-receipt' },
    'tiktok-id': { platform: 'tiktok' as const, deliveryStatus: 'unknown' as const },
  },
};
assert.deepEqual(pendingDirectPublishAccountIds(partiallyDelivered, partiallyDelivered.targetAccountIds), ['facebook-id']);
const restoredPartial = normalizeStoredPublishQueueItem(partiallyDelivered);
assert.ok(restoredPartial);
assert.deepEqual(pendingDirectPublishAccountIds(restoredPartial, restoredPartial.targetAccountIds), ['facebook-id']);
assert.equal(restoredPartial.deliveryResults['tiktok-id']?.deliveryStatus, 'unknown');
assert.deepEqual(directPublishOutcome(partiallyDelivered.targetAccountIds, partiallyDelivered.deliveryResults, 0), {
  status: 'partial', allPublished: false,
});
const publishedResults = {
  'youtube-id': partiallyDelivered.deliveryResults['youtube-id'],
  'instagram-id': { platform: 'instagram' as const, deliveryStatus: 'published' as const, platformPostId: 'ig-post' },
};
assert.deepEqual(directPublishOutcome(['youtube-id', 'instagram-id'], publishedResults, 0), {
  status: 'published', allPublished: true,
});
assert.deepEqual(directPublishOutcome(['youtube-id', 'instagram-id'], {
  ...publishedResults,
  'instagram-id': partiallyDelivered.deliveryResults['instagram-id'],
}, 0), { status: 'provider_processing', allPublished: false });

const acceptedDelivery = classifyDirectPublishResponse('tiktok', {
  ok: true,
  deliveryStatus: 'provider_accepted',
  providerReceiptId: 'tiktok-provider-receipt',
  platformPostId: '',
});
assert.deepEqual(acceptedDelivery, {
  platform: 'tiktok',
  deliveryStatus: 'provider_accepted',
  providerReceiptId: 'tiktok-provider-receipt',
});
assert.equal(PUBLISH_STATUS_META.provider_processing.label, '平台处理中');
assert.throws(() => classifyDirectPublishResponse('tiktok', {
  ok: true,
  deliveryStatus: 'provider_accepted',
}), /可追踪回执/);
assert.throws(() => classifyDirectPublishResponse('tiktok', {
  ok: true,
  deliveryStatus: 'published',
  platformPostId: '',
}), /最终发布回执/);
assert.deepEqual(classifyDirectPublishResponse('tiktok', {
  ok: true,
  deliveryStatus: 'published',
  platformPostId: 'tiktok-public-post',
}), {
  platform: 'tiktok',
  deliveryStatus: 'published',
  platformPostId: 'tiktok-public-post',
});

const processingItem = normalizeStoredPublishQueueItem({
  id: 'processing-item',
  status: 'provider_processing',
  deliveryResults: {
    'tiktok-account': {
      platform: 'tiktok',
      deliveryStatus: 'provider_accepted',
      providerReceiptId: 'tiktok-provider-receipt',
      platformPostId: '',
    },
    invalid: {
      platform: 'tiktok',
      deliveryStatus: 'provider_accepted',
    },
  },
});
assert.ok(processingItem);
assert.equal(processingItem.status, 'provider_processing');
assert.deepEqual(processingItem.deliveryResults, {
  'tiktok-account': {
    platform: 'tiktok',
    deliveryStatus: 'provider_accepted',
    providerReceiptId: 'tiktok-provider-receipt',
  },
});

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

const trafficSource = fs.readFileSync(new URL('./TrafficPage.tsx', import.meta.url), 'utf8');
assert.doesNotMatch(trafficSource, /<DouyinPublicationPackagePanel|<ExternalVideoApprovalPanel/, '新建发布不得重复显示旧发布包和外部素材审批表单');
assert.match(trafficSource, /<ContentLibrary onPublish=\{addSystemFinishedVideo\}/, '一键发布必须直接从系统成片库选择社媒成片');
assert.match(trafficSource, /source === 'material_library'[\s\S]{0,900}creationPath: 'material_processing'/, '我的素材自由创作必须明确进入自由创作三栏工作台');

console.log('TrafficPage publish queue compatibility tests passed');
