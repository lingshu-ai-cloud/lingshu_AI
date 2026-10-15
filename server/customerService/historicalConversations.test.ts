import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readHistoricalCustomers } from './historicalConversations.js';

test('historical imports are tenant-scoped, normalized and always read-only', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'historical-customers-test-'));
  const file = path.join(dir, 'records.json');
  try {
    const timeline = [{ id: 'event', body: 'Original message', actor: 'buyer' }];
    fs.writeFileSync(file, JSON.stringify([
      { id: 'history_one', tenantId: 'one', timeline, isReal: true, readOnly: false, outboundBlocked: false, pendingDraft: 'send me' },
      { id: 'history_two', tenantId: 'two', timeline },
      { id: 'messenger_live', tenantId: 'one', timeline },
    ]));
    const rows = readHistoricalCustomers('one', file);
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].timeline, timeline);
    assert.deepEqual(rows[0].orders, []);
    assert.deepEqual(rows[0].tags, []);
    assert.deepEqual(rows[0].intentSignals, []);
    assert.equal(rows[0].isReal, false);
    assert.equal(rows[0].readOnly, true);
    assert.equal(rows[0].outboundBlocked, true);
    assert.equal(rows[0].pendingDraft, undefined);
    assert.deepEqual(readHistoricalCustomers('', file), []);
    assert.deepEqual(readHistoricalCustomers('missing', file), []);
    assert.deepEqual(readHistoricalCustomers('one', path.join(dir, 'missing')), []);
    fs.writeFileSync(file, '{}');
    assert.throws(() => readHistoricalCustomers('one', file), /historical_customer_store_invalid/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
