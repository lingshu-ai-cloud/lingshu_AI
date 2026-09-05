import assert from 'node:assert/strict';
import fs from 'node:fs';
import { store } from '../storage/index.js';
import {
  applyFollowupBatchDecision,
  customerHasOptedOut,
  followupRunHasExternalReceipt,
  getCustomerSegment,
  getFollowupBatch,
  normalizeCustomerSegmentCriteria,
  type CustomerSegmentRecord,
  type FollowupBatchItemRecord,
  type FollowupBatchRecord,
} from './customerWorkflow.js';

const source = fs.readFileSync('server/digitalEmployees/customerWorkflow.ts', 'utf8');

assert.match(source, /segments:\s*'customer_segments'/, 'customer segmentation must use the canonical segment collection');
assert.match(source, /members:\s*'customer_segment_members'/, 'segment membership must be persisted per customer');
assert.match(source, /batches:\s*'followup_batches'/, 'follow-up batches must use their canonical collection');
assert.match(source, /items:\s*'followup_batch_items'/, 'follow-up delivery state must be persisted per customer');
assert.doesNotMatch(source, /['"]outreach_(?:batches|recipients)['"]/, 'outreach aliases must not create a second source of truth');
assert.match(source, /outside24h[\s\S]*?whatsapp_template_required/, 'outside the WhatsApp 24-hour window must require a template');
assert.match(source, /approvedTemplateRequiredOutsideWindow:\s*true/, 'batch policy must explicitly require an approved template outside the window');
assert.match(source, /commercialCommitmentsAllowed:\s*false/, 'batch drafts must never authorize commercial commitments');
assert.match(source, /idempotency_key:\s*hash\(/, 'each customer send candidate must have a deterministic idempotency key');
assert.match(source, /bulkWorkerStatus:\s*followupWorkerMode\(\)/, 'batch persistence must record whether the worker is scheduled or manual-only');
assert.equal(customerHasOptedOut({ tags: ['qa_e2e_isolated'] }), false, 'an isolated QA marker must never be treated as an opt-out');
assert.equal(customerHasOptedOut({ tags: ['do not contact'] }), true, 'an explicit do-not-contact marker must remain blocked');

assert.deepEqual(
  normalizeCustomerSegmentCriteria({
    match: 'any',
    stages: ['quoted', 'quoted', 'won'],
    excludeStages: ['won'],
    minIntentScore: -10,
    maxIntentScore: 200,
    includeCustomerIds: ['customer-a', 'customer-a'],
  }),
  {
    match: 'any',
    stages: ['quoted', 'won'],
    excludeStages: ['won'],
    handlingModes: [],
    bantLevels: [],
    minIntentScore: 0,
    maxIntentScore: 100,
    sources: [],
    tags: [],
    includeCustomerIds: ['customer-a'],
    excludeCustomerIds: [],
  },
  'segment criteria must be normalized, bounded, and deduplicated before snapshotting',
);

const originalGetById = store.getById;
const originalList = store.list;
const originalUpdate = store.update;

const tenantId = 'tenant-a';
const batch: FollowupBatchRecord = {
  id: 'batch-1', tenant_id: tenantId, goal_id: 'goal-1', run_id: 'run-1', task_id: 'task-1', segment_id: 'segment-1',
  name: 'September follow-up', status: 'draft', version: 3, approval_id: '', approved_version: 0,
  content_hash: 'batch-content-hash', delivery_policy: {}, safety_summary: {}, counts: {}, created_by: 'user-1',
  approved_by: '', created_at: '2026-09-03T00:00:00.000Z', updated_at: '2026-09-03T00:00:00.000Z', approved_at: '',
};
const segment: CustomerSegmentRecord = {
  id: 'segment-1', tenant_id: tenantId, goal_id: 'goal-1', run_id: 'run-1', task_id: 'segment-task-1', name: 'Qualified',
  status: 'generated', version: 1, criteria: {}, criteria_hash: 'criteria-hash', member_count: 2, excluded_count: 0,
  exclusion_summary: {}, snapshot_at: '2026-09-03T00:00:00.000Z', created_by: 'user-1',
  created_at: '2026-09-03T00:00:00.000Z', updated_at: '2026-09-03T00:00:00.000Z',
};
const items: FollowupBatchItemRecord[] = [
  {
    id: 'item-safe', tenant_id: tenantId, batch_id: batch.id, segment_member_id: 'member-a', customer_id: 'customer-a', customer_name: 'A',
    wa_number: '8613800000000', language: 'zh', time_zone: 'Asia/Shanghai', last_inbound_at: '2026-09-03T00:00:00.000Z',
    outside_24h: false, send_mode: 'session_message', template_name: '', template_status: 'not_required', draft_body: '您好，想跟进需求。',
    draft_version: 1, content_hash: 'item-hash-a', status: 'draft', risk_level: 'low', guard_rule: '', exclusion_reason: '',
    scheduled_at: '2026-09-03T02:00:00.000Z', idempotency_key: 'idem-a', provider_message_id: '', provider_receipt: {}, attempts: 0,
    last_error: '', approved_at: '', sent_at: '', delivered_at: '', created_at: '2026-09-03T00:00:00.000Z', updated_at: '2026-09-03T00:00:00.000Z',
  },
  {
    id: 'item-blocked', tenant_id: tenantId, batch_id: batch.id, segment_member_id: 'member-b', customer_id: 'customer-b', customer_name: 'B',
    wa_number: '12025550199', language: 'en', time_zone: 'America/New_York', last_inbound_at: '', outside_24h: true,
    send_mode: 'template_required', template_name: '', template_status: 'not_configured', draft_body: 'Following up.', draft_version: 1,
    content_hash: 'item-hash-b', status: 'blocked', risk_level: 'high', guard_rule: '', exclusion_reason: 'whatsapp_template_required',
    scheduled_at: '2026-09-03T13:00:00.000Z', idempotency_key: 'idem-b', provider_message_id: '', provider_receipt: {}, attempts: 0,
    last_error: '', approved_at: '', sent_at: '', delivered_at: '', created_at: '2026-09-03T00:00:00.000Z', updated_at: '2026-09-03T00:00:00.000Z',
  },
];

const updates: Array<{ collection: string; id: string; data: Record<string, unknown> }> = [];

(store as unknown as { getById: typeof store.getById }).getById = (async (collection: string, id: string) => {
  if (collection === 'customer_segments' && id === segment.id) return segment;
  if (collection === 'followup_batches' && id === batch.id) return batch;
  return null;
}) as typeof store.getById;

(store as unknown as { list: typeof store.list }).list = (async (collection: string) => {
  const records = collection === 'followup_batches' ? [batch]
    : collection === 'followup_batch_items' ? items
      : [];
  return { items: records, totalItems: records.length, totalPages: records.length ? 1 : 0, page: 1, perPage: 1000 };
}) as typeof store.list;

(store as unknown as { update: typeof store.update }).update = (async (collection: string, id: string, data: Record<string, unknown>) => {
  updates.push({ collection, id, data });
  return true;
}) as typeof store.update;

try {
  assert.equal((await getCustomerSegment(tenantId, segment.id))?.id, segment.id);
  assert.equal(await getCustomerSegment('tenant-b', segment.id), null, 'segments must not cross tenant boundaries');
  assert.equal((await getFollowupBatch(tenantId, batch.id))?.id, batch.id);
  assert.equal(await getFollowupBatch('tenant-b', batch.id), null, 'batches must not cross tenant boundaries');

  const approved = await applyFollowupBatchDecision({ tenantId, batchId: batch.id, decision: 'approved', userId: 'approver-1', approvalId: 'approval-1' });
  assert.equal(approved.items.find(item => item.id === 'item-safe')?.status, 'approved');
  assert.equal(approved.items.find(item => item.id === 'item-blocked')?.status, 'blocked', 'batch approval must not override a blocked customer');
  assert.equal(approved.batch.approved_version, 3, 'approval must bind to the reviewed batch version');
  assert.equal(approved.batch.approval_id, 'approval-1');
  assert.equal(approved.batch.content_hash, 'batch-content-hash', 'approval must retain the reviewed content hash');
  assert.ok(!updates.some(update => ['sent', 'delivered'].includes(String(update.data.status))), 'approval must never be recorded as delivery');
  assert.ok(!updates.some(update => 'provider_message_id' in update.data || 'provider_receipt' in update.data), 'approval must not invent provider receipts');

  assert.equal(await followupRunHasExternalReceipt(tenantId, batch.run_id), false, 'an approved batch without a provider receipt is not sent');
  items[0].provider_message_id = 'provider-message-1';
  assert.equal(await followupRunHasExternalReceipt(tenantId, batch.run_id), true, 'provider evidence is required to claim an external send');
} finally {
  (store as unknown as { getById: typeof store.getById }).getById = originalGetById;
  (store as unknown as { list: typeof store.list }).list = originalList;
  (store as unknown as { update: typeof store.update }).update = originalUpdate;
}

console.log('digital employee follow-up safety tests passed');
