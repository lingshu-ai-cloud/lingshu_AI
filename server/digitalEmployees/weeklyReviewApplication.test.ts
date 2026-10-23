import assert from 'node:assert/strict';
import test from 'node:test';
import type { DataStore, ListQuery, Record_ } from '../storage/datastore.js';
import { DIGITAL_EMPLOYEE_COLLECTION as C, type EventRecord } from '../routes/digitalEmployeeRecords.js';
import type { BusinessSnapshot } from './businessSnapshot.js';
import type { ReviewTodoBoard } from '../../src/lib/reviewTodos.js';
import { createWeeklyReviewApplication, type WeeklyReviewDependencies } from './weeklyReviewApplication.js';

function fixture() {
  let sequence = 0;
  let rejectReviewWrite = false;
  const tables = new Map<string, Record_[]>([
    [C.goals, [{ id: 'goal', tenant_id: 'a', title: 'Week', objective: 'Learn', metric: 'leads', baseline: 0, target: 1, unit: 'lead', starts_at: '2026-10-19', ends_at: '2026-10-25', scope: '', constraints: [], status: 'active' }]],
    [C.runs, [{ id: 'run', tenant_id: 'a', goal_id: 'goal', plan_id: 'plan', status: 'running' }]],
    [C.plans, [{ id: 'plan', tenant_id: 'a', goal_id: 'goal', status: 'approved', plan: {} }]],
    [C.tasks, [{ id: 'task', tenant_id: 'a', goal_id: 'goal', run_id: 'run', task_key: 'prepare', title: 'Prepare', status: 'pending', sequence: 1, depends_on: [], output: {} }]],
  ]);
  const rows = (collection: string) => tables.get(collection) || [];
  const writes: string[] = [];
  const snapshots: string[] = [];
  const audits: string[] = [];
  const activations: string[] = [];
  const store: DataStore = {
    async getById<T>(collection: string, id: string) { return structuredClone(rows(collection).find(row => row.id === id) || null) as T | null; },
    async list<T>(collection: string, query: ListQuery = {}) {
      let items = rows(collection).filter(row => Object.entries(query.where || {}).every(([key, value]) => row[key] === value));
      if (query.sort) {
        const key = query.sort.replace(/^-/, '');
        const direction = query.sort.startsWith('-') ? -1 : 1;
        items = [...items].sort((a, b) => String(a[key] || '').localeCompare(String(b[key] || '')) * direction);
      }
      return { items: structuredClone(items) as T[], totalItems: items.length, totalPages: 1, page: 1, perPage: query.perPage || 100 };
    },
    async create<T>(collection: string, data: Record<string, unknown>) {
      if (collection === C.reviews && rejectReviewWrite) return null;
      const row = { id: `row-${++sequence}`, ...structuredClone(data) };
      tables.set(collection, [...rows(collection), row]); writes.push(collection);
      return structuredClone(row) as T;
    },
    async update(collection, id, data) {
      if (collection === C.reviews && rejectReviewWrite) return false;
      const row = rows(collection).find(row => row.id === id);
      if (!row) return false;
      Object.assign(row, structuredClone(data)); writes.push(collection); return true;
    },
    async delete(collection, id) {
      const previous = rows(collection); tables.set(collection, previous.filter(row => row.id !== id));
      return rows(collection).length !== previous.length;
    },
  };
  const deps: WeeklyReviewDependencies = {
    store, activationQueues: new Map(),
    async tenantRecord(collection, id, tenantId) { const row = await store.getById(collection, id); return row?.tenant_id === tenantId ? row as never : null; },
    async first(collection, where, sort) { return (await store.list(collection, { where, sort })).items[0] as never || null; },
    async requiredCreate(collection, data) { const row = await store.create(collection, data); if (!row) throw Error(`${collection}_storage_unavailable`); return row as never; },
    async configForTenant() { return null; },
    async resolveCurrentConfiguration() { return null; },
    executionConfigForPlan: (_plan, fallback) => fallback,
    async weeklyGoalFactRebuildTargetCommitted() { return true; },
    async approveGoalForReview(tenantId, _userId, goalId) { activations.push(`${tenantId}:${goalId}`); return { status: 200, body: {} }; },
    async buildBusinessSnapshot(tenantId) { snapshots.push(tenantId); return { generatedAt: '2026-10-23T03:00:00Z', dataGaps: ['No verified business metrics'] } as BusinessSnapshot; },
    async appendEvent(event) {
      return await store.create(C.events, { ...event, tenant_id: event.tenantId, run_id: event.runId, sequence: sequence + 1 }) as unknown as EventRecord;
    },
    async appendAudit(event) { audits.push(event.action); },
  };
  return { application: createWeeklyReviewApplication(deps), rows, tables, writes, snapshots, audits, activations,
    rejectReviewWrites() { rejectReviewWrite = true; } };
}

