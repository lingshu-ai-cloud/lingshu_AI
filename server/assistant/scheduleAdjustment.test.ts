import assert from 'node:assert/strict';
import test from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import type { DataStore, ListQuery, ListResult, Record_ } from '../storage/datastore.js';
import {
  ASSISTANT_SCHEDULE_CHANGES,
  createScheduleAdjustmentService,
  ScheduleAdjustmentError,
} from './scheduleAdjustment.js';

class MemoryStore implements DataStore {
  rows = new Map<string, Record_[]>();
  failUpdateId = '';
  beforeUpdate?: (collection: string, id: string, data: Record<string, unknown>) => void | Promise<void>;

  seed(collection: string, rows: Record_[]) { this.rows.set(collection, structuredClone(rows)); }

  async getById<T = Record_>(collection: string, id: string): Promise<T | null> {
    return (structuredClone(this.rows.get(collection)?.find(row => row.id === id)) as T | undefined) ?? null;
  }

  async create<T = Record_>(collection: string, data: Record<string, unknown>): Promise<T | null> {
    const requestedId = typeof data.id === 'string' && data.id ? data.id : '';
    if (requestedId && this.rows.get(collection)?.some(row => row.id === requestedId)) return null;
    const row = {
      id: requestedId || `record${String((this.rows.get(collection)?.length ?? 0) + 1).padStart(9, '0')}`,
      ...structuredClone(data),
    } as Record_;
    this.rows.set(collection, [...(this.rows.get(collection) ?? []), row]);
    return structuredClone(row) as T;
  }

  async update(collection: string, id: string, data: Record<string, unknown>): Promise<boolean> {
    await this.beforeUpdate?.(collection, id, data);
    if (id === this.failUpdateId) return false;
    const rows = this.rows.get(collection) ?? [];
    const index = rows.findIndex(row => row.id === id);
    if (index < 0) return false;
    rows[index] = { ...rows[index], ...structuredClone(data) };
    return true;
  }

  async compareAndSwap(
    collection: string,
    id: string,
    expected: Record<string, unknown>,
    data: Record<string, unknown>,
  ): Promise<boolean> {
    await this.beforeUpdate?.(collection, id, data);
    if (id === this.failUpdateId) throw new Error('forced_compare_and_swap_failure');
    const rows = this.rows.get(collection) ?? [];
    const index = rows.findIndex(row => row.id === id);
    if (index < 0) return false;
    if (!Object.entries(expected).every(([key, value]) => isDeepStrictEqual(rows[index]![key], value))) {
      return false;
    }
    rows[index] = { ...rows[index], ...structuredClone(data) };
    return true;
  }

  async delete(collection: string, id: string): Promise<boolean> {
    const before = this.rows.get(collection) ?? [];
    this.rows.set(collection, before.filter(row => row.id !== id));
    return before.length !== (this.rows.get(collection)?.length ?? 0);
  }

  async list<T = Record_>(collection: string, query: ListQuery = {}): Promise<ListResult<T>> {
    let items = (this.rows.get(collection) ?? []).filter(row => Object.entries(query.where ?? {})
      .every(([key, value]) => row[key] === value));
    if (query.sort) {
      const descending = query.sort.startsWith('-');
      const field = descending ? query.sort.slice(1) : query.sort;
      items = [...items].sort((left, right) => String(left[field] ?? '').localeCompare(String(right[field] ?? '')) * (descending ? -1 : 1));
    }
    const perPage = query.perPage ?? 500;
    const page = query.page ?? 1;
    const selected = items.slice((page - 1) * perPage, page * perPage);
    return {
      items: structuredClone(selected) as T[],
      totalItems: items.length,
      totalPages: items.length ? Math.ceil(items.length / perPage) : 0,
      page,
      perPage,
    };
  }
}

const tenantId = 'tenant-schedule';
const userId = 'user-schedule';
const now = () => new Date('2026-10-08T00:00:00.000Z');

