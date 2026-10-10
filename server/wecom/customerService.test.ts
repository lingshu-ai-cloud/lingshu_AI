import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import type { DataStore, ListQuery, Record_ } from '../storage/datastore.js';
import type { WeComKfProvider, WeComKfSyncMessage } from '../integrations/wecom.js';
import { WeComApiError } from '../integrations/wecom.js';
import { acquireDurableOperationLease } from '../runtime/durableLease.js';
import {
  createWeComCustomerService,
  WECOM_KF_COLLECTIONS,
  WeComCustomerServiceError,
} from './customerService.js';

function memoryStore(): { dataStore: DataStore; rows: Map<string, Record_[]> } {
  const rows = new Map<string, Record_[]>();
  let counter = 0;
  const uniqueFields: Record<string, string[]> = {
    [WECOM_KF_COLLECTIONS.callbacks]: ['tenant_id', 'callback_key'],
    [WECOM_KF_COLLECTIONS.syncStates]: ['tenant_id', 'open_kfid'],
    [WECOM_KF_COLLECTIONS.conversations]: ['tenant_id', 'conversation_key'],
    [WECOM_KF_COLLECTIONS.messages]: ['tenant_id', 'provider_msg_id'],
    [WECOM_KF_COLLECTIONS.outbounds]: ['tenant_id', 'caller_key'],
    durable_operation_leases: ['tenant_id', 'lease_scope', 'subject_id'],
  };
  const dataStore: DataStore = {
    async getById<T>(collection: string, id: string) {
      return structuredClone(rows.get(collection)?.find(row => row.id === id) ?? null) as T | null;
    },
    async create<T>(collection: string, data: Record<string, unknown>) {
      const bucket = rows.get(collection) ?? [];
      const keys = uniqueFields[collection] ?? [];
      if (keys.length && bucket.some(row => keys.every(key => row[key] === data[key]))) {
        throw new Error('unique_constraint');
      }
      const item = { id: `r${++counter}`, ...structuredClone(data) } as Record_;
      bucket.push(item);
      rows.set(collection, bucket);
      return structuredClone(item) as T;
    },
    async update(collection: string, id: string, patch: Record<string, unknown>) {
      const item = rows.get(collection)?.find(row => row.id === id);
      if (!item) return false;
      Object.assign(item, structuredClone(patch));
      return true;
    },
    async delete(collection: string, id: string) {
      const bucket = rows.get(collection) ?? [];
      const index = bucket.findIndex(row => row.id === id);
      if (index < 0) return false;
      bucket.splice(index, 1);
      return true;
    },
    async list<T>(collection: string, query: ListQuery = {}) {
      const where = query.where ?? {};
      let found = (rows.get(collection) ?? []).filter(row => Object.entries(where)
        .every(([key, expected]) => row[key] === expected));
      if (query.sort) {
        const descending = query.sort.startsWith('-');
        const key = descending ? query.sort.slice(1) : query.sort;
        found = [...found].sort((a, b) => String(a[key] ?? '').localeCompare(String(b[key] ?? '')) * (descending ? -1 : 1));
      }
      const page = query.page ?? 1;
      const perPage = query.perPage ?? 30;
      const totalItems = found.length;
      const items = found.slice((page - 1) * perPage, page * perPage).map(item => structuredClone(item)) as T[];
      return { items, totalItems, totalPages: Math.ceil(totalItems / perPage), page, perPage };
    },
  };
  return { dataStore, rows };
}

const encodingAesKey = Buffer.from('abcdef0123456789abcdef0123456789').toString('base64').replace(/=$/, '');
const connection = {
  corpId: 'corp-test',
  corpSecret: 'secret-test',
  callbackToken: 'verify-test',
  encodingAesKey,
  credentialMode: 'tenant_secret' as const,
};

