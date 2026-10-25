import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { readAdPlanMetrics } from './adPlanMetricsRequest';
const ready = { source: 'provider', spend: 12, results: 2 };
const immediate = async () => {};
test('real local HTTP reproduction: one transient 503 stays failed without recovery, then bounded GET recovery succeeds', async () => {
  let calls = 0;
  const server = createServer((req, res) => {
    assert.equal(req.method, 'GET'); assert.equal(req.url, '/tasks/fixture/metrics');
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = ++calls % 2 ? 503 : 200;
    res.end(JSON.stringify(res.statusCode === 503 ? { code: 'METRICS_UNAVAILABLE', error: 'fixture upstream temporarily unavailable' } : ready));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const request = async (path: string, options?: RequestInit) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, options), body = await response.json();
    if (!response.ok) throw Object.assign(new Error(body.error), { status: response.status, code: body.code });
    return body;
  };
  try {
    // The old hook issued exactly this one GET and surfaced the rejected request.
    await assert.rejects(request('/tasks/fixture/metrics'), /fixture upstream temporarily unavailable/);
    assert.equal(calls, 1);
    calls = 0;
    assert.deepEqual(await readAdPlanMetrics('fixture', new AbortController().signal, request, immediate), ready);
    assert.equal(calls, 2);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
test('network interruption recovers once; persistent failure stops at two attempts and retains final evidence', async () => {
  let calls = 0;
  const request = async () => { if (++calls === 1) throw new TypeError('Failed to fetch'); return ready; };
  assert.deepEqual(await readAdPlanMetrics('a', new AbortController().signal, request, immediate), ready); assert.equal(calls, 2);
  calls = 0; const final = Object.assign(new Error('final upstream evidence'), { status: 503, code: 'METRICS_UNAVAILABLE', requestId: 'trace-2' });
  await assert.rejects(readAdPlanMetrics('a', new AbortController().signal, async () => { calls++; throw final; }, immediate), e => e === final);
  assert.equal(calls, 2);
});
test('auth failures, rate limits, report conflicts and missing resources never get automatic retries', async () => {
  for (const fault of [{ status: 401 }, { status: 403 }, { status: 429 }, { status: 503, code: '190' }, { status: 503, code: '4' }, { status: 503, code: 'METRICS_NOT_READY' }, { status: 404, code: 'NOT_FOUND' }]) {
    let calls = 0; const failure = Object.assign(new Error('explicit failure'), fault);
    await assert.rejects(readAdPlanMetrics('a', new AbortController().signal, async () => { calls++; throw failure; }, immediate), e => e === failure);
    assert.equal(calls, 1, JSON.stringify(fault));
  }
});
test('scope switch cancels pending recovery before any second request', async () => {
  const controller = new AbortController(); let calls = 0;
  await assert.rejects(readAdPlanMetrics('a', controller.signal, async () => { calls++; throw new TypeError('Failed to fetch'); }, async () => { controller.abort(); }), { name: 'AbortError' });
  assert.equal(calls, 1);
});
test('default recovery wait is abortable and sends no retry after unmount', async () => {
  const controller = new AbortController(); let calls = 0;
  const pending = readAdPlanMetrics('a', controller.signal, async () => { calls++; throw new TypeError('network'); });
  const timer = setTimeout(() => controller.abort(), 10);
  try { await assert.rejects(pending, { name: 'AbortError' }); assert.equal(calls, 1); } finally { clearTimeout(timer); }
});
