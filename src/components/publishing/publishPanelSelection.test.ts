import assert from 'node:assert/strict';
import test from 'node:test';
import { createPublishItem } from '../../lib/publishQueueState';
import { derivePublishPanelSelection } from './publishPanelSelection';
import type { PublishAccount } from './usePublishingAccounts';

const accounts: PublishAccount[] = [
  { id: 'youtube-1', platform: 'youtube', title: 'Channel', status: 'connected' },
  { id: 'tiktok-1', platform: 'tiktok', title: 'TikTok', status: 'connected' },
  { id: 'instagram-1', platform: 'instagram', title: 'Instagram', status: 'expired' },
];

test('publishing selection excludes unavailable accounts and time-undecided queue items', () => {
  const ready = {
    ...createPublishItem({ videoPath: '/video.mp4', title: 'Ready', description: '' }, ['youtube-1', 'tiktok-1', 'instagram-1']),
    status: 'ready' as const,
  };
  const flexible = { ...ready, id: 'flexible', deliveryMode: 'flexible' as const };
  const selection = derivePublishPanelSelection([ready, flexible], accounts, ready.id, []);

  assert.deepEqual(selection.connectedAccounts.map(account => account.id), ['youtube-1']);
  assert.deepEqual(selection.publishableItems.map(item => item.id), [ready.id]);
  assert.deepEqual(selection.flexibleItems.map(item => item.id), ['flexible']);
  assert.equal(selection.publishableAssignments, 1);
  assert.equal(selection.totalAssignments, 2);
  assert.deepEqual(selection.pendingCalendarItems.map(item => item.platforms), [['youtube'], ['youtube']]);
});

test('unverified project generation cannot enter real publishing selection', () => {
  const unverified = {
    ...createPublishItem({ videoPath: '/video.mp4', title: 'Unverified', description: '', sourceProjectId: 'project-1' }, ['youtube-1']),
    status: 'ready' as const,
  };
  const selection = derivePublishPanelSelection([unverified], accounts, unverified.id, []);
  assert.equal(selection.publishableItems.length, 0);
  assert.equal(selection.pendingCalendarItems.length, 1);
});
