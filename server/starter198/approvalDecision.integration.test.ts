import assert from 'node:assert/strict';
import '../routes/digitalEmployees.js';
import { store } from '../storage/index.js';
import { createStarter198ApprovalDecisionPort } from './approvalDecision.js';

const tenantId = 'starter-approval-integration';
const rows: Record<string, Array<Record<string, any>>> = {
  approval_requests: [{
    id: 'approval-1', tenant_id: tenantId, run_id: 'run-1', task_id: 'task-1',
    status: 'pending', subject_version: 4, content_hash: 'frozen-commercial-hash',
    created_at: '2026-09-12T07:00:00.000Z',
  }],
  workflow_tasks: [{
    id: 'task-1', tenant_id: tenantId, run_id: 'run-1', task_key: 'commercial_commitment_approval',
    status: 'waiting_approval', task_version: 4,
  }],
  workflow_runs: [{ id: 'run-1', tenant_id: tenantId, goal_id: 'goal-1', status: 'waiting_approval' }],
  weekly_goals: [{ id: 'goal-1', tenant_id: tenantId, status: 'active' }],
};

const original = { ...store };
let serial = 0;
Object.assign(store, {
  async getById(collection: string, id: string) {
    return structuredClone(rows[collection]?.find(row => row.id === id) ?? null);
  },
  async list(collection: string, query: any = {}) {
    let items = (rows[collection] ?? []).filter(row => Object.entries(query.where ?? {})
      .every(([key, value]) => row[key] === value));
    if (query.sort) {
      const descending = query.sort.startsWith('-');
      const key = query.sort.replace(/^-/, '');
      items = [...items].sort((left, right) => {
        const compared = left[key] > right[key] ? 1 : left[key] < right[key] ? -1 : 0;
        return descending ? -compared : compared;
      });
    }
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 100;
    return {
      items: structuredClone(items.slice((page - 1) * perPage, page * perPage)),
      totalItems: items.length,
      totalPages: Math.ceil(items.length / perPage),
      page,
      perPage,
    };
  },
  async create(collection: string, data: Record<string, unknown>) {
    const row = { id: `${collection}-${++serial}`, ...structuredClone(data) };
    (rows[collection] ||= []).push(row);
    return structuredClone(row);
  },
  async update(collection: string, id: string, patch: Record<string, unknown>) {
    const row = rows[collection]?.find(item => item.id === id);
    if (!row) return false;
    Object.assign(row, structuredClone(patch));
    return true;
  },
  async delete() { return false; },
});

try {
  await createStarter198ApprovalDecisionPort().decide({
    tenantId,
    userId: 'starter-owner',
    approvalId: 'approval-1',
    expectedSubjectVersion: '4',
    decision: 'rejected',
    note: '请调整承诺范围',
  });

  assert.equal(rows.approval_requests[0].status, 'rejected');
  assert.equal(rows.approval_requests[0].decided_by, 'starter-owner');
  assert.equal(rows.workflow_tasks[0].status, 'failed');
  assert.equal(rows.workflow_runs[0].status, 'waiting_external');
  assert.equal(rows.weekly_goals[0].status, 'active');
  assert.deepEqual(rows.audit_logs.map(row => row.action), ['approval.decided']);
  assert.deepEqual(rows.run_events.map(row => [row.type, row.level]), [['approval.decided', 'error']]);
} finally {
  Object.assign(store, original);
}

console.log('Starter 198 default approval port uses the registered production application and persists decision, downstream state, audit and event');
