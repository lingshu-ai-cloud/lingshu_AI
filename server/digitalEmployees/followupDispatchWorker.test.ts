import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { store } from '../storage/index.js';
import { dispatchFollowupBatch, followupDispatchPreflightBlockedReason, ingestFollowupDeliveryStatuses, nextFollowupDeliveryWindow, preflightFollowupBatchDispatch } from './followupDispatchWorker.js';
import type { FollowupBatchItemRecord, FollowupBatchRecord } from './customerWorkflow.js';

const now = new Date('2026-09-03T04:00:00.000Z');
const tenantId = 'tenant_worker_test';
const body = "Hi Maya, I'm following up on your earlier inquiry. What detail would be most useful now?";
assert.equal(nextFollowupDeliveryWindow('Asia/Shanghai', {
  workdaysOnly: true, sendWindowStartHour: 9, sendWindowEndHour: 18,
}, new Date('2026-09-04T12:00:00.000Z')).toISOString(), '2026-09-07T01:00:00.000Z', 'approval after the Friday window must defer until Monday morning');
const batch: FollowupBatchRecord = {
  id: 'batch_worker_test', tenant_id: tenantId, goal_id: 'goal-1', run_id: 'run-1', task_id: 'task-followup', segment_id: 'segment-1',
  name: 'approved follow-up', status: 'approved', version: 1, approval_id: 'approval-1', approved_version: 1,
  content_hash: 'batch-hash', delivery_policy: {}, safety_summary: {}, counts: {}, created_by: 'user-1', approved_by: 'user-1',
  created_at: now.toISOString(), updated_at: now.toISOString(), approved_at: now.toISOString(),
};
const item: FollowupBatchItemRecord = {
  id: 'item_worker_test', tenant_id: tenantId, batch_id: batch.id, segment_member_id: 'member-1', customer_id: 'customer-1', customer_name: 'Maya',
  wa_number: '15551234567', language: 'en', time_zone: 'America/New_York', last_inbound_at: new Date(now.getTime() - 60 * 60_000).toISOString(),
  outside_24h: false, send_mode: 'session_message', template_name: '', template_status: 'not_required', template_language: '', template_variables: [],
  draft_body: body, draft_version: 1, content_hash: createHash('sha256').update(JSON.stringify(body)).digest('hex'), status: 'approved', risk_level: 'low', guard_rule: '', exclusion_reason: '',
  scheduled_at: new Date(now.getTime() - 1_000).toISOString(), idempotency_key: 'idem-worker-1', provider_message_id: '', provider_receipt: {}, attempts: 0,
  last_error: '', approved_at: now.toISOString(), sent_at: '', delivered_at: '', created_at: now.toISOString(), updated_at: now.toISOString(),
};

const run = { id: batch.run_id, tenant_id: tenantId, status: 'running' };
const records = { batch, item };
const originalGetById = store.getById;
const originalList = store.list;
const originalUpdate = store.update;

store.getById = (async (collection: string, id: string) => {
  if (collection === 'workflow_runs' && id === run.id) return run;
  if (collection === 'followup_batches' && id === records.batch.id) return records.batch;
  if (collection === 'followup_batch_items' && id === records.item.id) return records.item;
  return null;
}) as typeof store.getById;
store.list = (async (collection: string) => {
  if (collection === 'followup_batch_items') return { items: [records.item], totalItems: 1, totalPages: 1, page: 1, perPage: 1000 };
  if (collection === 'followup_batches') return { items: [records.batch], totalItems: 1, totalPages: 1, page: 1, perPage: 500 };
  return { items: [], totalItems: 0, totalPages: 0, page: 1, perPage: 100 };
}) as typeof store.list;
store.update = (async (collection: string, id: string, patch: Record<string, unknown>) => {
  const target = collection === 'followup_batches' && id === records.batch.id
    ? records.batch as unknown as Record<string, unknown>
    : collection === 'followup_batch_items' && id === records.item.id
      ? records.item as unknown as Record<string, unknown>
      : null;
  if (!target) return false;
  Object.assign(target, patch);
  return true;
}) as typeof store.update;

