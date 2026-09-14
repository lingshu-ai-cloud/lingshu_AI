import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_READ_ONLY_PATHS,
  loadBearerTokens,
  parseCapacityArgs,
  runCapacityAcceptance,
} from './capacity-acceptance.mjs';

const temporary = await mkdtemp(path.join(os.tmpdir(), 'lingshu-capacity-'));
const tokenFile = path.join(temporary, 'tokens.json');
const tokenEntries = [
  { tenantId: 'tenant-a', token: 'capacity-secret-one' },
  { tenantId: 'tenant-b', token: 'capacity-secret-two' },
  { tenantId: 'tenant-b', token: 'capacity-secret-three' },
];
await writeFile(tokenFile, `${JSON.stringify(tokenEntries)}\n`, { mode: 0o600 });
if (process.platform !== 'win32') await chmod(tokenFile, 0o600);

const seenAuthorization = new Set();
let failureCounter = 0;
let nonGetRequests = 0;
const server = http.createServer((request, response) => {
  if (request.method !== 'GET') nonGetRequests += 1;
  if (request.headers.authorization) seenAuthorization.add(request.headers.authorization);
  const pathname = new URL(request.url ?? '/', 'http://mock.invalid').pathname;
  if (pathname === '/api/overseas/mock/read') {
    setTimeout(() => {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end('{"ok":true}');
    }, 4);
    return;
  }
  if (pathname === '/api/overseas/mock/failure') {
    failureCounter += 1;
    const status = failureCounter % 2 ? 429 : 503;
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end('{"ok":false}');
    return;
  }
  if (pathname === '/api/overseas/mock/slow') {
    setTimeout(() => {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end('{"ok":true}');
    }, 100);
    return;
  }
  if (DEFAULT_READ_ONLY_PATHS.includes(pathname)) {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end('{"status":"ok"}');
    return;
  }
  response.writeHead(404).end();
});

try {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const defaults = parseCapacityArgs([]);
  assert.deepEqual(defaults.paths, [...DEFAULT_READ_ONLY_PATHS]);
  assert.equal(defaults.profile, 'safe-smoke-v1');
  assert.throws(
    () => parseCapacityArgs(['--path', '/api/overseas/mock/read', '--tokens', tokenFile]),
    /--confirm-read-only/,
  );
  assert.throws(
    () => parseCapacityArgs(['--path', '/api/overseas/studio/generate', '--confirm-read-only', '--tokens', tokenFile]),
    /mutation-like action/,
  );
  assert.deepEqual(
    parseCapacityArgs(['--path', '/api/overseas/mock/read', '--confirm-read-only']).paths,
    ['/api/overseas/mock/read'],
  );
  assert.throws(
    () => parseCapacityArgs(['--path', '/api/overseas/mock/read?access_token=secret', '--confirm-read-only']),
    /sensitive query parameter/,
  );
  assert.throws(
    () => parseCapacityArgs(['--base-url', 'http://staging.example.test', '--tokens', tokenFile]),
    /HTTPS targets/,
  );
  assert.throws(
    () => parseCapacityArgs(['--path', '/api/overseas/mock/read', '--path', '/api/overseas/mock/read', '--confirm-read-only']),
    /duplicate read-only paths/,
  );

  const tokens = await loadBearerTokens(tokenFile);
  assert.equal(tokens.length, 3);
  const passingConfig = parseCapacityArgs([
    '--base-url', baseUrl,
    '--path', '/api/overseas/mock/read',
    '--confirm-read-only',
    '--tokens', tokenFile,
    '--concurrency', '6',
    '--duration-seconds', '0.2',
    '--warmup-seconds', '0',
    '--timeout-ms', '500',
    '--min-rps', '1',
    '--max-error-rate', '0',
    '--max-p95-ms', '500',
    '--max-p99-ms', '500',
    '--min-token-count', '3',
    '--min-tenant-count', '2',
  ]);
  const passing = await runCapacityAcceptance(passingConfig, tokens, { runId: 'offline-pass' });
  assert.equal(passing.verdict, 'PASS', JSON.stringify(passing.checks));
  assert.ok(passing.metrics.aggregate.attempts > 0);
  assert.equal(passing.configuration.availableTokenCount, 3);
  assert.equal(passing.configuration.exercisedTokenCount, 3);
  assert.equal(passing.configuration.exercisedTenantCount, 2);
  assert.equal(passing.peakInFlight, 6);
  assert.deepEqual([...seenAuthorization].sort(), [
    'Bearer capacity-secret-one',
    'Bearer capacity-secret-three',
    'Bearer capacity-secret-two',
  ]);
  assert.equal(JSON.stringify(passing).includes('capacity-secret'), false, 'reports must never contain bearer tokens');
  await assert.rejects(
    runCapacityAcceptance({ ...passingConfig, concurrency: 2, minTokenCount: 3 }, tokens, { runId: 'offline-insufficient-token-coverage' }),
    /exercises 2 token entries/,
  );

  const failureConfig = parseCapacityArgs([
    '--base-url', baseUrl,
    '--path', '/api/overseas/mock/failure',
    '--confirm-read-only',
    '--tokens', tokenFile,
    '--concurrency', '4',
    '--duration-seconds', '0.1',
    '--warmup-seconds', '0',
    '--timeout-ms', '500',
    '--min-rps', '0',
    '--max-error-rate', '0',
    '--max-p95-ms', '500',
    '--max-p99-ms', '500',
  ]);
  const failed = await runCapacityAcceptance(failureConfig, tokens, { runId: 'offline-http-failure' });
  assert.equal(failed.verdict, 'FAIL');
  assert.ok(failed.errorsByCategory.http_429 > 0);
  assert.ok(failed.errorsByCategory.http_5xx > 0);
  assert.equal(failed.metrics.aggregate.statuses['429'] > 0, true);
  assert.equal(failed.metrics.aggregate.statuses['503'] > 0, true);

  const timeoutConfig = parseCapacityArgs([
    '--base-url', baseUrl,
    '--path', '/api/overseas/mock/slow',
    '--confirm-read-only',
    '--tokens', tokenFile,
    '--concurrency', '2',
    '--duration-seconds', '0.08',
    '--warmup-seconds', '0',
    '--timeout-ms', '50',
    '--min-rps', '0',
    '--max-error-rate', '0',
    '--max-p95-ms', '500',
    '--max-p99-ms', '500',
  ]);
  const timedOut = await runCapacityAcceptance(timeoutConfig, tokens, { runId: 'offline-timeout' });
  assert.equal(timedOut.verdict, 'FAIL');
  assert.ok(timedOut.errorsByCategory.timeout > 0);
  assert.equal(nonGetRequests, 0, 'capacity harness must issue GET requests only');

  console.log('Capacity acceptance harness offline tests passed (loopback mock only; no external or production traffic)');
} finally {
  const closed = new Promise(resolve => server.close(resolve));
  server.closeAllConnections?.();
  await closed;
  await rm(temporary, { recursive: true, force: true });
}
