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
