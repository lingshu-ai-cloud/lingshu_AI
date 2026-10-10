import assert from 'node:assert/strict';
import express from 'express';
import { crawlVideosForTenant } from './videos.js';
import { store } from '../storage/index.js';
import { crawlWorkerRouter, runCloudFallbackJob } from './crawlWorker.js';
import { scheduledExecutionState, scheduledCrawlBatchResult } from './scheduler.js';

const original = { list: store.list, getById: store.getById, update: store.update };
let record: any;
const reset = () => record = {
  id: 'fixture', tenantId: 'fixture', requestedBy: 'fixture', platform: 'youtube',
  mode: 'keyword', keyword: 'fixture', status: 'queued', attempts: 0,
  dateFrom: '2026-09-01', dateTo: '2026-09-06',
};
store.getById = (async () => structuredClone(record)) as typeof store.getById;
store.update = (async (_collection: string, _id: string, patch: any) => {
  Object.assign(record, patch); return true;
}) as typeof store.update;
const result = { platform: 'youtube' as const, keyword: 'fixture', imported: 0,
  refreshed: 0, skipped: 1, skippedExisting: 1, returnedExisting: 0,
  requested: 1, total: 1, source: 'fixture', message: '已采集，分析排队', items: [],
  candidateIds: ['real-existing-record'], outcome: 'collected' as const, analysisPending: true };
const app = express();
app.use(express.json(), crawlWorkerRouter);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const port = (server.address() as { port: number }).port;
try {
  reset();
  await assert.rejects(crawlVideosForTenant({ tenantId: 'fixture', platform: 'unsupported' as any }), /adapter pending/, 'crawler must propagate adapter errors rather than return successful empty results');
  const mixed = scheduledCrawlBatchResult([
    { status: 'done', keyword: 'youtube', resultJson: JSON.stringify(result) },
    { status: 'failed', keyword: 'facebook', error: 'Monthly usage hard limit exceeded' },
    { status: 'failed', keyword: 'instagram', error: 'login required' },
  ], 'fixture');
  assert.equal(scheduledExecutionState(mixed), 'partial');
  assert.match(mixed, /Monthly usage hard limit exceeded/);
  assert.match(mixed, /login required/);
  assert.equal(scheduledExecutionState(scheduledCrawlBatchResult([{ status: 'done', resultJson: JSON.stringify({outcome: 'no_data'}) }], 'fixture')), 'no_data');
  reset();
  await runCloudFallbackJob(record, async input => {
    assert.equal(input.deferAnalysis, true);
    assert.equal(input.disableBackfill, true);
    assert.equal(input.dateFrom, '2026-09-01');
    return result;
  });
  assert.equal(record.status, 'done');
  assert.equal(record.attempts, 1);
  assert.equal(record.leasedUntil, '');
  assert.deepEqual(JSON.parse(record.resultJson).candidateIds, ['real-existing-record']);
  assert.equal(JSON.parse(record.resultJson).analysisPending, true);

  reset();
  await runCloudFallbackJob(record, async () => { throw Error('SSL connection failed'); });
  assert.equal(record.status, 'failed', 'transport failures must never become successful zero-result jobs');
  assert.match(record.error, /SSL/);

  reset();
  await runCloudFallbackJob(record, async () => ({ ...result, outcome: 'no_data', candidateIds: [], total: 0, analysisPending: false }));
  assert.equal(JSON.parse(record.resultJson).outcome, 'no_data');

  reset();
  await runCloudFallbackJob(record, async () => {
    record.attempts += 1; record.workerId = 'replacement';
    return result;
  });
  assert.equal(record.status, 'running', 'a stale completion cannot overwrite the replacement worker');
  assert.equal(record.workerId, 'replacement');

  record.leasedUntil = new Date(Date.now() + 60_000).toISOString();
  const headers = { 'Content-Type': 'application/json',
    'x-crawl-worker-token': process.env.CRAWL_WORKER_TOKEN || 'lingshu-local-crawl-worker-token',
    'x-crawl-worker-id': 'replacement' };
  for (const endpoint of ['heartbeat', 'complete']) {
    const response = await fetch(`http://127.0.0.1:${port}/jobs/fixture/${endpoint}`, {
      method: 'POST', headers, body: JSON.stringify({ attempts: record.attempts - 1, ok: true, result }),
    });
    assert.equal(response.status, 409, 'old lease cannot renew or finish a new attempt');
  }
  const completed = await fetch(`http://127.0.0.1:${port}/jobs/fixture/complete`, {
    method: 'POST', headers, body: JSON.stringify({ attempts: record.attempts, ok: true, result }),
  });
  assert.equal(completed.status, 200);
  assert.equal(record.status, 'done');
  reset();
  let queue = Array.from({length: 200}, (_, index) => ({...record, id: `old-${index}`, status: 'done'}));
  queue.push(record);
  let pages = 0;
  store.list = (async (_collection: string, query: any) => {
    pages += 1;
    const page = query.page || 1;
    return { items: structuredClone(queue.slice((page - 1) * 100, page * 100)), page, perPage: 100, totalItems: queue.length, totalPages: Math.ceil(queue.length / 100) };
  }) as typeof store.list;
  const claimed = await fetch(`http://127.0.0.1:${port}/next?workerId=replacement`, { headers });
  assert.equal((await claimed.json() as any).job.id, 'fixture', 'finished history cannot hide queued jobs beyond page one');
  assert.equal(pages, 3);
  record.status = 'running'; record.attempts = 3; record.leasedUntil = new Date(0).toISOString();
  queue = [record];
  const exhausted = await fetch(`http://127.0.0.1:${port}/next?workerId=replacement`, { headers });
  assert.equal((await exhausted.json() as any).job, null);
  assert.equal(record.status, 'failed', 'exhausted expired leases terminate instead of retrying forever');
  assert.equal(scheduledExecutionState('执行状态：暂无结果'), 'no_data');
  assert.equal(scheduledExecutionState('执行状态：已采集，待分析'), 'collected');
  assert.equal(scheduledExecutionState('执行状态：执行失败\n明细：已完成 0 条'), 'failed');
  assert.equal(scheduledExecutionState('执行状态：执行成功\n新增 0 条\n公开采集未找到可入库的真实视频：YouTube search failed SSL'), 'failed');
  console.log('Crawl results, deferred analysis, error propagation, and lease fencing passed');
} finally {
  Object.assign(store, original);
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
}
