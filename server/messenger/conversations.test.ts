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
  await conversations.handleMessengerWebhook('tenant-a', payload);
  await conversations.handleMessengerWebhook('tenant-a', payload);
  const tenantA = conversations.getMessengerCustomers('tenant-a');
  assert.equal(tenantA.length, 1);
  assert.equal(tenantA[0].messengerUserId, 'psid-1');
  assert.equal(tenantA[0].pageId, 'page-1');
  assert.equal(tenantA[0].timeline.length, 1);
  assert.equal(tenantA[0].timeline[0].type, 'messenger');
  assert.equal(conversations.getMessengerCustomers('tenant-b').length, 0);
});

test.after(() => fs.rmSync(root, { recursive: true, force: true }));