try {
  let sends = 0;
  const authorization = async () => ({
    tenantId,
    configVersion: 1,
    configActive: true,
    customerAgentEnabled: true,
    tenantAuthorized: true,
    providerReady: true,
    backgroundWorkerEnabled: true,
    inboundAutoSendAllowed: true,
    manualFollowupSendAllowed: true,
    scheduledFollowupSendAllowed: true,
    reasons: [],
  });
  const customer: Record<string, unknown> = {
    id: item.customer_id,
    name: item.customer_name,
    waNumber: item.wa_number,
    handlingMode: 'ai_draft',
    tags: ['qa_e2e_isolated'],
    bant: { qualification_band: 'green', authenticity: { band: 'real' } },
    timeline: [{ actor: 'buyer', timestamp: now.getTime() - 60 * 60_000 }],
  };
  const unauthorizedPreflight = await preflightFollowupBatchDispatch(tenantId, batch.id, {
    mode: 'manual',
    dependencies: {
      now: () => now,
      customers: () => [customer],
      guard: async () => ({ allowed: true }),
      authorization: async () => ({
        ...(await authorization()),
        tenantAuthorized: false,
        inboundAutoSendAllowed: false,
        manualFollowupSendAllowed: false,
        scheduledFollowupSendAllowed: false,
        reasons: ['tenant_real_customer_messages_not_authorized'],
      }),
      sendText: async () => {
        sends += 1;
        throw new Error('must_not_send');
      },
    },
  });
  assert.equal(unauthorizedPreflight.ready, false);
  assert.equal(unauthorizedPreflight.eligible, 1);
  assert.equal(unauthorizedPreflight.blockers.customer_opted_out_or_blacklisted, undefined, 'the isolated QA marker must not be treated as an opt-out at dispatch time');
  assert.equal(unauthorizedPreflight.blockers.tenant_real_customer_messages_not_authorized, 1);
  assert.equal(sends, 0, 'read-only preflight must never call WhatsApp');
  assert.equal(item.status, 'approved', 'read-only preflight must not claim or mutate a batch item');
  const explicitBlockers = followupDispatchPreflightBlockedReason({
    ...unauthorizedPreflight,
    future: 2,
    eligible: 0,
    blockers: {
      tenant_real_customer_messages_not_authorized: 1,
      whatsapp_provider_not_ready: 1,
    },
    authorization: {
      ...unauthorizedPreflight.authorization,
      providerReady: false,
    },
  });
  assert.match(explicitBlockers, /租户未授权真实发送/);
  assert.match(explicitBlockers, /WhatsApp 渠道未连接或凭证未就绪/);
  assert.match(explicitBlockers, /未来发送时段：2 条尚未到逐客发送时间/);
  assert.doesNotMatch(explicitBlockers, /等待.*回执/, 'an unauthorized preflight must never claim it is merely waiting for a receipt');

  await assert.rejects(() => dispatchFollowupBatch(tenantId, batch.id, {
    mode: 'manual',
    dependencies: {
      now: () => now,
      customers: () => [customer],
      guard: async () => ({ allowed: true }),
      recordOutbound: () => {},
      recipientDelayMs: 0,
      authorization: async () => ({
        ...(await authorization()),
        tenantAuthorized: false,
        inboundAutoSendAllowed: false,
        manualFollowupSendAllowed: false,
        scheduledFollowupSendAllowed: false,
        reasons: ['tenant_real_customer_messages_not_authorized'],
      }),
      sendText: async () => {
        sends += 1;
        throw new Error('must_not_send');
      },
    },
  }), /customer_message_send_not_authorized:tenant_real_customer_messages_not_authorized/);
  assert.equal(sends, 0, 'approval without explicit tenant consent must never call WhatsApp');
  assert.equal(item.status, 'approved', 'an unauthorized batch must remain approved and pending instead of being marked sent');

  for (const status of ['paused', 'cancelled', 'waiting_human', 'failed', 'succeeded']) {
    run.status = status;
    const stoppedPreflight = await preflightFollowupBatchDispatch(tenantId, batch.id, {
      dependencies: { now: () => now, customers: () => [customer], guard: async () => ({ allowed: true }), authorization },
    });
    assert.equal(stoppedPreflight.ready, false);
    assert.equal(stoppedPreflight.blockers[`workflow_run_${status}`], 1);
    await assert.rejects(() => dispatchFollowupBatch(tenantId, batch.id, { dependencies: { authorization } }), new RegExp(`workflow_run_${status}`));
  }
  run.status = 'running';
  run.tenant_id = 'other-tenant';
  await assert.rejects(() => dispatchFollowupBatch(tenantId, batch.id, { dependencies: { authorization } }), /workflow_run_unavailable/);
  run.tenant_id = tenantId;
  const pauseBeforeProvider = await dispatchFollowupBatch(tenantId, batch.id, {
    dependencies: {
      now: () => now, customers: () => [customer], authorization, recipientDelayMs: 0,
      guard: async () => { run.status = 'paused'; return { allowed: true }; },
      sendText: async () => { sends += 1; throw new Error('must_not_send'); },
    },
  });
  assert.equal(pauseBeforeProvider.blocked, 1);
  assert.equal(pauseBeforeProvider.claimed, 0);
  assert.equal(sends, 0, 'a pause between preflight and provider execution must still block');
  assert.equal(item.status, 'approved');
  assert.equal(item.attempts, 0, 'human control must not consume retry attempts');
  run.status = 'running';

  const result = await dispatchFollowupBatch(tenantId, batch.id, {
    mode: 'manual',
    dependencies: {
      now: () => now,
      customers: () => [customer],
      guard: async () => ({ allowed: true }),
      recordOutbound: () => {},
      authorization,
      recipientDelayMs: 0,
      sendText: async (_tenant, _to, _body, onReceipt) => {
        sends += 1;
        const receipt = { messageId: 'wamid.worker.1', recipientId: item.wa_number, raw: { messages: [{ id: 'wamid.worker.1' }] } };
        await onReceipt?.({ message: body, receipt, index: 0, total: 1 });
        return { messages: [body], receipts: [receipt] };
      },
    },
  });
  assert.equal(result.sent, 1);
  assert.equal(sends, 1);
  assert.equal(item.status, 'sent');
  assert.equal(item.provider_message_id, 'wamid.worker.1');
  assert.equal(batch.status, 'completed');

  await assert.rejects(() => dispatchFollowupBatch(tenantId, batch.id, { mode: 'manual' }), /followup_batch_not_approved_for_current_version/);
  assert.equal(sends, 1, 'a completed batch must never resend the same item');

  batch.status = 'approved';
  item.status = 'sent';
  run.status = 'cancelled';
  const delivered = await ingestFollowupDeliveryStatuses(tenantId, {
    entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.worker.1', status: 'delivered', timestamp: String(now.getTime() / 1000) }] } }] }],
  });
  assert.equal(delivered, 1);
  assert.equal(item.status, 'delivered');
  assert.equal(item.delivered_at, now.toISOString());
  batch.status = 'approved';
  const read = await ingestFollowupDeliveryStatuses(tenantId, {
    entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.worker.1', status: 'read', timestamp: String((now.getTime() + 1_000) / 1000) }] } }] }],
  });
  assert.equal(read, 1);
  assert.equal(item.status, 'read');
  run.status = 'running';
  const stale = await ingestFollowupDeliveryStatuses(tenantId, {
    entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.worker.1', status: 'sent', timestamp: String((now.getTime() + 2_000) / 1000) }] } }] }],
  });
  assert.equal(stale, 0, 'out-of-order provider receipts must not downgrade read to sent');
  assert.equal(item.status, 'read');

  batch.status = 'approved';
  item.status = 'approved';
  item.provider_message_id = '';
  item.provider_receipt = {};
  item.sent_at = '';
  customer.tags = ['do not contact'];
  const blocked = await dispatchFollowupBatch(tenantId, batch.id, {
    mode: 'manual',
    dependencies: { now: () => now, customers: () => [customer], guard: async () => ({ allowed: true }), recordOutbound: () => {}, authorization, recipientDelayMs: 0 },
  });
  assert.equal(blocked.blocked, 1);
  assert.equal(item.status, 'blocked');
  assert.equal(item.exclusion_reason, 'customer_opted_out_or_blacklisted');
  assert.equal(sends, 1, 'runtime opt-out must be checked immediately before sending');

  batch.status = 'approved';
  item.status = 'approved';
  item.provider_message_id = '';
  item.provider_receipt = {};
  item.attempts = 0;
  item.exclusion_reason = '';
  customer.tags = [];
  const partial = await dispatchFollowupBatch(tenantId, batch.id, {
    mode: 'manual',
    dependencies: {
      now: () => now, customers: () => [customer], guard: async () => ({ allowed: true }), recordOutbound: () => {}, authorization, recipientDelayMs: 0,
      sendText: async (_tenant, _to, _body, onReceipt) => {
        const receipt = { messageId: 'wamid.worker.partial', recipientId: item.wa_number, raw: { messages: [{ id: 'wamid.worker.partial' }] } };
        await onReceipt?.({ message: 'first bubble', receipt, index: 0, total: 2 });
        throw Object.assign(new Error('temporary failure after first bubble'), { code: 'ECONNRESET' });
      },
    },
  });
  assert.equal(partial.partial, 1);
  assert.equal(item.status, 'partial_sent');
  assert.equal(item.attempts, 1);
  assert.equal(item.provider_message_id, 'wamid.worker.partial');

  batch.status = 'approved';
  item.status = 'approved';
  item.provider_message_id = '';
  item.provider_receipt = {};
  item.attempts = 0;
  const retry = await dispatchFollowupBatch(tenantId, batch.id, {
    mode: 'manual',
    dependencies: {
      now: () => now, customers: () => [customer], guard: async () => ({ allowed: true }), recordOutbound: () => {}, authorization, recipientDelayMs: 0,
      sendText: async () => { throw Object.assign(new Error('connection reset'), { code: 'ECONNRESET' }); },
    },
  });
  assert.equal(retry.retryScheduled, 1);
  assert.equal(item.status, 'retry_wait');
  assert.equal(item.scheduled_at, new Date(now.getTime() + 30_000).toISOString());
} finally {
  store.getById = originalGetById;
  store.list = originalList;
  store.update = originalUpdate;
}

console.log('digital employee follow-up dispatch worker tests passed');