function post(id: string, hour: number): Record_ {
  return {
    id,
    tenant_id: tenantId,
    platform: 'tiktok',
    title: `视频 ${id}`,
    published_at: `2026-10-09T${String(hour).padStart(2, '0')}:00:00.000Z`,
    platform_post_id: '',
    updated_at: '2026-10-08T01:00:00.000Z',
    stats: {
      status: 'scheduled',
      coverUrl: `https://cdn.example.com/${id}.jpg`,
      targetAccountIds: ['account-a'],
      targetAccountLabels: ['Aurelia'],
      publishResults: {},
      publishAttempts: 0,
    },
  };
}

test('schedule adjustment prepares from real unpublished posts and confirms with the original wall-clock time', async () => {
  const data = new MemoryStore();
  data.seed('posts', [post('post-a', 2), post('post-b', 3)]); // 10:00 / 11:00 Beijing on Friday.
  data.seed(ASSISTANT_SCHEDULE_CHANGES, []);
  const service = createScheduleAdjustmentService(data, now);

  const prepared = await service.prepare({
    tenantId, userId, requestId: 'schedule-request-001', platform: 'tiktok', sourceWeekday: 5, targetWeekday: 6, count: 2,
  });
  assert.equal(prepared.items.length, 2);
  assert.equal(prepared.items[0]?.accountLabel, 'Aurelia');
  assert.equal(prepared.items[0]?.thumbnailUrl, 'https://cdn.example.com/post-a.jpg');
  assert.equal(prepared.items[0]?.targetScheduledAt, '2026-10-10T02:00:00.000Z');

  const receipt = await service.confirm({
    tenantId, userId, changeId: prepared.id, expectedVersion: prepared.expectedVersion,
  });
  assert.equal(receipt.items.length, 2);
  assert.deepEqual(receipt.items.map(item => item.executionStatus), ['applied', 'applied']);
  assert.equal((await data.getById<any>('posts', 'post-a'))?.published_at, '2026-10-10T02:00:00.000Z');
  assert.equal((await data.getById<any>('posts', 'post-b'))?.published_at, '2026-10-10T03:00:00.000Z');
  assert.equal((await data.getById<any>(ASSISTANT_SCHEDULE_CHANGES, prepared.id))?.status, 'applied');
});

test('schedule adjustment refuses ambiguous candidate sets instead of guessing which videos to move', async () => {
  const data = new MemoryStore();
  data.seed('posts', [post('post-a', 2), post('post-b', 3), post('post-c', 4)]);
  data.seed(ASSISTANT_SCHEDULE_CHANGES, []);
  const service = createScheduleAdjustmentService(data, now);
  await assert.rejects(
    service.prepare({ tenantId, userId, requestId: 'schedule-request-002', platform: 'tiktok', sourceWeekday: 5, targetWeekday: 6, count: 2 }),
    (error: unknown) => error instanceof ScheduleAdjustmentError
      && error.code === 'assistant_schedule_candidates_not_exact'
      && /无法唯一确定/.test(error.publicMessage),
  );
  assert.equal(data.rows.get(ASSISTANT_SCHEDULE_CHANGES)?.length, 0);
});

test('schedule adjustment rechecks every post version before mutation and invalidates a stale card', async () => {
  const data = new MemoryStore();
  data.seed('posts', [post('post-a', 2), post('post-b', 3)]);
  data.seed(ASSISTANT_SCHEDULE_CHANGES, []);
  const service = createScheduleAdjustmentService(data, now);
  const prepared = await service.prepare({
    tenantId, userId, requestId: 'schedule-request-003', platform: 'tiktok', sourceWeekday: 5, targetWeekday: 6, count: 2,
  });
  await data.update('posts', 'post-b', { published_at: '2026-10-16T03:00:00.000Z' });

  await assert.rejects(
    service.confirm({ tenantId, userId, changeId: prepared.id, expectedVersion: prepared.expectedVersion }),
    (error: unknown) => error instanceof ScheduleAdjustmentError && error.status === 409,
  );
  assert.equal((await data.getById<any>('posts', 'post-a'))?.published_at, '2026-10-09T02:00:00.000Z');
  assert.equal((await data.getById<any>(ASSISTANT_SCHEDULE_CHANGES, prepared.id))?.status, 'stale');
});