function encryptedCallback(syncToken: string, receiveId = connection.corpId): string {
  const message = `<xml><ToUserName><![CDATA[${receiveId}]]></ToUserName><CreateTime>1790000000</CreateTime><Event><![CDATA[kf_msg_or_event]]></Event><Token><![CDATA[${syncToken}]]></Token><OpenKfId><![CDATA[wk-test]]></OpenKfId></xml>`;
  const key = Buffer.from(`${encodingAesKey}=`, 'base64');
  const messageBytes = Buffer.from(message);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(messageBytes.length);
  const unpadded = Buffer.concat([Buffer.alloc(16, 1), length, messageBytes, Buffer.from(receiveId)]);
  const remainder = unpadded.length % 32;
  const pad = remainder === 0 ? 32 : 32 - remainder;
  const cipher = crypto.createCipheriv('aes-256-cbc', key, key.subarray(0, 16));
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(Buffer.concat([unpadded, Buffer.alloc(pad, pad)])), cipher.final()]).toString('base64');
}

function callbackInput(syncToken: string, nonce: string, now: number) {
  const encrypted = encryptedCallback(syncToken);
  const timestamp = String(Math.floor(now / 1000));
  const signature = crypto.createHash('sha1')
    .update([connection.callbackToken, timestamp, nonce, encrypted].sort().join(''))
    .digest('hex');
  return {
    tenantId: 'tenant-a', signature, timestamp, nonce,
    rawXml: `<xml><Encrypt><![CDATA[${encrypted}]]></Encrypt></xml>`,
  };
}

