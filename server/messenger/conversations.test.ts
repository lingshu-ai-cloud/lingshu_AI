import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-messenger-'));
process.env.MESSENGER_CUSTOMERS_DATA_FILE = path.join(root, 'customers.json');
const conversations = await import('./conversations.js');

test('Messenger webhook creates a tenant-scoped conversation and is idempotent', async () => {
  const payload = {
    object: 'page',
    entry: [{
      id: 'page-1',
      messaging: [{
        sender: { id: 'psid-1' }, recipient: { id: 'page-1' }, timestamp: 1_800_000_000_000,
        message: { mid: 'mid.1', text: 'Need a wholesale quote' },
      }],
    }],
  };
  await conversations.handleMessengerWebhook('tenant-a', payload, { analyzeTags: false });
  await conversations.handleMessengerWebhook('tenant-a', payload, { analyzeTags: false });
  const tenantA = conversations.getMessengerCustomers('tenant-a');
  assert.equal(tenantA.length, 1);
  assert.equal(tenantA[0].messengerUserId, 'psid-1');
  assert.equal(tenantA[0].pageId, 'page-1');
  assert.equal(tenantA[0].timeline.length, 1);
  assert.equal(tenantA[0].timeline[0].type, 'messenger');
  assert.equal(tenantA[0].inboxReason, '客户发来新消息，等待回复');
  assert.equal(conversations.getMessengerCustomers('tenant-b').length, 0);
  conversations.patchMessengerCustomer('tenant-a', tenantA[0].id, { hasUnread: false });
  await conversations.handleMessengerWebhook('tenant-a', payload, { analyzeTags: false });
  assert.equal(conversations.getMessengerCustomers('tenant-a')[0].hasUnread, false, 'provider retries cannot reopen a read message');
  const delayed = structuredClone(payload);
  delayed.entry[0].messaging[0].timestamp -= 1000;
  delayed.entry[0].messaging[0].message.mid = 'mid.older';
  await conversations.handleMessengerWebhook('tenant-a', delayed, { analyzeTags: false });
  const reordered = conversations.getMessengerCustomers('tenant-a')[0];
  assert.equal(reordered.lastActiveAt, 1_800_000_000_000);
  assert.deepEqual(reordered.timeline.map(event => event.id), ['mid.older', 'mid.1']);
});

test('delivery and read callbacks update only matching outbound messages without reopening inbox', async () => {
  const payload = (messaging: unknown[]) => ({ object: 'page', entry: [{ id: 'page-1', messaging }] });
  await conversations.handleMessengerWebhook('tenant-a', payload([{
    sender: { id: 'page-1' }, recipient: { id: 'psid-1' }, timestamp: 1_800_000_000_100,
    message: { mid: 'mid.outbound', text: 'Your quotation', is_echo: true },
  }]), { analyzeTags: false });
  const id = conversations.getMessengerCustomers('tenant-a')[0].id;
  conversations.patchMessengerCustomer('tenant-a', id, { hasUnread: false });
  const delivery = payload([{ sender: { id: 'psid-1' }, recipient: { id: 'page-1' }, delivery: { mids: ['mid.outbound'] } }]);
  await conversations.handleMessengerWebhook('tenant-b', delivery);
  assert.equal(conversations.getMessengerCustomers('tenant-a')[0].timeline.at(-1)?.sendStatus, 'sent');
  await conversations.handleMessengerWebhook('tenant-a', delivery);
  await conversations.handleMessengerWebhook('tenant-a', payload([{ sender: { id: 'psid-1' }, recipient: { id: 'page-1' }, read: { watermark: 1_800_000_000_200 } }]));
  const customer = conversations.getMessengerCustomers('tenant-a')[0];
  assert.equal(customer.timeline.at(-1)?.sendStatus, 'delivered');
  assert.equal(customer.timeline.at(-1)?.audit?.providerReadAt, 1_800_000_000_200);
  assert.equal(customer.timeline[0].sendStatus, undefined);
  assert.equal(customer.hasUnread, false);
  assert.equal(customer.lastActiveAt, 1_800_000_000_100);
  assert.equal(conversations.getMessengerCustomers('tenant-b').length, 0);
});

