import assert from 'node:assert/strict';
import { publishingTargetPlatforms } from './publishingTargets.js';

assert.deepEqual(
  publishingTargetPlatforms([
    { platform: 'facebook', accountId: 'a', accountLabel: 'A' },
    { platform: 'facebook', accountId: 'b', accountLabel: 'B' },
    { platform: 'youtube', accountId: 'c', accountLabel: 'C' },
  ]),
  ['facebook', 'youtube'],
);

console.log('publishing target tests passed');
