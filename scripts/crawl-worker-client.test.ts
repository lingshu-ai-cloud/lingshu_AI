import assert from 'node:assert/strict';
import { CrawlWorkerClient, isLeaseLostError } from './crawl-worker-client.js';

const requests: Array<{ url: string; init?: RequestInit }> = [];
const leaseToken = '12345678-1234-4abc-8def-1234567890ab';
const responses = [
  {
    job: {
      id: 'crawl-job-1', tenantId: 'tenant-1', platform: 'youtube', mode: 'keyword',
      keyword: 'sensor', workerId: 'contract-worker', leaseToken, revision: 7,
      leasedUntil: '2099-01-01T00:00:00.000Z',
    },
  },
  { ok: true, revision: 8, leasedUntil: '2099-01-01T00:01:00.000Z' },
  { ok: true, status: 'done' },
];
const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  requests.push({ url: String(input), init });
  return new Response(JSON.stringify(responses.shift()), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

const client = new CrawlWorkerClient({
  serverUrl: 'https://worker.example.test/',
  workerToken: 'secret-worker-token',
  workerId: 'contract-worker',
  fetchImpl,
});
const job = await client.nextJob();
assert.ok(job);
assert.equal(job.revision, 7);
assert.equal(job.leaseToken, leaseToken);
const renewed = await client.heartbeat(job, job.revision);
assert.equal(renewed.revision, 8);
await client.complete(job, renewed.revision, { ok: true, result: { imported: 1 } });

assert.match(requests[0].url, /\/next\?workerId=contract-worker$/);
assert.equal(new Headers(requests[0].init?.headers).get('x-crawl-worker-token'), 'secret-worker-token');
const heartbeatBody = JSON.parse(String(requests[1].init?.body));
assert.deepEqual(heartbeatBody, { workerId: 'contract-worker', leaseToken, revision: 7 });
const completionBody = JSON.parse(String(requests[2].init?.body));
assert.deepEqual(completionBody, {
  ok: true,
  result: { imported: 1 },
  workerId: 'contract-worker',
  leaseToken,
  revision: 8,
});

const conflictClient = new CrawlWorkerClient({
  serverUrl: 'https://worker.example.test',
  workerToken: 'secret-worker-token',
  workerId: 'contract-worker',
  fetchImpl: async () => new Response(JSON.stringify({ error: 'lease_not_owned_or_expired' }), {
    status: 409,
    headers: { 'Content-Type': 'application/json' },
  }),
});
await assert.rejects(
  conflictClient.heartbeat(job, renewed.revision),
  error => isLeaseLostError(error),
  'the local worker must classify a 409 as definitive lease loss',
);

console.log('local crawl worker propagates lease token and the latest heartbeat revision');
