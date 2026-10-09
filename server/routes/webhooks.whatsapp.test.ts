import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import { store } from '../storage/index.js';
import { encryptSecret } from '../lib/tenantPlatformApps.js';
import { selectWhatsAppStatusWebhookPayload, selectWhatsAppInboundWebhookPayload, webhookRouter } from './webhooks.js';
import { sendRecoveryFixture } from '../socialPrograms/weeklyCustomerSendRecovery.fixture.js';
import { bindWeeklyCustomerRun } from '../runtime/socialWeeklyCustomerBridge.js';
import { createWeeklyCustomerSendRecoveryService } from '../socialPrograms/weeklyCustomerSendRecovery.js';

const payload = (business = 'business-a', phone = 'phone-a') => ({ object: 'whatsapp_business_account', entry: [{ id: business,
  changes: [{ field: 'messages', value: { metadata: { phone_number_id: phone },
    statuses: [{ id: 'wamid.actual', status: 'delivered' }] } }] }] });
test('WhatsApp selection requires both owned business and phone; forwards only status evidence', () => {
  assert.equal(selectWhatsAppStatusWebhookPayload(payload('foreign'), { wabaId: 'business-a', phoneNumberId: 'phone-a' }).entry.length, 0);
  assert.equal(selectWhatsAppStatusWebhookPayload(payload('business-a', 'foreign'), { wabaId: 'business-a', phoneNumberId: 'phone-a' }).entry.length, 0);
  const mixed = payload();
  Object.assign(mixed.entry[0]!.changes[0]!.value, { messages: [{ id: 'incoming' }] });
  const selected = selectWhatsAppStatusWebhookPayload(mixed, { wabaId: 'business-a', phoneNumberId: 'phone-a' });
  assert.equal(selected.entry.length, 1);
  assert.equal(JSON.stringify(selected).includes('incoming'), false);
  const incoming = selectWhatsAppInboundWebhookPayload(mixed, { wabaId: 'business-a', phoneNumberId: 'phone-a' });
  assert.equal(incoming.entry.length, 1);
  assert.equal(JSON.stringify(incoming).includes('incoming'), true);
  assert.equal(JSON.stringify(incoming).includes('statuses'), false);
  assert.equal(selectWhatsAppInboundWebhookPayload(payload('foreign'), { wabaId: 'business-a', phoneNumberId: 'phone-a' }).entry.length, 0);
  assert.equal(selectWhatsAppInboundWebhookPayload(payload('business-a', 'foreign'), { wabaId: 'business-a', phoneNumberId: 'phone-a' }).entry.length, 0);
});
test('actual Meta HTTP HMAC gate rejects foreign signature and scopes WhatsApp status ingestion', async () => {
  const original = store.list;
  const scopes: string[] = [];
  store.list = (async (collection: string, query: any) => {
    if (collection === 'tenant_platform_apps') return { page: query.page ?? 1, perPage: query.perPage ?? 500, totalItems: 1, totalPages: 1,
      items: [{ tenant_id: query.where.tenant_id, platform: 'meta', status: 'active',
      app_secret: encryptSecret('owned-test-secret'), waba_id: 'business-a', phone_number_id: 'phone-a' }] };
    if (collection === 'followup_batch_items') scopes.push(query.where.tenant_id);
    return { page: query.page ?? 1, perPage: query.perPage ?? 500, items: [], totalItems: 0, totalPages: 0 };
  }) as typeof store.list;
  const app = express();
  app.use(express.json({ verify(req, _res, bytes) { (req as any).rawBody = Buffer.from(bytes); } }));
  app.use('/webhooks', webhookRouter);
  const listener = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => listener.once('listening', resolve));
  try {
    const address = listener.address(); assert.ok(address && typeof address === 'object');
    const send = (value: unknown, secret: string) => {
      const raw = JSON.stringify(value);
      return fetch(`http://127.0.0.1:${address.port}/webhooks/meta/tenant-a`, { method: 'POST',
        headers: { 'content-type': 'application/json', 'x-hub-signature-256': `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}` }, body: raw });
    };
    assert.equal((await send(payload(), 'foreign-secret')).status, 403);
    assert.deepEqual(scopes, []);
    assert.equal((await send(payload('foreign'), 'owned-test-secret')).status, 200);
    assert.equal((await send(payload('business-a', 'foreign'), 'owned-test-secret')).status, 200);
    assert.deepEqual(scopes, []);
    assert.equal((await send(payload(), 'owned-test-secret')).status, 200);
    assert.deepEqual(scopes, ['tenant-a']);
  } finally { store.list = original; await new Promise<void>((resolve, reject) => listener.close(error => error ? reject(error) : resolve())); }
});