test('WeCom KF callback synchronizes empty pages safely, deduplicates, sends with gates, and consumes failure events', async () => {
  const { dataStore, rows } = memoryStore();
  let currentNow = 1_790_000_000_000;
  let serviceState = 1;
  let sendMode: 'success' | 'unknown' = 'success';
  let sendCalls = 0;
  const syncCalls: Array<{ cursor?: string; token: string }> = [];
  const batches: Array<{ nextCursor: string; hasMore: boolean; messages: WeComKfSyncMessage[] }> = [
    { nextCursor: 'cursor-1', hasMore: true, messages: [] },
    {
      nextCursor: 'cursor-2', hasMore: false,
      messages: [{
        msgid: 'inbound-1', open_kfid: 'wk-test', external_userid: 'external-1',
        origin: 3, send_time: Math.floor(currentNow / 1000), msgtype: 'text', text: { content: '请报价' },
      }],
    },
  ];
  const provider: WeComKfProvider = {
    async syncMessages(input) {
      syncCalls.push({ cursor: input.cursor, token: input.token });
      const batch = batches.shift();
      if (!batch) throw new Error('unexpected_sync');
      return batch;
    },
    async getServiceState() { return { serviceState, servicerUserId: '' }; },
    async sendText() {
      sendCalls += 1;
      if (sendMode === 'unknown') throw new WeComApiError('network', 'network', true);
      return { msgId: 'provider-outbound-1' };
    },
    async transferServiceState() { return undefined; },
  };
  const service = createWeComCustomerService({
    dataStore, provider, now: () => currentNow,
    loadConnection: async tenantId => tenantId === 'tenant-a' ? connection : null,
    generateDraft: async () => '价格和付款条件需要人工确认。',
  });

  await assert.rejects(
    service.receiveCallback({ ...callbackInput('sync-token-invalid', 'nonce-invalid', currentNow), signature: 'invalid' }),
    error => error instanceof WeComCustomerServiceError && error.code === 'wecom_callback_signature_invalid',
  );
  await assert.rejects(
    service.receiveCallback(callbackInput('sync-token-stale', 'nonce-stale', currentNow - 11 * 60 * 1000)),
    error => error instanceof WeComCustomerServiceError && error.code === 'wecom_callback_timestamp_invalid',
  );

  const first = await service.receiveCallback(callbackInput('sync-token-1', 'nonce-1', currentNow));
  assert.deepEqual(first, { duplicate: false, pages: 2, messages: 1 });
  assert.deepEqual(syncCalls.map(call => call.cursor), ['', 'cursor-1']);
  assert.equal(syncCalls[0].token, 'sync-token-1');
  assert.equal(rows.get(WECOM_KF_COLLECTIONS.conversations)?.length, 1);
  const callback = rows.get(WECOM_KF_COLLECTIONS.callbacks)?.[0];
  assert.equal(callback?.status, 'processed');
  assert.equal(callback?.sync_token_cipher, '', 'short-lived callback token must be cleared after sync');

  const duplicate = await service.receiveCallback(callbackInput('sync-token-1', 'nonce-1', currentNow));
  assert.deepEqual(duplicate, { duplicate: true, pages: 0, messages: 0 });
  assert.equal(syncCalls.length, 2, 'replayed callback must not sync twice');

  const conversation = rows.get(WECOM_KF_COLLECTIONS.conversations)![0];
  const draft = await service.createDraft({
    tenantId: 'tenant-a', conversationId: conversation.id, userId: 'agent-a',
  });
  assert.equal(draft.requires_human_review, true);
  await assert.rejects(
    service.sendDraft({
      tenantId: 'tenant-a', conversationId: conversation.id, draftId: draft.id,
      userId: 'agent-a', idempotencyKey: 'send-1', humanApproved: false,
    }),
    error => error instanceof WeComCustomerServiceError && error.code === 'wecom_human_approval_required',
  );
  const sent = await service.sendDraft({
    tenantId: 'tenant-a', conversationId: conversation.id, draftId: draft.id,
    userId: 'agent-a', idempotencyKey: 'send-1', humanApproved: true,
  });
  assert.equal(sent.status, 'accepted_unconfirmed', 'API acceptance must not be presented as delivery');
  assert.equal(sendCalls, 1);
  const repeated = await service.sendDraft({
    tenantId: 'tenant-a', conversationId: conversation.id, draftId: draft.id,
    userId: 'agent-a', idempotencyKey: 'send-1', humanApproved: true,
  });
  assert.equal(repeated.id, sent.id);
  assert.equal(sendCalls, 1, 'same tenant + caller idempotency key must not send twice');

  batches.push({
    nextCursor: 'cursor-3', hasMore: false,
    messages: [{
      msgid: 'failure-event-1', open_kfid: 'wk-test', external_userid: 'external-1',
      origin: 4, send_time: Math.floor(currentNow / 1000), msgtype: 'event',
      event: { event_type: 'msg_send_fail', fail_msgid: 'provider-outbound-1', fail_type: 6 },
    }],
  });
  await service.receiveCallback(callbackInput('sync-token-2', 'nonce-2', currentNow));
  assert.equal(rows.get(WECOM_KF_COLLECTIONS.outbounds)?.find(item => item.id === sent.id)?.status, 'failed');

  serviceState = 2;
  await assert.rejects(
    service.sendDraft({
      tenantId: 'tenant-a', conversationId: conversation.id, draftId: draft.id,
      userId: 'agent-a', idempotencyKey: 'send-state-2', humanApproved: true,
    }),
    error => error instanceof WeComCustomerServiceError && error.code === 'wecom_service_state_disallows_api_send',
  );

  serviceState = 1;
  sendMode = 'unknown';
  await assert.rejects(
    service.sendDraft({
      tenantId: 'tenant-a', conversationId: conversation.id, draftId: draft.id,
      userId: 'agent-a', idempotencyKey: 'send-unknown', humanApproved: true,
    }),
    error => error instanceof WeComCustomerServiceError && error.code === 'wecom_send_outcome_unknown',
  );
  const unknown = rows.get(WECOM_KF_COLLECTIONS.outbounds)?.find(item => item.client_idempotency_key === 'send-unknown');
  assert.equal(unknown?.status, 'unknown');
  const callsBeforeBlockedRetry = sendCalls;
  await assert.rejects(
    service.sendDraft({
      tenantId: 'tenant-a', conversationId: conversation.id, draftId: draft.id,
      userId: 'agent-a', idempotencyKey: 'send-after-unknown', humanApproved: true,
    }),
    error => error instanceof WeComCustomerServiceError && error.code === 'wecom_send_reconciliation_required',
  );
  assert.equal(sendCalls, callsBeforeBlockedRetry, 'an ambiguous prior send must block another external effect');

  currentNow += 48 * 60 * 60 * 1000 + 1;
  await assert.rejects(
    service.sendDraft({
      tenantId: 'tenant-a', conversationId: conversation.id, draftId: draft.id,
      userId: 'agent-a', idempotencyKey: 'send-expired', humanApproved: true,
    }),
    error => error instanceof WeComCustomerServiceError && error.code === 'wecom_48h_send_window_closed',
  );
  await assert.rejects(
    service.getConversationDetail({ tenantId: 'tenant-b', conversationId: conversation.id }),
    error => error instanceof WeComCustomerServiceError && error.code === 'wecom_customer_service_not_configured',
  );
});

