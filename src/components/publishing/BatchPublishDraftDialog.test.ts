import assert from 'node:assert/strict';
import test from 'node:test';
import { batchDraftToQueueItem, parseEditableTags } from './BatchPublishDraftDialog';

test('editable tags are normalized without losing a partially typed value', () => {
  assert.deepEqual(parseEditableTags('#OEM, B2B OEM；lowmoq'), ['OEM', 'B2B', 'lowmoq']);
});

test('batch draft becomes a flexible local queue item with production copy', () => {
  const item = batchDraftToQueueItem({
    id: 'project-1:current',
    selected: true,
    tagText: '#OEM B2B',
    tags: ['OEM', 'B2B'],
    videoPath: '/tenant/video.mp4',
    title: '生产标题',
    description: '生产任务文案',
    platform: 'tiktok',
    generationKind: 'script',
    generationProvenance: 'ai',
    qualityStatus: 'passed',
    publishable: true,
    generationRecordId: 'generation-1',
  });
  assert.ok(item);
  assert.equal(item.status, 'ready');
  assert.equal(item.deliveryMode, 'flexible');
  assert.deepEqual(item.platformCopy.tiktok, { caption: '生产任务文案', tags: ['OEM', 'B2B'], hashtags: ['OEM', 'B2B'] });
});
