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

test('invalid persisted conversations fail without replacing customer data', async () => {
  const file = process.env.MESSENGER_CUSTOMERS_DATA_FILE!;
  for (const content of ['{broken', '{"unexpected":true}']) {
    fs.writeFileSync(file, content);
    assert.throws(() => conversations.getMessengerCustomers('tenant-a'));
    await assert.rejects(conversations.handleMessengerWebhook('tenant-a', {
      object: 'page', entry: [{ id: 'page-1', messaging: [{ sender: { id: 'psid-1' }, message: { mid: 'mid.2', text: 'Hello' } }] }],
    }, { analyzeTags: false }));
    assert.equal(fs.readFileSync(file, 'utf8'), content);
  }
});

test.after(() => fs.rmSync(root, { recursive: true, force: true }));
