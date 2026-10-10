import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { ReferencePaidBudget } from './referencePaidBudget.js';

test('reference budget reserves estimated cost durably and idempotently', async () => {
  const root = fs.mkdtempSync('/tmp/reference-budget-');
  try {
    const budget = new ReferencePaidBudget(root, () => 10);
    await budget.reserve('runway_act_two', 'same', 4); await budget.reserve('runway_act_two', 'same', 4);
    await budget.reserve('runway_act_two', 'second', 6);
    await assert.rejects(budget.reserve('runway_act_two', 'third', 0.01), /预算余额不足/);
    await budget.release('runway_act_two', 'same'); await budget.release('runway_act_two', 'same');
    await budget.reserve('runway_act_two', 'third', 4);
    const ledger = JSON.parse(fs.readFileSync(`${root}/ledger.json`, 'utf8'));
    assert.equal(Object.keys(ledger.entries).length, 2);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
