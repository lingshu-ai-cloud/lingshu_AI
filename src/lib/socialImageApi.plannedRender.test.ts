import assert from 'node:assert/strict';
import test from 'node:test';
import { socialImageApi } from './socialImageApi';

test('planned paid render sends only task/unit identities and never retries an uncertain response', async () => {
  const originalFetch = globalThis.fetch;
  const originalStorage = globalThis.localStorage;
  const calls: Array<{ url: string; init: RequestInit }> = [];
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } });
  globalThis.fetch = (async (url, init) => {
    calls.push({ url: String(url), init: init || {} });
    return new Response(JSON.stringify({ ok: false, error: 'outcome unknown' }), {
      status: 502, headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  try {
    const controller = new AbortController();
    const result = await socialImageApi.renderPlannedUnit('task-1', 'unit-2', controller.signal);
    assert.equal(result.ok, false);
    assert.equal(result.error, 'outcome unknown');
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, '/api/overseas/studio/fb-poster/render');
    assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), { imageTaskId: 'task-1', imageJobId: 'unit-2' });
    assert.equal(calls[0]?.init.signal, controller.signal);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalStorage === undefined) delete (globalThis as { localStorage?: Storage }).localStorage;
    else Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: originalStorage });
  }
});
