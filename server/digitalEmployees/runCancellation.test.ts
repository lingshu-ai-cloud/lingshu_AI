import assert from 'node:assert/strict';
import type { DataStore, ListQuery } from '../storage/datastore.js';
import { cancelDigitalEmployeeRun } from './runCancellation.js';

type Row = { id: string } & Record<string, unknown>;
const rows = new Map<string, Row[]>(Object.entries({
  workflow_runs: [{ id: 'run-1', tenant_id: 'tenant-a', goal_id: 'goal-1', status: 'waiting_human' }],
  weekly_goals: [{ id: 'goal-1', tenant_id: 'tenant-a', status: 'active' }],
  workflow_tasks: [{ id: 'task-1', tenant_id: 'tenant-a', run_id: 'run-1', status: 'pending' }],
  approval_requests: [],
  scheduled_tasks: [
    { id: 'schedule-owned', task_id: 'task-schedule-owned', tenant_id: 'tenant-a', enabled: true, config: { workflowRunId: 'run-1', managedBy: 'digital_employee' } },
    { id: 'schedule-other', tenant_id: 'tenant-a', enabled: true, config: { workflowRunId: 'run-2', managedBy: 'digital_employee' } },
  ],
  studio_projects: [
    { id: 'draft-owned', tenant_id: 'tenant-a', workflow_run_id: 'run-1', status: 'draft', spec: { automation: { managedBy: 'digital_employee', status: 'blocked' } } },
    { id: 'draft-other', tenant_id: 'tenant-a', workflow_run_id: 'run-2', status: 'draft', spec: { automation: { managedBy: 'digital_employee', status: 'blocked' } } },
  ],
  run_events: [],
  audit_logs: [],
}).map(([key, value]) => [key, structuredClone(value)]));

const dataStore: DataStore = {
  async getById<T>(collection: string, id: string) { return (rows.get(collection)?.find(row => row.id === id) ?? null) as T | null; },
  async list<T>(collection: string, query: ListQuery = {}) {
    const selected = (rows.get(collection) ?? []).filter(row => Object.entries(query.where ?? {}).every(([key, value]) => row[key] === value));
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 20;
    const sorted = query.sort === '-sequence' ? [...selected].sort((a: Row, b: Row) => Number(b.sequence) - Number(a.sequence)) : selected;
    return { items: sorted.slice((page - 1) * perPage, page * perPage) as T[], totalItems: selected.length, totalPages: Math.ceil(selected.length / perPage), page, perPage };
  },
  async update(collection, id, patch) {
    const row = rows.get(collection)?.find(item => item.id === id);
    if (!row) return false;
    Object.assign(row, patch);
    return true;
  },
  async create<T>(collection: string, data: Record<string, unknown>) {
    const row = { id: `${collection}-${(rows.get(collection)?.length ?? 0) + 1}`, ...data };
    rows.set(collection, [...(rows.get(collection) ?? []), row]);
    return row as T;
  },
  async delete() { return false; },
};

const stopped: string[] = [];
const result = await cancelDigitalEmployeeRun({ tenantId: 'tenant-a', userId: 'user-a', runId: 'run-1', dataStore, stopScheduledTasks: ids => stopped.push(...ids) });
assert.equal(result.alreadyCancelled, false);
assert.equal(rows.get('workflow_runs')![0]!.status, 'cancelled');
assert.equal(rows.get('scheduled_tasks')![0]!.enabled, false);
assert.equal(rows.get('scheduled_tasks')![1]!.enabled, true);
assert.deepEqual(stopped, ['task-schedule-owned']);
assert.equal((rows.get('studio_projects')![0]!.spec as any).automation.status, 'cancelled');
assert.equal((rows.get('studio_projects')![1]!.spec as any).automation.status, 'blocked');
assert.deepEqual(rows.get('run_events')![0]!.payload, { disabledSchedules: 1, cancelledDrafts: 1 });
assert.equal((await cancelDigitalEmployeeRun({ tenantId: 'tenant-a', userId: 'user-a', runId: 'run-1', dataStore })).alreadyCancelled, true);
assert.equal(rows.get('run_events')!.length, 1);
console.log('run cancellation resource cleanup passed');
