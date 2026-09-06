import assert from 'node:assert/strict';
import { store } from '../storage/index.js';
import { configureWorkflowFollowupTemplate } from '../routes/digitalEmployees.js';
import { supportedFollowupTemplate } from '../whatsapp/templates.js';

const tenant = 'isolated-template-workflow';
const template = supportedFollowupTemplate({ id: 'fixture-official', name: 'hello', language: 'en_US', status: 'APPROVED', components: [{ type: 'BODY', text: 'Hello {{1}}, your order is ready.' }] })!;
const affectedKeys = ['followup_batch_draft', 'followup_batch_approval', 'followup_dispatch', 'weekly_review'];
const input = { tenantId: tenant, batchId: 'batch', itemId: 'needs-template', templateName: 'hello', language: 'en_US', variables: ['Maya'] };
let records: Record<string, any[]> = {};
let writes = 0;
function reset(status = 'waiting_external') {
  writes = 0;
  records = {
    workflow_runs: [{ id: 'run', tenant_id: tenant, status, pause_reason: 'manual-control', completed_at: 'old-completion' }],
    followup_batches: [{ id: 'batch', tenant_id: tenant, run_id: 'run', status: 'approved', version: 3, approved_version: 3, approval_id: 'approved-old' }],
    followup_batch_items: [
      { id: 'needs-template', tenant_id: tenant, batch_id: 'batch', status: 'blocked', exclusion_reason: 'whatsapp_template_required', draft_body: 'old', draft_version: 1, provider_receipt: {}, provider_message_id: '', sent_at: '' },
      { id: 'already-sent', tenant_id: tenant, batch_id: 'batch', status: 'sent', draft_body: 'Previously sent', provider_message_id: 'real-fixture-receipt', provider_receipt: { messageId: 'real-fixture-receipt' }, sent_at: '2026-09-01T10:00:00Z', approved_at: '2026-09-01T09:00:00Z' },
    ],
    workflow_tasks: [...affectedKeys, 'content_release_approval'].map(task_key => ({ id: task_key, tenant_id: tenant, run_id: 'run', task_key, status: 'succeeded', blocked_reason: 'old reason', output: { old: true }, business_refs: [{ type: 'old', id: 'old' }] })),
    approval_requests: [
      { id: 'pending-followup', tenant_id: tenant, run_id: 'run', task_id: 'followup_batch_approval', status: 'pending' },
      { id: 'approved-old', tenant_id: tenant, run_id: 'run', task_id: 'followup_batch_approval', status: 'approved' },
      { id: 'pending-publish', tenant_id: tenant, run_id: 'run', task_id: 'content_release_approval', status: 'pending' },
    ],
  };
}
const original = { list: store.list, getById: store.getById, update: store.update, create: store.create };
store.list = (async (collection: string, query: any = {}) => {
  let items = (records[collection] || []).filter(item => Object.entries(query.where || {}).every(([key, value]) => item[key] === value));
  if (query.sort) {
    const descending = query.sort.startsWith('-');
    const key = query.sort.replace(/^-/, '');
    items = [...items].sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0) * (descending ? -1 : 1));
  }
  const page = query.page || 1, perPage = query.perPage || 100;
  return { items: structuredClone(items.slice((page - 1) * perPage, page * perPage)), totalItems: items.length, totalPages: Math.ceil(items.length / perPage), page, perPage };
}) as typeof store.list;
store.getById = (async (collection: string, id: string) => structuredClone((records[collection] || []).find(item => item.id === id) || null)) as typeof store.getById;
store.update = (async (collection: string, id: string, patch: any) => {
  const item = (records[collection] || []).find(row => row.id === id);
  if (!item) return false;
  writes += 1; Object.assign(item, structuredClone(patch)); return true;
}) as typeof store.update;
store.create = (async () => { throw Error('configuration must not create or send anything'); }) as typeof store.create;
try {
  reset();
  const sentBefore = structuredClone(records.followup_batch_items[1]);
  const publishBefore = structuredClone(records.workflow_tasks[4]);
  const result = await configureWorkflowFollowupTemplate(input, async () => template);
  assert.equal(result.batch.version, 4);
  assert.equal(result.batch.approved_version, 0);
  assert.equal(result.batch.approval_id, '');
  assert.equal(records.approval_requests[0].status, 'superseded');
  assert.equal(records.approval_requests[1].status, 'approved', 'historical approval decision remains auditable; old batch authorization is revoked separately');
  assert.equal(records.approval_requests[2].status, 'pending', 'template edits must not revoke another branch approval');
  for (const task of records.workflow_tasks.slice(0, 4)) {
    assert.equal(task.status, 'pending', `${task.task_key} must be re-evaluated`);
    assert.equal(task.blocked_reason, '');
    assert.deepEqual(task.output, {});
    assert.deepEqual(task.business_refs, task.task_key === 'followup_batch_draft' ? [{ type: 'followup_batch', id: 'batch' }] : []);
  }
  assert.deepEqual(records.followup_batch_items[1], sentBefore, 'already sent content and receipt stay immutable');
  assert.deepEqual(records.workflow_tasks[4], publishBefore);
  assert.equal(records.workflow_runs[0].status, 'running');

  for (const status of ['paused', 'waiting_human']) {
    reset(status);
    const runBefore = structuredClone(records.workflow_runs[0]);
    await configureWorkflowFollowupTemplate(input, async () => template);
    assert.deepEqual(records.workflow_runs[0], runBefore, 'template configuration does not resume human-controlled runs');
  }
  for (const status of ['cancelled', 'succeeded', 'failed']) {
    reset(status);
    await assert.rejects(configureWorkflowFollowupTemplate(input, async () => template), /run_not_editable/, `${status} terminal run must reject edits`);
    assert.equal(writes, 0, 'rejected terminal run must not mutate any records');
  }
  reset();
  records.followup_batches.push({ ...records.followup_batches[0], id: 'newer-batch', version: 4 });
  await assert.rejects(configureWorkflowFollowupTemplate(input, async () => template), /batch_version_changed/);
  assert.equal(writes, 0);
} finally { Object.assign(store, original); }
console.log('Template workflow integration: reapproval, four-node reset, sent receipt preservation and run lifecycle passed');
