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

test('exact exempt tenant bypasses an exhausted shared ceiling without mutating its ledger', async () => {
  const root = fs.mkdtempSync('/tmp/reference-budget-exempt-');
  const previous = process.env.INTERNAL_BUDGET_EXEMPT_TENANT_IDS;
  process.env.INTERNAL_BUDGET_EXEMPT_TENANT_IDS = ' other-tenant, reference-exempt ';
  try {
    const budget = new ReferencePaidBudget(root, () => 10);
    await budget.reserve('runway_act_two', 'shared-full', 10, 'ordinary-tenant');
    const ledgerBefore = fs.readFileSync(`${root}/ledger.json`, 'utf8');

    await budget.reserve('runway_act_two', 'exempt-operation', 4, 'reference-exempt');
    assert.equal(fs.readFileSync(`${root}/ledger.json`, 'utf8'), ledgerBefore,
      'an exempt request must neither consume nor rewrite the shared ledger');
    await assert.rejects(
      budget.reserve('runway_act_two', 'prefix-must-not-match', 0.01, 'reference-exempt-child'),
      /预算余额不足/,
    );
  } finally {
    if (previous === undefined) delete process.env.INTERNAL_BUDGET_EXEMPT_TENANT_IDS;
    else process.env.INTERNAL_BUDGET_EXEMPT_TENANT_IDS = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('reference exemption still rejects invalid monthly configuration and estimates', async () => {
  const root = fs.mkdtempSync('/tmp/reference-budget-exempt-invalid-');
  const previous = process.env.INTERNAL_BUDGET_EXEMPT_TENANT_IDS;
  process.env.INTERNAL_BUDGET_EXEMPT_TENANT_IDS = 'reference-exempt';
  try {
    await assert.rejects(
      new ReferencePaidBudget(root, () => Number.NaN).reserve('runway_act_two', 'invalid-limit', 1, 'reference-exempt'),
      /缺少有效的预计费用/,
    );
    const budget = new ReferencePaidBudget(root, () => 10);
    for (const estimate of [null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      await assert.rejects(
        budget.reserve('runway_act_two', `invalid-estimate-${String(estimate)}`, estimate, 'reference-exempt'),
        /缺少有效的预计费用/,
      );
    }
    assert.equal(fs.existsSync(`${root}/ledger.json`), false);
  } finally {
    if (previous === undefined) delete process.env.INTERNAL_BUDGET_EXEMPT_TENANT_IDS;
    else process.env.INTERNAL_BUDGET_EXEMPT_TENANT_IDS = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