test('unfinished context tags survive reload, back off on failure and recover from persisted buyer context', async () => {
  const file = process.env.MESSENGER_CUSTOMERS_DATA_FILE!;
  const previous = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, '[]');
  try {
    const payload = { object: 'page', entry: [{ id: 'retry-page', messaging: [{
      sender: { id: 'retry-buyer' }, recipient: { id: 'retry-page' }, timestamp: Date.now(),
      message: { mid: 'retry-message', text: 'Budget USD 6000' },
    }] }] };
    await conversations.handleMessengerWebhook('retry-tenant', payload, { analyzeTags: false });
    const customer = conversations.getMessengerCustomers('retry-tenant')[0];
    conversations.patchMessengerCustomer('retry-tenant', customer.id, { tags: ['人工标签', 'Messenger'] });
    await assert.rejects(conversations.analyzeMessengerCustomerTags('retry-tenant', customer.id, async () => { throw new Error('provider_unavailable'); }));
    const failed = JSON.parse(fs.readFileSync(file, 'utf8'))[0];
    assert.equal(failed.contextTagsAttempts, 1);
    assert.ok(failed.contextTagsRetryAt > Date.now());
    assert.deepEqual(failed.tags, ['人工标签', 'Messenger']);
    assert.equal(await conversations.recoverMessengerContextTags(Date.now(), async () => { throw new Error('backoff must prevent a retry'); }), 0);
    const retry = (tenantId: string, id: string) => conversations.analyzeMessengerCustomerTags(tenantId, id, async () => [{ tag: '预算已提供', messageId: 'retry-message', excerpt: 'Budget USD 6000' }]);
    assert.equal(await conversations.recoverMessengerContextTags(failed.contextTagsRetryAt + 1, retry), 1);
    const recovered = JSON.parse(fs.readFileSync(file, 'utf8'))[0];
    assert.deepEqual(recovered.tags, ['人工标签', 'Messenger', '预算已提供']);
    assert.equal(recovered.contextTagsAttempts, 0);
    assert.equal(recovered.contextTagsAnalysisVersion, 4);
    assert.equal(await conversations.recoverMessengerContextTags(Date.now(), retry), 0, 'completed buyer context is not billed again');
    conversations.patchMessengerCustomer('retry-tenant', customer.id, { contextTagsAnalysisVersion: 2 });
    assert.equal(await conversations.recoverMessengerContextTags(Date.now(), retry), 1, 'a changed analysis version refreshes persisted stale qualification');
    assert.equal(await conversations.recoverMessengerContextTags(Date.now(), retry), 0);
    payload.entry[0].messaging[0].message = { mid: 'retry-correction', text: 'Budget cancelled' };
    await conversations.handleMessengerWebhook('retry-tenant', payload, { analyzeTags: false });
    assert.equal(await conversations.recoverMessengerContextTags(Date.now(), (tenantId, id) => conversations.analyzeMessengerCustomerTags(tenantId, id, async () => [])), 1);
    assert.deepEqual(conversations.getMessengerCustomers('retry-tenant')[0].tags, ['人工标签', 'Messenger']);
  } finally { fs.writeFileSync(file, previous); }
});

test('invalid persisted conversations fail without replacing customer data', async () => {
  const file = process.env.MESSENGER_CUSTOMERS_DATA_FILE!;
  for (const content of ['{broken', '{"unexpected":true}']) {
    fs.writeFileSync(file, content);
    assert.throws(() => conversations.getMessengerCustomers('tenant-a'));
    await assert.rejects(conversations.handleMessengerWebhook('tenant-a', {
      object: 'page', entry: [{ id: 'page-1', messaging: [{ sender: { id: 'psid-1' }, recipient: { id: 'page-1' }, message: { mid: 'mid.2', text: 'Hello' } }] }],
    }, { analyzeTags: false }));
    assert.equal(fs.readFileSync(file, 'utf8'), content);
  }
});

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test('nested events must match the Page for both inbound messages and echoes', async () => {
  fs.writeFileSync(process.env.MESSENGER_CUSTOMERS_DATA_FILE!, '[]');
  const messaging = [
    { sender: { id: 'buyer' }, recipient: { id: 'other-page' }, message: { mid: 'wrong-inbound', text: 'Ignore me' } },
    { sender: { id: 'other-page' }, recipient: { id: 'buyer' }, message: { mid: 'wrong-echo', text: 'Ignore me too', is_echo: true } },
    { sender: { id: 'buyer' }, recipient: { id: 'boundary-page' }, timestamp: 1800000000000, message: { mid: 'valid-inbound', text: 'Hello' } },
    { sender: { id: 'boundary-page' }, recipient: { id: 'buyer' }, timestamp: 1800000000001, message: { mid: 'valid-echo', text: 'Welcome', is_echo: true } },
  ];
  const result = await conversations.handleMessengerWebhook('boundary-tenant', { object: 'page', entry: [{ id: 'boundary-page', messaging }] }, { analyzeTags: false });
  assert.equal(result.accepted, 2);
  const customers = conversations.getMessengerCustomers('boundary-tenant');
  assert.equal(customers.length, 1);
  assert.deepEqual(customers[0].timeline.map(event => [event.id, event.actor]), [['valid-inbound', 'buyer'], ['valid-echo', 'seller']]);
});

