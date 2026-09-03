import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express from 'express';
import type { AtomicCompareResult, DataStore, ListQuery, Record_, Where } from '../storage/datastore.js';
import { store } from '../storage/index.js';
import { crawlWorkerRouter } from './crawlWorker.js';

type Job = Record_ & Record<string, unknown>;

class MemoryStore implements DataStore {
  readonly records = new Map<string, Job>();

  async getById<T = Record_>(_collection: string, id: string): Promise<T | null> {
    return (this.records.get(id) as T | undefined) || null;
  }

  async create<T = Record_>(_collection: string, data: Record<string, unknown>): Promise<T> {
    const id = String(data.id || `job-${this.records.size + 1}`);
    const record = { id, ...data } as Job;
    this.records.set(id, record);
    return record as T;
  }

  async update(_collection: string, id: string, data: Record<string, unknown>): Promise<boolean> {
    const current = this.records.get(id);
    if (!current) return false;
    this.records.set(id, { ...current, ...data });
    return true;
  }

  async delete(_collection: string, id: string): Promise<boolean> {
    return this.records.delete(id);
  }

  async list<T = Record_>(_collection: string, query: ListQuery = {}) {
    const page = query.page || 1;
    const perPage = query.perPage || 20;
    let items = [...this.records.values()];
    if (query.where) {
      items = items.filter(item => Object.entries(query.where || {}).every(([key, value]) => (
        String(item[key] ?? '') === String(value)
      )));
    }
    if (query.sort) {
      const descending = query.sort.startsWith('-');
      const key = descending ? query.sort.slice(1) : query.sort;
      items.sort((left, right) => {
        const leftValue = String(left[key] ?? '');
        const rightValue = String(right[key] ?? '');
        return (descending ? -1 : 1) * leftValue.localeCompare(rightValue);
      });
    }
    const start = (page - 1) * perPage;
    return {
      items: items.slice(start, start + perPage) as T[],
      totalItems: items.length,
      totalPages: Math.ceil(items.length / perPage),
      page,
      perPage,
    };
  }

  async compareAndSet<T = Record_>(
    _collection: string,
    id: string,
    expected: Where,
    data: Record<string, unknown>,
  ): Promise<AtomicCompareResult<T>> {
    const current = this.records.get(id);
    if (!current) return { ok: false as const, reason: 'not_found' as const };
    const matches = Object.entries(expected).every(([key, value]) => String(current[key] ?? '') === String(value));
    if (!matches) return { ok: false, reason: 'conflict', current: current as unknown as T };
    const next = { ...current, ...data } as Job;
    this.records.set(id, next);
    return { ok: true, record: next as unknown as T };
  }

  async createIfAbsent<T = Record_>(_collection: string, uniqueWhere: Where, data: Record<string, unknown>) {
    const existing = [...this.records.values()].find(item => Object.entries(uniqueWhere).every(([key, value]) => (
      String(item[key] ?? '') === String(value)
    )));
    if (existing) return { created: false, record: existing as T };
    return { created: true, record: await this.create<T>('', { ...data, ...uniqueWhere }) };
  }
}

function job(id: string, patch: Record<string, unknown> = {}): Job {
  const createdAt = String(patch.createdAt || '2026-09-02T00:00:00.000Z');
  return {
    id,
    tenantId: 'tenant-crawl-test',
    requestedBy: '',
    platform: 'youtube',
    mode: 'keyword',
    keyword: 'sensor',
    accountUrl: '',
    accountName: '',
    limit: 1,
    status: 'queued',
    workerId: '',
    attempts: 0,
    resultJson: '',
    error: '',
    createdAt,
    updatedAt: createdAt,
    leasedUntil: '',
    finishedAt: '',
    leaseToken: '',
    revision: 0,
    ...patch,
  };
}

const memory = new MemoryStore();
const originalStore = {
  getById: store.getById,
  create: store.create,
  update: store.update,
  delete: store.delete,
  list: store.list,
  compareAndSet: store.compareAndSet,
  createIfAbsent: store.createIfAbsent,
};
Object.assign(store, {
  getById: memory.getById.bind(memory),
  create: memory.create.bind(memory),
  update: memory.update.bind(memory),
  delete: memory.delete.bind(memory),
  list: memory.list.bind(memory),
  compareAndSet: memory.compareAndSet.bind(memory),
  createIfAbsent: memory.createIfAbsent.bind(memory),
});

const previousToken = process.env.CRAWL_WORKER_TOKEN;
process.env.CRAWL_WORKER_TOKEN = 'crawl-route-test-token';
const app = express();
app.use(express.json());
app.use('/api/overseas/crawl-worker', crawlWorkerRouter);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>((resolve, reject) => {
  server.once('listening', resolve);
  server.once('error', reject);
});
const port = (server.address() as AddressInfo).port;
const baseUrl = `http://127.0.0.1:${port}/api/overseas/crawl-worker`;

