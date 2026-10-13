import assert from 'node:assert/strict';
import {
  allocateWeeklyPublishingTargets,
  hydrateWeeklyPublishingTargets,
  platformWeeklyCountsFromCadence,
  weeklyPublishingPlatforms,
} from './weeklyPublishingTargets.js';

const targets = [
  { platform: 'facebook' as const, accountId: 'fb-a' },
  { platform: 'facebook' as const, accountId: 'fb-b' },
  { platform: 'tiktok' as const, accountId: 'tt-a' },
];

assert.deepEqual(platformWeeklyCountsFromCadence('各平台条数：facebook=1,tiktok=1'), { facebook: 1, tiktok: 1 });
assert.deepEqual(
  allocateWeeklyPublishingTargets(targets, { facebook: 1, tiktok: 1 }).map(target => [target.accountId, target.weeklyCount]),
  [['fb-a', 1], ['fb-b', 0], ['tt-a', 1]],
  'a platform total must be distributed once rather than multiplied by its account count',
);
assert.deepEqual(
  hydrateWeeklyPublishingTargets(targets, '各平台条数：facebook=1,tiktok=1').map(target => target.weeklyCount),
  [1, 0, 1],
  'legacy cadence text must migrate into structured account quotas',
);
assert.deepEqual(weeklyPublishingPlatforms(hydrateWeeklyPublishingTargets(targets, '各平台条数：facebook=1,tiktok=1')), ['facebook', 'tiktok']);
assert.deepEqual(
  weeklyPublishingPlatforms([
    { platform: 'youtube', accountId: 'yt-a' },
    { platform: 'tiktok', accountId: 'tt-a' },
    { platform: 'instagram', accountId: 'ig-a' },
    { platform: 'facebook', accountId: 'fb-a' },
  ], '各平台条数：youtube=0,tiktok=1,instagram=0,facebook=1'),
  ['facebook', 'tiktok'],
  'a client reading legacy targets must not silently reselect zero-quota platforms',
);

console.log('weekly publishing target tests passed');
