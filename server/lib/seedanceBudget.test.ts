import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('Seedance exemption matches one exact tenant while every other tenant keeps its monthly ceiling', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seedance-budget-exempt-'));
  const originalCwd = process.cwd();
  const previous = {
    exempt: process.env.INTERNAL_BUDGET_EXEMPT_TENANT_IDS,
    limit: process.env.SEEDANCE_TENANT_MONTHLY_BUDGET_CNY,
    rate: process.env.SEEDANCE_ESTIMATED_CNY_PER_SECOND_720P,
  };
  process.env.INTERNAL_BUDGET_EXEMPT_TENANT_IDS = 'seedance-exempt';
  process.env.SEEDANCE_TENANT_MONTHLY_BUDGET_CNY = '1';
  process.env.SEEDANCE_ESTIMATED_CNY_PER_SECOND_720P = '1';
  process.chdir(root);
  try {
    // The module binds its durable ledger path at load time. Import it only
    // after entering a disposable cwd so this test cannot touch developer data.
    const moduleUrl = new URL('./seedanceBudget.ts', import.meta.url);
    moduleUrl.searchParams.set('test', `${process.pid}-${Date.now()}`);
    const { reserveSeedanceBudget } = await import(moduleUrl.href) as typeof import('./seedanceBudget.js');

    assert.equal(reserveSeedanceBudget({ tenantId: 'seedance-exempt', duration: 1, resolution: '720p' }).ok, true);
    const exemptOverLimit = reserveSeedanceBudget({ tenantId: 'seedance-exempt', duration: 1, resolution: '720p' });
    assert.equal(exemptOverLimit.ok, true);
    assert.equal(exemptOverLimit.usedCny, 2);
    assert.equal(exemptOverLimit.remainingCny, 0);

    assert.equal(reserveSeedanceBudget({ tenantId: 'seedance-exempt-child', duration: 1, resolution: '720p' }).ok, true);
    const ordinaryOverLimit = reserveSeedanceBudget({ tenantId: 'seedance-exempt-child', duration: 1, resolution: '720p' });
    assert.equal(ordinaryOverLimit.ok, false, 'a tenant prefix must not inherit the exact exemption');
    assert.equal(ordinaryOverLimit.usedCny, 1);
  } finally {
    process.chdir(originalCwd);
    if (previous.exempt === undefined) delete process.env.INTERNAL_BUDGET_EXEMPT_TENANT_IDS;
    else process.env.INTERNAL_BUDGET_EXEMPT_TENANT_IDS = previous.exempt;
    if (previous.limit === undefined) delete process.env.SEEDANCE_TENANT_MONTHLY_BUDGET_CNY;
    else process.env.SEEDANCE_TENANT_MONTHLY_BUDGET_CNY = previous.limit;
    if (previous.rate === undefined) delete process.env.SEEDANCE_ESTIMATED_CNY_PER_SECOND_720P;
    else process.env.SEEDANCE_ESTIMATED_CNY_PER_SECOND_720P = previous.rate;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
