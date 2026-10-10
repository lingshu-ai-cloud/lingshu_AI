import assert from 'node:assert/strict';
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import express from 'express';

// An upstream that accepts requests but never responds reproduces the provider
// stall that previously left the studio in a permanent loading state.
let activeUpstreamRequests = 0;
const stalledUpstream = http.createServer((_req, res) => {
  activeUpstreamRequests += 1;
  res.once('close', () => { activeUpstreamRequests = Math.max(0, activeUpstreamRequests - 1); });
});
await new Promise<void>(resolve => stalledUpstream.listen(0, '127.0.0.1', resolve));
const upstreamAddress = stalledUpstream.address();
assert.ok(upstreamAddress && typeof upstreamAddress !== 'string');

process.env.DASHSCOPE_API_KEY = 'test-key';
process.env.DASHSCOPE_BASE_URL = `http://127.0.0.1:${upstreamAddress.port}/v1`;
process.env.GEMINI_API_KEY = '';
process.env.STUDIO_TRANSLATION_PROVIDER_TIMEOUT_MS = '1000';
// Keep this route-level test independent from production subscription settings.
process.env.SUBSCRIPTION_ENFORCED = 'false';

const { auth } = await import('../storage/index.js');
auth.verifyToken = async () => ({ userId: 'deadline-test-user', tenantId: 'deadline-test-tenant' });
const { studioRouter } = await import('./studio.js');
const app = express();
app.use(express.json());
app.use('/studio', studioRouter);
const apiServer = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => apiServer.once('listening', resolve));
const apiAddress = apiServer.address();
assert.ok(apiAddress && typeof apiAddress !== 'string');

try {
  const startedAt = Date.now();
  const response = await fetch(`http://127.0.0.1:${apiAddress.port}/studio/translate/batch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: '[0-3s] 你好', source: 'zh', targets: ['en', 'es'] }),
  });
  const data = await response.json() as { ok?: boolean; source?: string; translations?: Record<string, string>; error?: string };
  const elapsedMs = Date.now() - startedAt;
  assert.equal(response.status, 200);
  assert.equal(data.ok, false);
  assert.equal(data.source, 'partial');
  assert.deepEqual(data.translations, {});
  assert.match(String(data.error), /timed out|GEMINI_API_KEY/i);
  // The route enforces a 5s minimum provider timeout. The initial batch and
  // bounded repair workers may each consume one provider attempt, but the
  // request must not multiply that delay serially by language count.
  assert.ok(elapsedMs < 13_000, `stalled provider should be bounded, took ${elapsedMs}ms`);
  for (let i = 0; i < 100 && activeUpstreamRequests > 0; i += 1) await delay(10);
  assert.equal(activeUpstreamRequests, 0, 'provider timeouts should release upstream sockets');

  const clientAbort = new AbortController();
  const disconnectedRequest = fetch(`http://127.0.0.1:${apiAddress.port}/studio/translate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: '[0-3s] 你好', target: 'en' }),
    signal: clientAbort.signal,
  });
  for (let i = 0; i < 50 && activeUpstreamRequests === 0; i += 1) await delay(10);
  assert.equal(activeUpstreamRequests, 1);
  clientAbort.abort();
  await assert.rejects(disconnectedRequest, /abort/i);
  for (let i = 0; i < 50 && activeUpstreamRequests > 0; i += 1) await delay(10);
  assert.equal(activeUpstreamRequests, 0, 'client disconnect should abort the in-flight provider socket');
} finally {
  await new Promise<void>(resolve => apiServer.close(() => resolve()));
  stalledUpstream.closeAllConnections();
  await new Promise<void>(resolve => stalledUpstream.close(() => resolve()));
}

console.log('studio translation deadline tests passed');
