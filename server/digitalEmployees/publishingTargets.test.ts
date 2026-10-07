import assert from 'node:assert/strict';
import { localPublishingAccountMocksEnabled, publishingTargetPlatforms } from './publishingTargets.js';

assert.deepEqual(
  publishingTargetPlatforms([
    { platform: 'facebook', accountId: 'a', accountLabel: 'A' },
    { platform: 'facebook', accountId: 'b', accountLabel: 'B' },
    { platform: 'youtube', accountId: 'c', accountLabel: 'C' },
  ]),
  ['facebook', 'youtube'],
);

assert.equal(localPublishingAccountMocksEnabled({ LINGSHU_LOCAL_PREVIEW: '1' }), true, 'the supervised local preview must receive one usable account per platform');
assert.equal(localPublishingAccountMocksEnabled({}), false, 'mock accounts must remain disabled outside local authority or the explicit preview supervisor');

console.log('publishing target tests passed');
