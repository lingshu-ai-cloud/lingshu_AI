import assert from 'node:assert/strict';
import { getSocialMonitorOverview } from './socialChannels';
const originalFetch = globalThis.fetch;
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => 'test' } });
try {
  globalThis.fetch = async () => new Response(JSON.stringify({
    accounts: [{ channelId: 'youtube', accountId: 'a' }, { channelId: 'youtube', accountId: 'b' }],
    recentContents: [{ channelId: 'youtube', accountId: 'a', externalContentId: 'v', linkedPackageId: 'package-a' }, { channelId: 'youtube', accountId: 'b', externalContentId: 'v' }],
    recentMetricSnapshots: [
      { channelId: 'youtube', accountId: 'a', externalContentId: 'v', capturedAt: '2026-09-26T00:00:00Z', metrics: { views: 100 } },
      { channelId: 'youtube', accountId: 'a', externalContentId: 'v', capturedAt: '2026-09-27T00:00:00Z', metrics: { views: 0, likes: null } },
      { channelId: 'youtube', accountId: 'b', externalContentId: 'v', capturedAt: '2026-09-27T00:00:00Z', metrics: { views: 200 } },
    ],
  }), { headers: { 'Content-Type': 'application/json' } });
  const result = await getSocialMonitorOverview();
  assert.equal(result.contents[0].metrics.views, 0, 'newest snapshot wins without treating zero as missing');
  assert.equal(result.contents[0].metrics.likes, null);
  assert.equal(result.contents[0].accountId, 'a');
  assert.equal(result.contents[0].linkedPackageId, 'package-a');
  assert.equal(result.contents[1].metrics.views, 200, 'same content id on different account never mixes metrics');
  console.log('social monitor projection tests passed');
} finally {
  globalThis.fetch = originalFetch;
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
}