test('WeCom KF fails closed when credentials are absent and enforces the five-message window', async () => {
  const { dataStore, rows } = memoryStore();
  const now = 1_790_000_000_000;
  let sendCalls = 0;
  const provider: WeComKfProvider = {
    async syncMessages() { return { nextCursor: '', hasMore: false, messages: [] }; },
    async getServiceState() { return { serviceState: 1, servicerUserId: '' }; },
    async sendText(input) { sendCalls += 1; return { msgId: `sent-${input.msgId}` }; },
    async transferServiceState() { return undefined; },
  };
  const unavailable = createWeComCustomerService({
    dataStore, provider, now: () => now, loadConnection: async () => null,
  });
  await assert.rejects(
    unavailable.listConversations({ tenantId: 'tenant-a' }),
    error => error instanceof WeComCustomerServiceError && error.status === 503,
  );

  const conversation = await dataStore.create(WECOM_KF_COLLECTIONS.conversations, {
    tenant_id: 'tenant-a', conversation_key: 'key', open_kfid: 'wk', external_userid: 'external',
    status: 'active', last_inbound_at: new Date(now - 1_000).toISOString(),
    created_at: new Date(now - 1_000).toISOString(), updated_at: new Date(now).toISOString(),
  }) as Record_;
  const draft = await dataStore.create(WECOM_KF_COLLECTIONS.drafts, {
    tenant_id: 'tenant-a', conversation_id: conversation.id, content: '已收到，我们会尽快回复。',
    risk_level: 'normal', requires_human_review: false, risk_reasons: [], status: 'draft',
    created_by: 'agent', created_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString(),
  }) as Record_;
  for (let index = 0; index < 4; index += 1) {
    await dataStore.create(WECOM_KF_COLLECTIONS.outbounds, {
      tenant_id: 'tenant-a', conversation_id: conversation.id, draft_id: draft.id,
      caller_key: `caller-${index}`, client_idempotency_key: `old-${index}`,
      provider_msg_id: `provider-${index}`, status: 'accepted_unconfirmed',
      created_by: 'agent', created_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString(),
    });
  }
  const available = createWeComCustomerService({
    dataStore, provider, now: () => now, loadConnection: async () => connection,
  });
  const concurrent = await Promise.allSettled(['fifth-a', 'fifth-b'].map(idempotencyKey => available.sendDraft({
    tenantId: 'tenant-a', conversationId: conversation.id, draftId: draft.id,
    userId: 'agent', idempotencyKey, humanApproved: true,
  })));
  assert.equal(concurrent.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(concurrent.filter(result => (
    result.status === 'rejected'
    && result.reason instanceof WeComCustomerServiceError
    && result.reason.code === 'wecom_5_message_limit_reached'
  )).length, 1);
  assert.equal(sendCalls, 1, 'concurrent sixth attempt must be rejected before provider send');
  assert.equal(rows.get(WECOM_KF_COLLECTIONS.outbounds)?.length, 5);
});

test('WeCom callback ingestion ACK state is durable and a failed worker can be replayed idempotently', async () => {
  const { dataStore, rows } = memoryStore();
  const currentNow = 1_790_000_000_000;
  let syncCalls = 0;
  let failSync = true;
  const provider: WeComKfProvider = {
    async syncMessages() {
      syncCalls += 1;
      if (failSync) throw new Error('transient_sync_failure');
      return { nextCursor: 'recovered-cursor', hasMore: false, messages: [] };
    },
    async getServiceState() { return { serviceState: 1, servicerUserId: '' }; },
    async sendText() { return { msgId: 'unused' }; },
    async transferServiceState() { return undefined; },
  };
  const firstProcess = createWeComCustomerService({
    dataStore, provider, now: () => currentNow, loadConnection: async () => connection,
  });
  const callback = callbackInput('recoverable-token', 'recoverable-nonce', currentNow);
  const ingestion = await firstProcess.ingestCallback(callback);
  assert.equal(ingestion.status, 'queued');
  assert.equal(ingestion.shouldProcess, true);
  assert.equal(syncCalls, 0, 'durable ingestion must not wait for provider sync');
  assert.equal(rows.get(WECOM_KF_COLLECTIONS.callbacks)?.[0]?.status, 'queued');

  await assert.rejects(
    firstProcess.processCallback({ tenantId: 'tenant-a', callbackId: ingestion.callbackId }),
    /transient_sync_failure/,
  );
  const failed = rows.get(WECOM_KF_COLLECTIONS.callbacks)?.[0];
  assert.equal(failed?.status, 'failed');
  assert.ok(String(failed?.sync_token_cipher || '').startsWith('v1:'), 'retryable failure must retain the encrypted short-lived token');

  failSync = false;
  const restartedProcess = createWeComCustomerService({
    dataStore, provider, now: () => currentNow, loadConnection: async () => connection,
  });
  const recovery = await restartedProcess.recoverCallbacks({ tenantId: 'tenant-a' });
  assert.deepEqual(recovery, {
    attempted: 1, processed: 1, alreadyProcessed: 0, busy: 0, expired: 0, failed: 0,
  });
  const processed = rows.get(WECOM_KF_COLLECTIONS.callbacks)?.[0];
  assert.equal(processed?.status, 'processed');
  assert.equal(processed?.sync_token_cipher, '', 'processed callbacks must discard the sync token');
  assert.equal(syncCalls, 2);

  const duplicate = await restartedProcess.ingestCallback(callback);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.shouldProcess, false);
  assert.equal((await restartedProcess.recoverCallbacks({ tenantId: 'tenant-a' })).attempted, 0);
  assert.equal(syncCalls, 2, 'processed callback must not call sync_msg again');
});

