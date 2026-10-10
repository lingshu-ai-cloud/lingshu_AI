import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { store } from '../storage/index.js';
import { dispatchFollowupBatch, recoverStaleFollowupSending, followupDispatchPreflightBlockedReason, ingestFollowupDeliveryStatuses, nextFollowupDeliveryWindow, preflightFollowupBatchDispatch, runFollowupDispatchScan } from './followupDispatchWorker.js';
import { followupItemContentHash, type FollowupBatchItemRecord, type FollowupBatchRecord } from './customerWorkflow.js';
import { Starter198LegacyEffectError } from '../starter198/legacyEffectGuard.js';

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
const originalCreate = store.create;
const originalList = store.list;
const originalUpdate = store.update;
const originalDelete = store.delete;
const durableLeases: Array<Record<string, unknown> & { id: string }> = [];
let durableLeaseSequence = 0;

store.getById = (async (collection: string, id: string) => {
  if (collection === 'workflow_runs' && id === run.id) return run;
  if (collection === 'followup_batches' && id === records.batch.id) return records.batch;
  if (collection === 'followup_batch_items' && id === records.item.id) return records.item;
  if (collection === 'durable_operation_leases') return durableLeases.find(lease => lease.id === id) || null;
  return null;
}) as typeof store.getById;
store.create = (async (collection: string, data: Record<string, unknown>) => {
  if (collection !== 'durable_operation_leases') return null;
  if (durableLeases.some(lease => lease.tenant_id === data.tenant_id
    && lease.lease_scope === data.lease_scope
    && lease.subject_id === data.subject_id)) throw new Error('unique_lease_subject');
  const lease = { id: `lease-${++durableLeaseSequence}`, ...structuredClone(data) };
  durableLeases.push(lease);
  return structuredClone(lease);
}) as typeof store.create;
store.list = (async (collection: string, query = {}) => {
  if (collection === 'followup_batch_items') return { items: [records.item], totalItems: 1, totalPages: 1, page: 1, perPage: 1000 };
  if (collection === 'followup_batches') return { items: [records.batch], totalItems: 1, totalPages: 1, page: 1, perPage: 500 };
  if (collection === 'durable_operation_leases') {
    const where = query.where || {};
    const items = durableLeases.filter(lease => Object.entries(where).every(([key, value]) => lease[key] === value));
    return { items: structuredClone(items), totalItems: items.length, totalPages: items.length ? 1 : 0, page: 1, perPage: query.perPage || 20 };
  }
  return { items: [], totalItems: 0, totalPages: 0, page: 1, perPage: 100 };
}) as typeof store.list;
store.update = (async (collection: string, id: string, patch: Record<string, unknown>) => {
  if (collection === 'durable_operation_leases') {
    const lease = durableLeases.find(candidate => candidate.id === id);
    if (!lease) return false;
    Object.assign(lease, patch);
    return true;
  }
  const target = collection === 'followup_batches' && id === records.batch.id
    ? records.batch as unknown as Record<string, unknown>
    : collection === 'followup_batch_items' && id === records.item.id
      ? records.item as unknown as Record<string, unknown>
      : null;
  if (!target) return false;
  Object.assign(target, patch);
  return true;
}) as typeof store.update;
store.delete = (async (collection: string, id: string) => {
  if (collection !== 'durable_operation_leases') return false;
  const index = durableLeases.findIndex(lease => lease.id === id);
  if (index < 0) return false;
  durableLeases.splice(index, 1);
  return true;
}) as typeof store.delete;

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
  assert.equal(durableLeases.length, 0, 'authorization rejection must release the product-profile transition lease');

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
  assert.equal(retry.retryScheduled, 0);
  assert.equal(item.status, 'blocked');
  assert.equal(item.exclusion_reason, 'send_outcome_unknown', 'connection reset does not prove provider rejection');

  batch.status = 'approved'; item.status = 'sending'; item.provider_receipt = { claimToken: 'crashed', claimedAt: new Date(now.getTime() - 11 * 60_000).toISOString() }; item.provider_message_id = '';
  assert.equal(await recoverStaleFollowupSending(batch, now), 1);
  assert.equal(item.status, 'blocked'); assert.equal(batch.status, 'needs_attention');
  assert.equal(item.exclusion_reason, 'send_outcome_unknown');
  batch.status = 'approved';
  const recoveredDispatch = await dispatchFollowupBatch(tenantId, batch.id, {dependencies:{now:()=>now, authorization, recipientDelayMs:0, sendText:async()=>{ throw new Error('must not resend'); }}});
  assert.equal(recoveredDispatch.claimed, 0);
  batch.status = 'approved'; item.status = 'sending'; item.provider_receipt = {claimedAt:now.toISOString()};
  assert.equal(await recoverStaleFollowupSending(batch, now), 0, 'live sender is not recovered prematurely');

  batch.status='approved'; item.status='approved'; item.provider_receipt={}; item.provider_message_id=''; item.sent_at=''; item.attempts=0; item.scheduled_at=new Date(now.getTime()-1000).toISOString(); item.exclusion_reason='';
  const throttled=await dispatchFollowupBatch(tenantId,batch.id,{dependencies:{now:()=>now, customers:()=>[customer],guard:async()=>({allowed:true}),recordOutbound:()=>{},authorization,recipientDelayMs:0,
    sendText:async()=>{throw Object.assign(new Error('rate limit'),{response:{status:429}});}}});
  assert.equal(throttled.retryScheduled,1,'explicit rejected throttling can safely retry');
  assert.equal(item.status,'retry_wait');
  batch.status='approved'; item.status='approved'; item.provider_receipt={}; item.provider_message_id=''; item.sent_at=''; item.scheduled_at=new Date(now.getTime()-1000).toISOString();
  const historyFailure=await dispatchFollowupBatch(tenantId,batch.id,{dependencies:{now:()=>now,customers:()=>[customer],guard:async()=>({allowed:true}),authorization,recipientDelayMs:0,
    recordOutbound:()=>{throw new Error('local history unavailable');},sendText:async(_t,_n,_b,progress)=>{const receipt={messageId:'wamid.accepted',recipientId:item.wa_number,raw:{}}; await progress?.({receipt,message:body,index:0,total:1});return {messages:[body],receipts:[receipt]};}}});
  assert.equal(historyFailure.sent,1); assert.equal(item.status,'sent'); assert.equal(item.provider_message_id,'wamid.accepted');
  assert.equal((item.provider_receipt as any).localHistoryPending,true,'local errors must preserve accepted provider evidence');
  assert.equal(batch.status,'needs_attention','incomplete local business writeback is not batch completion');
  assert.equal(await recoverStaleFollowupSending(batch, now, ()=>{throw new Error('still unavailable');}),0);
  assert.equal((item.provider_receipt as any).localHistoryPending,true);
  let localWrites=0;
  assert.equal(await recoverStaleFollowupSending(batch, now, (input)=>{localWrites++;assert.equal(input.providerReceipts?.[0]?.messageId,'wamid.accepted');}),1);
  assert.equal(localWrites,1); assert.equal(item.provider_message_id,'wamid.accepted'); assert.equal(batch.status,'completed');
  assert.equal((item.provider_receipt as any).localHistoryPending,false);
  assert.equal(await recoverStaleFollowupSending(batch,now,()=>{throw new Error('duplicate history call');}),0);


  batch.status='approved'; item.status='approved'; item.provider_receipt={}; item.provider_message_id=''; item.sent_at=''; item.send_mode='template'; item.template_name='hello'; item.template_status='approved'; item.template_language='en_US'; item.template_variables=['Maya']; item.draft_body='Hello Maya'; item.content_hash=followupItemContentHash(item);
  const templatePreflight=await preflightFollowupBatchDispatch(tenantId,batch.id,{dependencies:{now:()=>now,customers:()=>[customer],guard:async()=>({allowed:true}),authorization,
    resolveTemplate:async()=>({id:'official',name:'hello',language:'en_US',status:'APPROVED',body:'Changed {{1}}',variableCount:1})}});
  assert.equal(templatePreflight.ready,false); assert.equal(templatePreflight.blockers.whatsapp_template_content_changed,1);
  const templateSent=await dispatchFollowupBatch(tenantId,batch.id,{dependencies:{now:()=>now,customers:()=>[customer],guard:async()=>({allowed:true}),authorization,recipientDelayMs:0,recordOutbound:()=>{},
    resolveTemplate:async()=>({id:'official',name:'hello',language:'en_US',status:'APPROVED',body:'Hello {{1}}',variableCount:1}),
    sendTemplate:async()=>({messageId:'wamid.template',recipientId:item.wa_number,raw:{}})}});
  assert.equal(templateSent.sent,1); assert.equal(item.provider_message_id,'wamid.template');

  // A verified provider callback can recover an acceptance lost before the first
  // local receipt. Recipient, attempt and immutable content must all match.
  const claimToken='11111111-1111-4111-8111-111111111111';
  item.status='blocked'; item.exclusion_reason='send_outcome_unknown'; item.provider_message_id='';
  item.provider_receipt={claimToken,claimedAt:now.toISOString(),approvedContentHash:item.content_hash,approvedBatchVersion:1,expectedMessages:['Hello Maya']};
  const callbackPayload=(recipient=item.wa_number,token=claimToken)=>({entry:[{changes:[{value:{statuses:[{id:'wamid.recovered',status:'delivered',recipient_id:recipient,biz_opaque_callback_data:`followup:${token}:0`,timestamp:String(now.getTime()/1000)}]}}]}]});
  assert.equal(await ingestFollowupDeliveryStatuses(tenantId,callbackPayload()),0,'unsigned endpoint cannot recover an unknown receipt');
  assert.equal(await ingestFollowupDeliveryStatuses(tenantId,callbackPayload('15550000000'),{verifiedSignature:true}),0,'recipient must match');
  assert.equal(await ingestFollowupDeliveryStatuses(tenantId,callbackPayload(item.wa_number,'22222222-2222-4222-8222-222222222222'),{verifiedSignature:true}),0,'wrong attempt is not evidence');
  assert.equal(await ingestFollowupDeliveryStatuses(tenantId,callbackPayload(),{verifiedSignature:true}),1);
  assert.equal(item.status,'delivered'); assert.equal(item.provider_message_id,'wamid.recovered'); assert.equal(item.exclusion_reason,'');
  assert.equal(batch.approved_version,1,'receipt recovery never changes approval');
  assert.equal(await ingestFollowupDeliveryStatuses(tenantId,callbackPayload(),{verifiedSignature:true}),1);
  assert.equal((item.provider_receipt as any).messages.length,1,'replayed receipt cannot duplicate messages');

  batch.status='approved'; item.status='approved'; item.provider_receipt={}; item.provider_message_id=''; item.sent_at=''; item.exclusion_reason=''; item.attempts=0;
  item.send_mode='session_message'; item.template_name=''; item.template_status='not_required'; item.template_variables=[]; item.draft_body=body; item.content_hash=followupItemContentHash(item);
  const starterPreflight = await preflightFollowupBatchDispatch(tenantId, batch.id, { dependencies: {
    now:()=>now, customers:()=>[customer], guard:async()=>({allowed:true}), authorization,
    assertLegacyAccess: async () => { throw new Starter198LegacyEffectError('starter_198_orchestrator_only', 403); },
  }});
  assert.equal(starterPreflight.ready, false);
  assert.equal(starterPreflight.blockers.starter_198_orchestrator_only, 1);

  item.status='sending'; item.provider_receipt={claimToken:'legacy-stale',claimedAt:new Date(now.getTime()-11*60_000).toISOString()};
  await assert.rejects(() => dispatchFollowupBatch(tenantId,batch.id,{dependencies:{
    now:()=>now, authorization,
    assertLegacyAccess:async()=>{throw new Starter198LegacyEffectError('starter_198_orchestrator_only',403);},
    sendText:async()=>{throw new Error('must_not_send');},
  }}), /starter_198_orchestrator_only/);
  assert.equal(item.status,'sending','starter authority must be checked before stale-recovery writes');
  assert.equal((item.provider_receipt as any).claimToken,'legacy-stale');

  item.status='approved'; item.provider_receipt={}; item.attempts=0;
  let transitionSends=0;
  await assert.rejects(()=>dispatchFollowupBatch(tenantId,batch.id,{dependencies:{
    now:()=>now,customers:()=>[customer],guard:async()=>({allowed:true}),recordOutbound:()=>{},authorization,recipientDelayMs:0,
    assertLegacyAccess:async()=>{},
    executeLegacyEffect:async()=>{throw new Starter198LegacyEffectError('starter_198_orchestrator_only',403);},
    sendText:async()=>{transitionSends++;throw new Error('must_not_send');},
  }}),/starter_198_orchestrator_only/);
  assert.equal(transitionSends,0,'starter authority must be rechecked inside the final provider-effect boundary');
  assert.equal(item.status,'approved');
  assert.equal(item.attempts,0,'a starter transition must not consume a provider attempt');

  const starterScanBatch={...batch,id:'starter-scan-batch',tenant_id:'starter-scan-tenant'};
  const enterpriseScanBatch={...batch,id:'enterprise-scan-batch',tenant_id:'enterprise-scan-tenant'};
  const scanList=store.list;
  store.list=(async(collection:string,query:any={})=>collection==='followup_batches'
    ? {items:[starterScanBatch,enterpriseScanBatch],totalItems:2,totalPages:1,page:query.page||1,perPage:query.perPage||500}
    : scanList(collection,query)) as typeof store.list;
  const recoveredTenants:string[]=[];
  const dispatchedTenants:string[]=[];
  assert.equal(await runFollowupDispatchScan({
    getItems:async()=>[], // This fixture isolates product guards, not item loading.
    assertLegacyAccess:async scannedTenant=>{if(scannedTenant==='starter-scan-tenant')throw new Starter198LegacyEffectError('starter_198_orchestrator_only',403);},
    recover:async scannedBatch=>{recoveredTenants.push(scannedBatch.tenant_id);return 0;},
    getBatch:async(_tenant,scannedId)=>scannedId===enterpriseScanBatch.id?enterpriseScanBatch:null,
    dispatch:async scannedTenant=>{dispatchedTenants.push(scannedTenant);return {batchId:'scan',mode:'scheduled',claimed:0,sent:0,partial:0,blocked:0,retryScheduled:0,failed:0,future:0,counts:{}};},
  }),2);
  assert.deepEqual(recoveredTenants,['enterprise-scan-tenant'],'a starter row must be rejected before recovery writes');
  assert.deepEqual(dispatchedTenants,['enterprise-scan-tenant'],'a starter row must not block later enterprise tenants');
  store.list=scanList;

  batch.status='approved'; item.status='approved'; item.provider_receipt={}; item.provider_message_id=''; item.sent_at=''; item.exclusion_reason='';
  const updating = store.update;
  store.update = (async (collection: string, id: string, patch: Record<string, unknown>) => collection === 'followup_batch_items' ? false : updating(collection, id, patch)) as typeof store.update;
  let unsafeSends=0;
  await assert.rejects(() => dispatchFollowupBatch(tenantId,batch.id,{dependencies:{now:()=>now,customers:()=>[customer],guard:async()=>({allowed:true}),authorization,recipientDelayMs:0,
    resolveTemplate:async()=>({id:'official',name:'hello',language:'en_US',status:'APPROVED',body:'Hello {{1}}',variableCount:1}),
    sendTemplate:async()=>{unsafeSends++;throw Error('must never send');}}}), /persistence_failed/);
  assert.equal(unsafeSends,0,'provider cannot be called until attempt is durable');
  store.update=updating;
  batch.status='approved';item.status='approved';item.provider_receipt={};item.provider_message_id='';item.sent_at='';item.exclusion_reason='';item.send_mode='session_message';item.draft_body=body;item.content_hash=followupItemContentHash(item);item.scheduled_at=new Date(now.getTime()-1000).toISOString();
  const relationList=store.list,relationGet=store.getById;(run as any).goal_id=batch.goal_id;
  store.list=(async(c:string,q:any={})=>{const binding={id:'binding',tenant_id:tenantId,run_id:run.id,goal_id:batch.goal_id,program_id:'program',package_id:'week',package_version:1};const values=c==='social_weekly_customer_bindings'?[binding]:c==='social_weekly_operating_packages'?[{id:'pkg',tenant_id:tenantId,program_id:'program',package_id:'week',version:1,payload:{programId:'program',packageId:'week',version:1}}]:c==='social_programs'?[{id:'program',tenant_id:tenantId,program_id:'program',payload:{route:'cold_start'}}]:null;return values?{items:values,totalItems:values.length,totalPages:1,page:1,perPage:250}:relationList(c,q);})as typeof store.list;
  store.getById=(async(c:string,id:string)=>c==='weekly_goals'?{id:batch.goal_id,tenant_id:tenantId,starts_at:'2026-08-31T00:00:00Z',ends_at:'2026-09-06T23:59:59Z'}:c==='customer_segment_members'?{id:item.segment_member_id,tenant_id:tenantId,segment_id:batch.segment_id,customer_id:item.customer_id,membership:'included',customer_snapshot:{id:item.customer_id}}:relationGet(c,id))as typeof store.getById;
  let relationUnsafeSends=0;const relationBlocked=await dispatchFollowupBatch(tenantId,batch.id,{dependencies:{now:()=>now,customers:()=>[customer],guard:async()=>({allowed:true}),authorization,recipientDelayMs:0,sendText:async()=>{relationUnsafeSends++;throw Error('must not send');}}});assert.equal(relationBlocked.blocked,1);assert.equal(relationUnsafeSends,0);assert.equal(item.exclusion_reason,'weekly_customer_relationship_snapshot_missing');store.list=relationList;store.getById=relationGet;

} finally {
  store.getById = originalGetById;
  store.create = originalCreate;
  store.list = originalList;
  store.update = originalUpdate;
  store.delete = originalDelete;
}

console.log('digital employee follow-up dispatch worker tests passed');
