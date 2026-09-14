import assert from 'node:assert/strict';
import {
  SocialContentRequestError,
  safeSocialDeliveryPackageHref,
  socialContentApi,
  socialContentReadRetryDelay,
} from './socialContentApi.js';

const originalFetch = globalThis.fetch;
const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: { getItem: () => 'test-token', setItem: () => {}, removeItem: () => {} },
});

function json(status: number, value: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

try {
  assert.equal(socialContentReadRetryDelay('2', 1, 0, 0), 2_000);
  assert.equal(socialContentReadRetryDelay('Thu, 01 Jan 1970 00:00:03 GMT', 1, 1_000, 0), 2_000);
  assert.equal(socialContentReadRetryDelay(null, 1, 0, 0), 500);
  assert.equal(socialContentReadRetryDelay(null, 3, 0, 0), 2_000);
  assert.equal(socialContentReadRetryDelay('120', 1, 0, 0), 15_000,
    'server retry hints remain bounded for an interactive request');

  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return json(503, { error: 'busy' }, { 'Retry-After': '0' });
    if (calls === 2) return json(504, { error: 'timeout' }, { 'Retry-After': '0' });
    return json(200, { items: [], page: 1, perPage: 24, totalItems: 0, totalPages: 0, status: 'ready' });
  };
  assert.deepEqual((await socialContentApi.getSourceOptions('knowledge')).items, []);
  assert.equal(calls, 3, 'a read retries only a bounded number of transient responses');

  calls = 0;
  globalThis.fetch = async () => { calls += 1; return json(500, { error: 'failed' }); };
  await assert.rejects(() => socialContentApi.getSourceOptions('knowledge'),
    (error: unknown) => error instanceof SocialContentRequestError && error.status === 500);
  assert.equal(calls, 1, 'non-transient server failures are not replayed');

  calls = 0;
  globalThis.fetch = async () => { calls += 1; return json(503, { error: 'busy' }); };
  await assert.rejects(() => socialContentApi.updateTask('task-a', {
    expectedVersion: 'v1', changes: { title: 'new title' },
  }, 'operation-a'), (error: unknown) => error instanceof SocialContentRequestError && error.status === 503);
  assert.equal(calls, 1, 'writes are never automatically replayed after a server response');

  calls = 0;
  globalThis.fetch = async () => { calls += 1; return json(429, { error: 'busy' }); };
  await assert.rejects(() => socialContentApi.uploadArtifactMedia(
    'task-a', new Blob(['media'], { type: 'video/mp4' }), 'clip.mp4', 'upload-a',
  ), (error: unknown) => error instanceof SocialContentRequestError && error.status === 429);
  assert.equal(calls, 1, 'an upload is not blindly replayed even though it has an idempotency key');

  calls = 0;
  const controller = new AbortController();
  controller.abort();
  globalThis.fetch = async () => { calls += 1; return json(200, {}); };
  await assert.rejects(() => socialContentApi.getTask('task-a', controller.signal), /操作已取消/);
  assert.equal(calls, 0, 'an already-cancelled request never reaches the network');

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { location: { origin: 'https://app.example.test' } },
  });
  assert.equal(
    safeSocialDeliveryPackageHref('/api/overseas/starter-198/social-content/delivery-packages/pkg-a/download'),
    'https://app.example.test/api/overseas/starter-198/social-content/delivery-packages/pkg-a/download',
  );
  assert.equal(safeSocialDeliveryPackageHref('https://files.example.test/pkg-a.zip'), null,
    'delivery downloads cannot send task credentials to another origin');
  assert.equal(safeSocialDeliveryPackageHref('/api/overseas/starter-198/workspace'), null,
    'only the exact social delivery route is accepted');
} finally {
  globalThis.fetch = originalFetch;
  if (originalLocalStorage) Object.defineProperty(globalThis, 'localStorage', originalLocalStorage);
  else delete (globalThis as { localStorage?: Storage }).localStorage;
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else delete (globalThis as { window?: Window }).window;
}

console.log('social content API reliability tests passed');
