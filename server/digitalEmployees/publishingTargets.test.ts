import assert from 'node:assert/strict';
import { localPublishingAccountMocksEnabled, publishingTargetPlatforms } from './publishingTargets.js';
import { runWithDataAuthority } from '../storage/dataAuthority.js';

assert.deepEqual(
  publishingTargetPlatforms([
    { platform: 'facebook', accountId: 'a', accountLabel: 'A' },
    { platform: 'facebook', accountId: 'b', accountLabel: 'B' },
    { platform: 'youtube', accountId: 'c', accountLabel: 'C' },
  ]),
  ['facebook', 'youtube'],
);

assert.equal(localPublishingAccountMocksEnabled({ LINGSHU_LOCAL_PREVIEW: '1' }), false, 'local preview must not fabricate connected accounts by default');
assert.equal(localPublishingAccountMocksEnabled({ LINGSHU_LOCAL_PREVIEW: '1', LINGSHU_LOCAL_PUBLISHING_ACCOUNT_MOCKS: '1' }), true, 'an explicit supervised demo may opt into mock accounts');
assert.equal(runWithDataAuthority('local', () => localPublishingAccountMocksEnabled({ LINGSHU_LOCAL_PUBLISHING_ACCOUNT_MOCKS: '1' })), true, 'local-authority tests may explicitly opt into mock accounts');
assert.equal(localPublishingAccountMocksEnabled({ LINGSHU_LOCAL_PUBLISHING_ACCOUNT_MOCKS: '1' }), false, 'mock accounts must remain disabled outside local authority or the explicit preview supervisor');

console.log('publishing target tests passed');