test('signed tenant WhatsApp HTTP receipt resumes only its original human recovery task', async () => {
  const f = sendRecoveryFixture(), authority = { tenantId: 'tenant', programId: 'program', packageId: 'week', packageVersion: 1 };
  await bindWeeklyCustomerRun(f.store, authority, 'run', 'owner');
  const token = '12345678-1234-1234-1234-123456789abc';
  const batch = f.data.followup_batches![0]!, item = f.data.followup_batch_items![0]!;
  Object.assign(batch, { status: 'approved', created_by: 'issuer' });
  Object.assign(item, { status: 'blocked', exclusion_reason: 'send_outcome_unknown', wa_number: '15551234567', provider_message_id: '',
    provider_receipt: { claimToken: token, claimedAt: '2026-10-05T12:00:00Z', approvedBatchVersion: batch.version, approvedContentHash: item.content_hash, expectedMessages: [item.draft_body], messages: [] } });
  const dispatch = f.data.workflow_tasks!.find(t => t.task_key === 'followup_dispatch')!;
  Object.assign(dispatch, { status: 'waiting_external', blocked_reason: 'weekly_customer_send_outcome_unknown' });
  const service = createWeeklyCustomerSendRecoveryService(f.store);
  const request = await service.create(authority, 'issuer', { runId: 'run', itemId: 'item', ownerUserId: 'owner',
    deadlineAt: '2026-10-10T12:00:00+08:00', reason: '对账原消息' });
  const original = { list: store.list, getById: store.getById, update: store.update, create: store.create };
  Object.assign(store, { getById: f.store.getById.bind(f.store), update: f.store.update.bind(f.store), create: f.store.create.bind(f.store) });
  store.list = (async (collection: string, query: any) => collection === 'tenant_platform_apps'
    ? { page: 1, perPage: query.perPage ?? 500, totalItems: 1, totalPages: 1, items: [{ tenant_id: 'tenant', platform: 'meta', status: 'active',
      app_secret: encryptSecret('receipt-test-secret'), waba_id: 'business-a', phone_number_id: 'phone-a' }] }
    : f.store.list(collection, query)) as typeof store.list;
  const app = express(); app.use(express.json({ verify(req, _res, bytes) { (req as any).rawBody = Buffer.from(bytes); } }));
  app.use('/webhooks', webhookRouter);
  const listener = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => listener.once('listening', resolve));
  try {
    const address = listener.address(); assert.ok(address && typeof address === 'object');
    const value = payload(); value.entry[0]!.changes[0]!.value.statuses = [{ id: 'wamid.actual', status: 'delivered',
      timestamp: '1791266400', recipient_id: '15551234567', biz_opaque_callback_data: `followup:${token}:0` } as any];
    const raw = JSON.stringify(value);
    const result = await fetch(`http://127.0.0.1:${address.port}/webhooks/meta/tenant`, { method: 'POST', body: raw,
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': `sha256=${crypto.createHmac('sha256', 'receipt-test-secret').update(raw).digest('hex')}` } });
    assert.equal(result.status, 200);
    const resolved = await service.resolve(authority, request.id, 'owner', { expectedVersion: 1 });
    assert.equal(resolved.messagesSent, 0); assert.equal(resolved.runAdvanced, false);
    assert.equal(resolved.item.status, 'resolved'); assert.equal(dispatch.status, 'succeeded');
  } finally { Object.assign(store, original); await new Promise<void>((resolve, reject) => listener.close(error => error ? reject(error) : resolve())); }
});
