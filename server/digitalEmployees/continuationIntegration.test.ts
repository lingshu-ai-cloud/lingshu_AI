import assert from 'node:assert/strict';
import fs from 'node:fs';
import express from 'express';
import { store, auth } from '../storage/index.js';
import { digitalEmployeesRouter, reconcileDigitalEmployeeRun } from '../routes/digitalEmployees.js';
import { runDigitalEmployeeRuntimeCycle } from './runtimeOrchestrator.js';
import { reopenNoDataCustomerBranch } from './customerReentry.js';
const tenant = 'continuation-integration';
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
const config = { autonomyMode: 'managed', enabledWorkflows: ['customer_segmentation', 'batch_followup'], reviewSchedule: '月底有空时', continuationPolicy: { newCustomers: 'reopen', missedFollowup: 'catch_up', overlappingCycles: 'allow_disjoint' } };
let customers: any[] = [];
let rows: Record<string, any[]> = {};
const original = { list: store.list, getById: store.getById, create: store.create, update: store.update, verifyToken: auth.verifyToken, readFileSync: fs.readFileSync, writeFileSync: fs.writeFileSync, fetch: globalThis.fetch };
let failTask = '', unexpectedNetwork = 0;
store.list = (async (collection: string, query: any = {}) => {
  let filtered = (rows[collection] || []).filter(row => Object.entries(query.where || {}).every(([key, value]) => row[key] === value));
  if (query.sort) { const key = query.sort.replace(/^-/, ''); const sign = query.sort.startsWith('-') ? -1 : 1; filtered = [...filtered].sort((a, b) => String(a[key] || '').localeCompare(String(b[key] || '')) * sign); }
  const perPage = query.perPage || 100, page = query.page || 1;
  return { items: structuredClone(filtered.slice((page - 1) * perPage, page * perPage)), totalItems: filtered.length, totalPages: Math.ceil(filtered.length / perPage), page, perPage };
}) as typeof store.list;
store.getById = (async (collection: string, id: string) => structuredClone((rows[collection] || []).find(row => row.id === id) || null)) as typeof store.getById;
store.create = (async (collection: string, body: any) => { const record = { ...body, id: `test-${collection}-${(rows[collection] || []).length}` }; (rows[collection] ||= []).push(record); return structuredClone(record); }) as typeof store.create;
store.update = (async (collection: string, id: string, patch: any) => { if (collection === 'workflow_tasks' && id === failTask) return false; const record = (rows[collection] || []).find(row => row.id === id); if (!record) return false; Object.assign(record, structuredClone(patch)); return true; }) as typeof store.update;
auth.verifyToken = (async () => ({ userId: 'test-user', tenantId: tenant })) as typeof auth.verifyToken;
fs.readFileSync = ((path: any, ...args: any[]) => {
  if (String(path).includes('/data/') && String(path).endsWith('.json')) return String(path).endsWith('whatsapp-customers.json') ? JSON.stringify(customers) : String(path).endsWith('enterprise.json') ? '{}' : '[]';
  return (original.readFileSync as any)(path, ...args);
}) as typeof fs.readFileSync;
fs.writeFileSync = ((path: any, ...args: any[]) => { if (String(path).includes('/data/')) throw Error('isolated test forbids business filesystem writes'); return (original.writeFileSync as any)(path, ...args); }) as typeof fs.writeFileSync;
globalThis.fetch = (async (url: any, options?: any) => { if (String(url).startsWith('http://127.0.0.1:')) return original.fetch(url, options); unexpectedNetwork++; throw Error('isolated test forbids external network'); }) as typeof fetch;
const app = express(); app.use(express.json(), digitalEmployeesRouter);
const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
const endpoint = `http://127.0.0.1:${(server.address() as any).port}`;
const token = 'local-demo.' + Buffer.from(JSON.stringify({ userId: 'test-user', tenantId: tenant })).toString('base64url');
function setup() {
  customers = [];
  rows = { digital_employee_configs: [{ id: 'cfg', tenant_id: tenant, config }], tenant_profiles: [{ id: 'profile', tenant_id: tenant, profile: { company: { name: 'Test', industry: 'Test' }, products: { items: [] } } }],
    weekly_goals: [{ id: 'goal', tenant_id: tenant, title: 'Current', starts_at: today, ends_at: today, status: 'completed', objective: 'Isolated', metric: 'test', scope: {}, content_platforms: [] }],
    weekly_plans: [{ id: 'plan', tenant_id: tenant, goal_id: 'goal', plan: { configSnapshot: config } }],
    workflow_runs: [{ id: 'run', tenant_id: tenant, goal_id: 'goal', plan_id: 'plan', status: 'succeeded', started_at: '2026-01-01T00:00:00Z' }],
    workflow_tasks: ['customer_segmentation', 'followup_batch_draft', 'followup_batch_approval', 'followup_dispatch', 'weekly_review'].map((key, index) => ({ id: key, task_key: key, tenant_id: tenant, run_id: 'run', title: key, status: 'skipped', output: { dataStatus: 'no_data' }, sequence: index,
      kind: key === 'followup_batch_approval' ? 'approval' : 'execution', execution_mode: key === 'customer_segmentation' ? 'draft_executor' : key === 'followup_batch_approval' ? 'approval' : 'observe', external_effect: 'none', automatic_execution_allowed: true, requires_approval: key === 'followup_batch_approval', depends_on: key === 'customer_segmentation' ? [] : key === 'followup_batch_draft' ? ['test_missing'] : [ ['customer_segmentation', 'followup_batch_draft', 'followup_batch_approval', 'followup_dispatch'][index - 1] ] })),
  };
}
try {
  setup();
  let cycle = await runDigitalEmployeeRuntimeCycle(new Date());
  assert.equal(cycle.reconciled, 1, 'same-cycle completed runs must enter reconciliation');
  assert.equal(rows.workflow_runs[0].status, 'succeeded', 'no new customer preserves completed status');
  customers = [{ id: 'new-customer', tenantId: tenant, name: 'Test customer', waNumber: '12025550127', stage: 'inquiry', intentScore: 80, language: 'en', lastActiveAt: Date.now(), createdAt: new Date().toISOString(), tags: [] }];
  cycle = await runDigitalEmployeeRuntimeCycle(new Date());
  assert.deepEqual(cycle.errors, []);
  assert.equal(rows.run_events.filter(event => event.type === 'customer.no_data_reopened').length, 1);
  assert.ok(rows.customer_segments.some(segment => segment.member_count === 1), 'runtime creates a fresh customer segment from new data');
  assert.equal(rows.workflow_tasks.find(task => task.task_key === 'followup_dispatch').status, 'pending');
  assert.equal((rows.approval_requests || []).length, 0, 'draft dependency prevents premature approval');
  rows.workflow_tasks.find(task => task.task_key === 'followup_batch_draft').status = 'succeeded';
  rows.followup_batches = [{ id: 'batch', tenant_id: tenant, run_id: 'run', status: 'draft', version: 1, content_hash: 'batch-hash' }];
  rows.followup_batch_items = [{ id: 'item', tenant_id: tenant, batch_id: 'batch', status: 'draft', content_hash: 'item-hash', exclusion_reason: '' }];
  await reconcileDigitalEmployeeRun(tenant, 'run');
  assert.equal(rows.workflow_tasks.find(task => task.task_key === 'followup_batch_approval').status, 'waiting_approval');
  assert.equal(rows.approval_requests.filter(item => item.status === 'pending').length, 1, 'new customer branch still requires a new approval');
  assert.equal(rows.followup_batch_items[0].status, 'draft');
  assert.equal(rows.workflow_tasks.find(task => task.task_key === 'followup_dispatch').status, 'pending');

  setup();
  rows.weekly_goals.push({ id: 'old-goal', tenant_id: tenant, starts_at: '2025-01-01', ends_at: '2025-01-07' });
  for (let index = 0; index < 101; index++) rows.workflow_runs.push({ id: `old-${index}`, tenant_id: tenant, goal_id: 'old-goal', plan_id: 'plan', status: 'succeeded', started_at: '2026-02-01T00:00:00Z' });
  cycle = await runDigitalEmployeeRuntimeCycle(new Date());
  assert.equal(cycle.scanned, 1, 'historical completed runs must not fill current-cycle scan budget');
  assert.equal(cycle.reconciled, 1, 'the current completed run beyond first 100 history rows is still scanned');

  setup();
  failTask = 'followup_batch_draft';
  const input = () => ({ tenantId: tenant, run: structuredClone(rows.workflow_runs[0]), tasks: structuredClone(rows.workflow_tasks), startsAt: today, endsAt: today, customerIds: ['new'], onReopened: async (customerIds: string[]) => { (rows.run_events ||= []).push({ id: 'event', tenant_id: tenant, run_id: 'run', type: 'customer.no_data_reopened', payload: { customerIds } }); } });
  await assert.rejects(reopenNoDataCustomerBranch(input()), /storage_failed/);
  assert.equal((rows.run_events || []).length, 0);
  assert.ok(rows.workflow_tasks[0].output.customerReentryPending);
  failTask = '';
  assert.equal(await reopenNoDataCustomerBranch(input()), true, 'restart resumes partially persisted branch even after no_data task was reset');
  assert.equal(rows.workflow_tasks.every(task => task.status === 'pending'), true);
  assert.equal(rows.workflow_tasks[0].output.customerReentryPending, null);
  assert.equal(rows.run_events.length, 1);

  setup();
  rows.workflow_runs = [{ id: 'previous', tenant_id: tenant, goal_id: 'previous-goal', status: 'waiting_external', started_at: '2026-01-01' }];
  rows.weekly_goals[0].status = 'draft';
  rows.weekly_goals.push({ id: 'previous-goal', tenant_id: tenant, starts_at: today, ends_at: today, status: 'active' });
  const approve = () => fetch(endpoint + '/goals/goal/approve', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal((await approve()).status, 409, 'overlapping active cycle must reject activation');
  rows.weekly_goals[1].starts_at = '2025-01-01'; rows.weekly_goals[1].ends_at = '2025-01-07';
  const activated = await approve();
  assert.equal(activated.status, 200, await activated.text());
  assert.equal(rows.workflow_runs.filter(run => run.goal_id === 'goal').length, 1, 'disjoint cycle creates one run while unfinished old cycle remains');
  assert.equal(unexpectedNetwork, 0);
  console.log('Continuation integration passed: runtime completed scanning, new customer segmentation, renewed approval, history pagination, restart recovery, overlapping/disjoint activation');
} finally {
  Object.assign(store, { list: original.list, getById: original.getById, create: original.create, update: original.update }); auth.verifyToken = original.verifyToken;
  fs.readFileSync = original.readFileSync; fs.writeFileSync = original.writeFileSync; globalThis.fetch = original.fetch;
  server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
}
