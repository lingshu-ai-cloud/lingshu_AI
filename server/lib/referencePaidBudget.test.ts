import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { ReferencePaidBudget } from './referencePaidBudget.js';

test('reference usage records estimated cost durably and idempotently without a ceiling', async () => {
  const root = fs.mkdtempSync('/tmp/reference-budget-');
  try {
    const budget = new ReferencePaidBudget(root, () => 10);
    await budget.reserve('runway_act_two', 'same', 4); await budget.reserve('runway_act_two', 'same', 4);
    await budget.reserve('runway_act_two', 'second', 6);
    await budget.reserve('runway_act_two', 'third', 0.01);
    await budget.release('runway_act_two', 'same'); await budget.release('runway_act_two', 'same');
    await budget.reserve('runway_act_two', 'third', 4);
    const ledger = JSON.parse(fs.readFileSync(`${root}/usage-ledger.json`, 'utf8'));
    assert.equal(Object.keys(ledger.entries).length, 2);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('reference usage is recorded consistently for every tenant', async () => {
  const root = fs.mkdtempSync('/tmp/reference-budget-exempt-');
  const previous = process.env.INTERNAL_BUDGET_EXEMPT_TENANT_IDS;
  process.env.INTERNAL_BUDGET_EXEMPT_TENANT_IDS = ' other-tenant, reference-exempt ';
  try {
    const budget = new ReferencePaidBudget(root, () => 10);
    await budget.reserve('runway_act_two', 'shared-full', 10, 'ordinary-tenant');
    await budget.reserve('runway_act_two', 'exempt-operation', 4, 'reference-exempt');
    await budget.reserve('runway_act_two', 'prefix-must-not-match', 0.01, 'reference-exempt-child');
    const ledger = JSON.parse(fs.readFileSync(`${root}/usage-ledger.json`, 'utf8'));
    assert.equal(Object.keys(ledger.entries).length, 3);
  } finally {
    if (previous === undefined) delete process.env.INTERNAL_BUDGET_EXEMPT_TENANT_IDS;
    else process.env.INTERNAL_BUDGET_EXEMPT_TENANT_IDS = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('reference usage ignores legacy monthly configuration but still rejects invalid estimates', async () => {
  const root = fs.mkdtempSync('/tmp/reference-budget-exempt-invalid-');
  const previous = process.env.INTERNAL_BUDGET_EXEMPT_TENANT_IDS;
  process.env.INTERNAL_BUDGET_EXEMPT_TENANT_IDS = 'reference-exempt';
  try {
    await new ReferencePaidBudget(root, () => Number.NaN).reserve('runway_act_two', 'invalid-limit', 1, 'reference-exempt');
    const budget = new ReferencePaidBudget(root, () => 10);
    for (const estimate of [null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      await assert.rejects(
        budget.reserve('runway_act_two', `invalid-estimate-${String(estimate)}`, estimate, 'reference-exempt'),
        /缺少有效的预计费用/,
      );
    }
    assert.equal(fs.existsSync(`${root}/usage-ledger.json`), true);
  } finally {
    if (previous === undefined) delete process.env.INTERNAL_BUDGET_EXEMPT_TENANT_IDS;
    else process.env.INTERNAL_BUDGET_EXEMPT_TENANT_IDS = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