async function call(pathName: string, workerId: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'x-crawl-worker-token': 'crawl-route-test-token',
      'x-crawl-worker-id': workerId,
      ...(init.headers || {}),
    },
  });
  return { response, body: await response.json() as Record<string, any> };
}

try {
  memory.records.set('concurrent', job('concurrent'));
  const concurrent = await Promise.all([
    call('/next?workerId=worker-a', 'worker-a'),
    call('/next?workerId=worker-b', 'worker-b'),
  ]);
  const winners = concurrent.filter(item => item.body.job);
  assert.equal(winners.length, 1, 'two concurrent pollers must have exactly one lease winner');
  assert.equal(concurrent.filter(item => item.body.job === null).length, 1);
  const leased = winners[0].body.job;
  assert.match(leased.leaseToken, /^[0-9a-f-]{36}$/i);
  assert.equal(leased.revision, 1);

  const heartbeat = await call(`/jobs/${leased.id}/heartbeat`, leased.workerId, {
    method: 'POST',
    body: JSON.stringify({ workerId: leased.workerId, leaseToken: leased.leaseToken, revision: leased.revision }),
  });
  assert.equal(heartbeat.response.status, 200);
  assert.equal(heartbeat.body.revision, 2, 'heartbeat must advance the fencing revision');

  const staleRevision = await call(`/jobs/${leased.id}/complete`, leased.workerId, {
    method: 'POST',
    body: JSON.stringify({ workerId: leased.workerId, leaseToken: leased.leaseToken, revision: 1, ok: true, result: {} }),
  });
  assert.equal(staleRevision.response.status, 409, 'pre-heartbeat revision must not complete the job');

  const completion = await call(`/jobs/${leased.id}/complete`, leased.workerId, {
    method: 'POST',
    body: JSON.stringify({ workerId: leased.workerId, leaseToken: leased.leaseToken, revision: 2, ok: true, result: { imported: 1 } }),
  });
  assert.equal(completion.response.status, 200);
  assert.equal(memory.records.get(leased.id)?.revision, 3);
  assert.equal(memory.records.get(leased.id)?.leaseToken, '');

  memory.records.clear();
  memory.records.set('reclaimed', job('reclaimed'));
  const firstLease = (await call('/next?workerId=old-worker', 'old-worker')).body.job;
  memory.records.set('reclaimed', {
    ...memory.records.get('reclaimed')!,
    leasedUntil: '2000-01-01T00:00:00.000Z',
  });
  const expiredCompletion = await call('/jobs/reclaimed/complete', 'old-worker', {
    method: 'POST',
    body: JSON.stringify({
      workerId: 'old-worker', leaseToken: firstLease.leaseToken, revision: firstLease.revision, ok: true, result: {},
    }),
  });
  assert.equal(expiredCompletion.response.status, 409, 'an expired lease must fail closed');

  const replacementLease = (await call('/next?workerId=new-worker', 'new-worker')).body.job;
  assert.ok(replacementLease);
  assert.notEqual(replacementLease.leaseToken, firstLease.leaseToken);
  assert.equal(replacementLease.revision, firstLease.revision + 1);
  const oldLeaseCompletion = await call('/jobs/reclaimed/complete', 'old-worker', {
    method: 'POST',
    body: JSON.stringify({
      workerId: 'old-worker', leaseToken: firstLease.leaseToken, revision: firstLease.revision, ok: true, result: {},
    }),
  });
  assert.equal(oldLeaseCompletion.response.status, 409, 'an old fencing token must not complete a reclaimed job');

  memory.records.clear();
  for (let index = 0; index < 501; index += 1) {
    memory.records.set(`done-${index}`, job(`done-${index}`, { status: 'done', createdAt: `2025-${String((index % 12) + 1).padStart(2, '0')}-01T00:00:00.000Z` }));
  }
  for (let index = 0; index < 101; index += 1) {
    memory.records.set(`unsupported-${index}`, job(`unsupported-${index}`, {
      platform: 'instagram',
      createdAt: `2026-01-${String((index % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
    }));
  }
  memory.records.set('after-fillers', job('after-fillers', { createdAt: '2026-09-02T01:00:00.000Z' }));
  const afterFillers = (await call('/next?workerId=fair-worker', 'fair-worker')).body.job;
  assert.equal(afterFillers.id, 'after-fillers', '501 terminal and 101 unsupported queued records must not starve a due job');
} finally {
  await new Promise<void>(resolve => server.close(() => resolve()));
  Object.assign(store, originalStore);
  if (previousToken === undefined) delete process.env.CRAWL_WORKER_TOKEN;
  else process.env.CRAWL_WORKER_TOKEN = previousToken;
}

console.log('crawl worker CAS lease, expiry fencing, heartbeat revision, and fair pagination passed');