test('schedule adjustment cannot overwrite a publisher receipt created between validation and mutation', async () => {
  const data = new MemoryStore();
  data.seed('posts', [post('post-a', 2), post('post-b', 3)]);
  data.seed(ASSISTANT_SCHEDULE_CHANGES, []);
  const service = createScheduleAdjustmentService(data, now);
  const prepared = await service.prepare({
    tenantId,
    userId,
    requestId: 'schedule-request-publish-race',
    platform: 'tiktok',
    sourceWeekday: 5,
    targetWeekday: 6,
    count: 2,
  });

  let publisherRan = false;
  data.beforeUpdate = (collection, id, patch) => {
    if (publisherRan || collection !== 'posts' || id !== 'post-a'
      || patch.published_at !== '2026-10-10T02:00:00.000Z') return;
    publisherRan = true;
    const rows = data.rows.get('posts') ?? [];
    const index = rows.findIndex(row => row.id === id);
    const current = rows[index]!;
    rows[index] = {
      ...current,
      platform_post_id: 'remote-post-123',
      stats: {
        ...(current.stats as Record<string, unknown>),
        status: 'published',
        publishResults: {
          accountA: { status: 'published', platformPostId: 'remote-post-123' },
        },
      },
    };
  };

  await assert.rejects(
    service.confirm({ tenantId, userId, changeId: prepared.id, expectedVersion: prepared.expectedVersion }),
    (error: unknown) => error instanceof ScheduleAdjustmentError
      && error.code === 'assistant_schedule_change_stale'
      && error.status === 409,
  );

  const published = await data.getById<any>('posts', 'post-a');
  assert.equal(publisherRan, true);
  assert.equal(published?.published_at, '2026-10-09T02:00:00.000Z');
  assert.equal(published?.platform_post_id, 'remote-post-123');
  assert.equal(published?.stats?.status, 'published');
  assert.equal(published?.stats?.publishResults?.accountA?.status, 'published');
  assert.equal((await data.getById<any>('posts', 'post-b'))?.published_at, '2026-10-09T03:00:00.000Z');
  assert.equal((await data.getById<any>(ASSISTANT_SCHEDULE_CHANGES, prepared.id))?.status, 'stale');
});

test('schedule adjustment rolls back an earlier write when a later post update fails', async () => {
  const data = new MemoryStore();
  data.seed('posts', [post('post-a', 2), post('post-b', 3)]);
  data.seed(ASSISTANT_SCHEDULE_CHANGES, []);
  const service = createScheduleAdjustmentService(data, now);
  const prepared = await service.prepare({
    tenantId, userId, requestId: 'schedule-request-004', platform: 'tiktok', sourceWeekday: 5, targetWeekday: 6, count: 2,
  });
  data.failUpdateId = 'post-b';
  await assert.rejects(
    service.confirm({ tenantId, userId, changeId: prepared.id, expectedVersion: prepared.expectedVersion }),
    (error: unknown) => error instanceof ScheduleAdjustmentError && error.code === 'assistant_schedule_update_failed',
  );
  assert.equal((await data.getById<any>('posts', 'post-a'))?.published_at, '2026-10-09T02:00:00.000Z');
  const rolledBack = await data.getById<any>(ASSISTANT_SCHEDULE_CHANGES, prepared.id);
  assert.equal(rolledBack?.status, 'pending');
  assert.deepEqual(rolledBack?.items.map((item: any) => item.executionStatus), ['rolled_back', 'pending']);
  assert.equal(rolledBack?.items[1]?.executionError, 'post_update_failed');
  assert.equal(data.rows.get(ASSISTANT_SCHEDULE_CHANGES)?.length, 1, 'a fully rolled-back attempt releases its durable claim');
});

