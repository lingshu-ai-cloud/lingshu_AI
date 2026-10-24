import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendLocalCustomerMessage, readLocalCustomerConversations } from './localConversations.js';

test('local customer conversations are tenant-scoped and joined with local messages', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'local-conversations-'));
  const customers = path.join(root, 'customers.json'), interactions = path.join(root, 'interactions.json');
  fs.writeFileSync(customers, JSON.stringify([{ id: 'wa_mock_a', tenantId: 'tenant', name: 'A' }, { id: 'foreign', tenantId: 'other' }]));
  fs.writeFileSync(interactions, JSON.stringify([{ id: 'm1', tenantId: 'tenant', customerId: 'wa_mock_a', type: 'msg_in', body: 'MOQ?', timestamp: 2 }]));
  const result = readLocalCustomerConversations('tenant', { customers, interactions });
  assert.equal(result.length, 1); assert.equal(result[0]?.timeline[0]?.body, 'MOQ?'); assert.equal(result[0]?.readOnly, false);
  const receipt = appendLocalCustomerMessage('tenant', 'wa_mock_a', 'Sent locally', 'request_123', { customers, interactions });
  assert.equal(receipt?.localPreview, true);
  const after = readLocalCustomerConversations('tenant', { customers, interactions });
  assert.equal(after[0]?.timeline.at(-1)?.body, 'Sent locally');
  assert.equal(after[0]?.timeline.at(-1)?.actor, 'seller');
});

test('supervised beauty preview exposes the same workbench demo conversations to mobile and keeps replies local', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-conversations-'));
  const customers = path.join(root, 'customers.json'), interactions = path.join(root, 'interactions.json');
  fs.writeFileSync(customers, '[]');
  fs.writeFileSync(interactions, '[]');
  const previousPreview = process.env.LINGSHU_LOCAL_PREVIEW;
  const previousTenant = process.env.LINGSHU_PREVIEW_CONVERSATION_TENANT_ID;
  process.env.LINGSHU_LOCAL_PREVIEW = '1';
  process.env.LINGSHU_PREVIEW_CONVERSATION_TENANT_ID = 'preview-tenant';
  try {
    assert.equal(readLocalCustomerConversations('other-tenant', { customers, interactions }).length, 0);
    const before = readLocalCustomerConversations('preview-tenant', { customers, interactions });
    assert.ok(before.length >= 7);
    assert.ok(before.every(item => item.isMock === true && item.readOnly === false));
    assert.ok(before[0]?.timeline.length);
    const customer = before.find(item => item.id.startsWith('mock-export-'))!;
    const receipt = appendLocalCustomerMessage('preview-tenant', customer.id, 'Local mobile reply', 'mobile_request_123', { customers, interactions });
    assert.equal(receipt?.localPreview, true);
    const after = readLocalCustomerConversations('preview-tenant', { customers, interactions }).find(item => item.id === customer.id)!;
    assert.equal(after.timeline.at(-1)?.body, 'Local mobile reply');
    assert.equal(after.timeline.at(-1)?.actor, 'seller');
    assert.equal(after.hasUnread, false);
  } finally {
    if (previousPreview === undefined) delete process.env.LINGSHU_LOCAL_PREVIEW; else process.env.LINGSHU_LOCAL_PREVIEW = previousPreview;
    if (previousTenant === undefined) delete process.env.LINGSHU_PREVIEW_CONVERSATION_TENANT_ID; else process.env.LINGSHU_PREVIEW_CONVERSATION_TENANT_ID = previousTenant;
  }
});