test('manual review refresh updates one tenant-owned review while leaving the active run active', async () => {
  const f = fixture();
  await f.application.generateRunReview('a', 'user', 'run');
  const first = f.rows(C.reviews)[0]!;
  const initial = first.summary as Record<string, unknown>;
  assert.equal(initial.isLive, true); assert.equal(initial.completionRate, 0);
  assert.deepEqual(initial.dataGaps, ['No verified business metrics']);
  assert.equal(f.rows(C.runs)[0]!.status, 'running');
  f.rows(C.tasks)[0]!.status = 'succeeded';
  await f.application.generateRunReview('a', 'user', 'run');
  assert.equal(f.rows(C.reviews).length, 1);
  assert.equal(f.rows(C.reviews)[0]!.id, first.id);
  assert.equal((f.rows(C.reviews)[0]!.summary as Record<string, unknown>).completionRate, 100);
  assert.deepEqual(f.snapshots, ['a', 'a']);
  assert.deepEqual(f.audits, ['weekly_review.generated', 'weekly_review.generated']);
});

test('review generation never reads a foreign run or emits its success events', async () => {
  const f = fixture();
  await assert.rejects(f.application.generateRunReview('b', 'user', 'run'), /run_not_found/);
  assert.deepEqual(f.writes, []); assert.deepEqual(f.snapshots, []); assert.deepEqual(f.audits, []);
});

test('concurrent scheduled requests generate once per slot and new slots remain eligible', async () => {
  const f = fixture();
  const input = { tenantId: 'a', runId: 'run', scheduleSlot: '2026-10-23T09:30:00Z' };
  const results = await Promise.all([f.application.generateScheduledRunReview(input), f.application.generateScheduledRunReview(input)]);
  assert.deepEqual(results, [true, false]);
  assert.equal(f.rows(C.events).filter(row => row.type === 'review.scheduled').length, 1);
  assert.equal(await f.application.generateScheduledRunReview({ ...input, scheduleSlot: '2026-10-30T09:30:00Z' }), true);
  assert.equal(f.rows(C.reviews).length, 1);
  assert.equal(f.snapshots.length, 2);
});

test('failed review creation or refresh cannot leave a scheduled success marker', async () => {
  const f = fixture(); f.rejectReviewWrites();
  await assert.rejects(f.application.generateScheduledRunReview({ tenantId: 'a', runId: 'run', scheduleSlot: 'slot' }), /weekly_reviews_storage_unavailable/);
  assert.equal(f.rows(C.events).length, 0); assert.equal(f.audits.length, 0);
  const existing = fixture(); await existing.application.generateRunReview('a', 'user', 'run');
  const summary = structuredClone(existing.rows(C.reviews)[0]!.summary);
  existing.rejectReviewWrites();
  await assert.rejects(existing.application.generateScheduledRunReview({ tenantId: 'a', runId: 'run', scheduleSlot: 'slot' }), /weekly_reviews_storage_unavailable/);
  assert.deepEqual(existing.rows(C.reviews)[0]!.summary, summary);
  assert.equal(existing.rows(C.events).filter(row => row.type === 'review.scheduled').length, 0);
});

test('todo allocation rejects a foreign source before configuration reads or activation', async () => {
  const f = fixture();
  await assert.rejects(f.application.allocateReviewTodos('b', 'user', { sourceGoalId: 'goal', week: '2026-10-26', items: [] } as unknown as ReviewTodoBoard), /复盘目标已不可用/);
  assert.deepEqual(f.writes, []); assert.deepEqual(f.activations, []);
});

test('managed continuation releases its lease when the source is inaccessible or not completed', async () => {
  const f = fixture();
  assert.equal(await f.application.continueManagedOperatingCycle('b', 'run'), null);
  assert.equal(await f.application.continueManagedOperatingCycle('a', 'run'), null);
  assert.equal(f.rows('durable_operation_leases').length, 0);
  assert.deepEqual(f.activations, []);
});