test('schedule adjustment grants one durable confirmation claim and treats a concurrent confirm as a conflict', async () => {
  const data = new MemoryStore();
  data.seed('posts', [post('post-a', 2), post('post-b', 3)]);
  data.seed(ASSISTANT_SCHEDULE_CHANGES, []);
  const service = createScheduleAdjustmentService(data, now);
  const prepared = await service.prepare({
    tenantId, userId, requestId: 'schedule-request-concurrent-success', platform: 'tiktok', sourceWeekday: 5, targetWeekday: 6, count: 2,
  });

  let markEntered!: () => void;
  const entered = new Promise<void>(resolve => { markEntered = resolve; });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let blocked = false;
  data.beforeUpdate = async (collection, id, patch) => {
    if (!blocked && collection === 'posts' && id === 'post-a'
      && patch.published_at === '2026-10-10T02:00:00.000Z') {
      blocked = true;
      markEntered();
      await gate;
    }
  };

  const winner = service.confirm({
    tenantId, userId, changeId: prepared.id, expectedVersion: prepared.expectedVersion,
  });
  await entered;
  await assert.rejects(
    service.confirm({ tenantId, userId, changeId: prepared.id, expectedVersion: prepared.expectedVersion }),
    (error: unknown) => error instanceof ScheduleAdjustmentError
      && error.code === 'assistant_schedule_change_in_progress'
      && error.status === 409,
  );
  release();
  await winner;

  assert.equal((await data.getById<any>('posts', 'post-a'))?.published_at, '2026-10-10T02:00:00.000Z');
  assert.equal((await data.getById<any>('posts', 'post-b'))?.published_at, '2026-10-10T03:00:00.000Z');
  const change = await data.getById<any>(ASSISTANT_SCHEDULE_CHANGES, prepared.id);
  assert.equal(change?.status, 'applied');
  assert.deepEqual(change?.items.map((item: any) => item.executionStatus), ['applied', 'applied']);

  const replay = await service.confirm({
    tenantId, userId, changeId: prepared.id, expectedVersion: prepared.expectedVersion,
  });
  assert.equal(replay.id, prepared.id);
});

test('a concurrent confirm cannot succeed while the claim owner fails and rolls back; a later retry can claim again', async () => {
  const data = new MemoryStore();
  data.seed('posts', [post('post-a', 2), post('post-b', 3)]);
  data.seed(ASSISTANT_SCHEDULE_CHANGES, []);
  const service = createScheduleAdjustmentService(data, now);
  const prepared = await service.prepare({
    tenantId, userId, requestId: 'schedule-request-concurrent-failure', platform: 'tiktok', sourceWeekday: 5, targetWeekday: 6, count: 2,
  });

  let markEntered!: () => void;
  const entered = new Promise<void>(resolve => { markEntered = resolve; });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let blocked = false;
  data.beforeUpdate = async (collection, id, patch) => {
    if (!blocked && collection === 'posts' && id === 'post-a'
      && patch.published_at === '2026-10-10T02:00:00.000Z') {
      blocked = true;
      markEntered();
      await gate;
    }
  };
  data.failUpdateId = 'post-b';

  const owner = service.confirm({
    tenantId, userId, changeId: prepared.id, expectedVersion: prepared.expectedVersion,
  });
  await entered;
  const contender = service.confirm({
    tenantId, userId, changeId: prepared.id, expectedVersion: prepared.expectedVersion,
  });
  await assert.rejects(
    contender,
    (error: unknown) => error instanceof ScheduleAdjustmentError
      && error.code === 'assistant_schedule_change_in_progress',
  );
  release();
  await assert.rejects(
    owner,
    (error: unknown) => error instanceof ScheduleAdjustmentError
      && error.code === 'assistant_schedule_update_failed',
  );

  assert.equal((await data.getById<any>('posts', 'post-a'))?.published_at, '2026-10-09T02:00:00.000Z');
  assert.equal((await data.getById<any>('posts', 'post-b'))?.published_at, '2026-10-09T03:00:00.000Z');
  assert.equal((await data.getById<any>(ASSISTANT_SCHEDULE_CHANGES, prepared.id))?.status, 'pending');
  assert.equal(data.rows.get(ASSISTANT_SCHEDULE_CHANGES)?.length, 1, 'the failed owner released the claim only after rollback receipt persisted');

  data.failUpdateId = '';
  data.beforeUpdate = undefined;
  await service.confirm({
    tenantId, userId, changeId: prepared.id, expectedVersion: prepared.expectedVersion,
  });
  assert.equal((await data.getById<any>(ASSISTANT_SCHEDULE_CHANGES, prepared.id))?.status, 'applied');
});