test('duplicate processing callbacks remain recoverable after a crashed lease expires', async () => {
  const { dataStore, rows } = memoryStore();
  let currentNow = 1_790_000_000_000;
  let syncCalls = 0;
  const provider: WeComKfProvider = {
    async syncMessages() {
      syncCalls += 1;
      return { nextCursor: 'after-crash', hasMore: false, messages: [] };
    },
    async getServiceState() { return { serviceState: 1, servicerUserId: '' }; },
    async sendText() { return { msgId: 'unused' }; },
    async transferServiceState() { return undefined; },
  };
  const service = createWeComCustomerService({
    dataStore, provider, now: () => currentNow, loadConnection: async () => connection,
  });
  const callback = callbackInput('processing-token', 'processing-nonce', currentNow);
  const ingestion = await service.ingestCallback(callback);
  await dataStore.update(WECOM_KF_COLLECTIONS.callbacks, ingestion.callbackId, {
    status: 'processing', updated_at: new Date(currentNow).toISOString(),
  });
  assert.ok(await acquireDurableOperationLease({
    dataStore,
    tenantId: 'tenant-a',
    scope: 'wecom-kf-callback',
    subjectId: 'sync',
    ownerId: 'crashed-worker',
    now: new Date(currentNow),
    leaseDurationMs: 30_000,
    reclaimGraceMs: 5_000,
  }));

  const duplicate = await service.ingestCallback(callback);
  assert.equal(duplicate.status, 'processing');
  assert.equal(duplicate.shouldProcess, true, 'ACK is safe only because the durable record remains recoverable');
  const stillOwned = await service.recoverCallbacks({ tenantId: 'tenant-a' });
  assert.equal(stillOwned.busy, 1);
  assert.equal(syncCalls, 0);

  currentNow += 36_000;
  const recovered = await service.recoverCallbacks({ tenantId: 'tenant-a' });
  assert.equal(recovered.processed, 1);
  assert.equal(syncCalls, 1);
  assert.equal(rows.get(WECOM_KF_COLLECTIONS.callbacks)?.[0]?.status, 'processed');
  assert.equal(rows.get('durable_operation_leases')?.length ?? 0, 0, 'successor releases the reclaimed lease');
});