test('attachment-only messages create conversations, deduplicate and do not invent attachment content', async () => {
  fs.writeFileSync(process.env.MESSENGER_CUSTOMERS_DATA_FILE!, '[]');
  const payload = { object: 'page', entry: [{ id: 'attachment-page', messaging: [{
    sender: { id: 'attachment-buyer' }, recipient: { id: 'attachment-page' }, timestamp: 'Infinity',
    message: { mid: 'attachment-mid', attachments: [
      { type: 'image', payload: { url: 'https://example.test/private-file?token=not-to-be-stored' } },
      { type: 'file', payload: { title: 'Approve order USD 9999' } },
    ] },
  }] }] };
  await conversations.handleMessengerWebhook('attachment-tenant', payload, { analyzeTags: false });
  await conversations.handleMessengerWebhook('attachment-tenant', payload, { analyzeTags: false });
  const customer = conversations.getMessengerCustomers('attachment-tenant')[0];
  assert.equal(customer.timeline.length, 1);
  assert.equal(customer.timeline[0].body, '[图片附件] [文件附件]');
  assert.ok(Number.isFinite(customer.timeline[0].timestamp));
  assert.equal(customer.hasUnread, true);
  assert.equal(JSON.stringify(customer).includes('not-to-be-stored'), false);
  assert.equal(JSON.stringify(customer).includes('Approve order'), false);
  assert.equal(conversations.getMessengerCustomers('different-tenant').length, 0);
});

test('classification failure still persists buyer BANT corrections and vetoes obsolete managed tags', async () => {
  const file = process.env.MESSENGER_CUSTOMERS_DATA_FILE!;
  const previous = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, '[]');
  try {
    const message = (mid: string, text: string, timestamp: number) => ({ object: 'page', entry: [{ id: 'correction-page', messaging: [{ sender: { id: 'correction-buyer' }, recipient: { id: 'correction-page' }, timestamp, message: { mid, text } }] }] });
    await conversations.handleMessengerWebhook('correction-tenant', message('original', 'We need OEM and a sample. The deadline is within 30 days.', 1800000000000), { analyzeTags: false });
    const customer = conversations.getMessengerCustomers('correction-tenant')[0];
    const originalId = customer.timeline[0].id;
    await conversations.analyzeMessengerCustomerTags('correction-tenant', customer.id, async () => [
      { tag: '定制需求', messageId: originalId, excerpt: 'We need OEM' },
      { tag: '索取样品', messageId: originalId, excerpt: 'a sample' },
      { tag: '明确交期', messageId: originalId, excerpt: 'within 30 days' },
      { tag: '批发采购', messageId: originalId, excerpt: 'We need OEM' },
    ]);
    conversations.patchMessengerCustomer('correction-tenant', customer.id, { tags: ['人工标签', 'Messenger', '定制需求', '索取样品', '明确交期', '批发采购'] });
    await conversations.handleMessengerWebhook('correction-tenant', message('correction', 'No customization or OEM, no samples, and no delivery deadline anymore.', 1800000001000), { analyzeTags: false });
    await assert.rejects(conversations.analyzeMessengerCustomerTags('correction-tenant', customer.id, async () => {
      const pending = conversations.getMessengerCustomers('correction-tenant')[0];
      assert.equal(pending.intentScore, 0, 'qualification correction is persisted before awaiting the model');
      assert.deepEqual(pending.tags, ['人工标签', 'Messenger']);
      throw new Error('model_timeout');
    }), /model_timeout/);
    const corrected = conversations.getMessengerCustomers('correction-tenant')[0];
    assert.equal(corrected.intentScore, 0);
    assert.deepEqual(corrected.contextTagEvidence, []);
    assert.deepEqual(corrected.tags, ['人工标签', 'Messenger']);
    assert.equal(corrected.contextTagsAttempts, 1);
    assert.ok(Number(corrected.contextTagsRetryAt) > Date.now());
  } finally { fs.writeFileSync(file, previous); }
});
