import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { StudioPaidBudget } from './studioPaidBudget.js';

test('persistent budget pools providers, reuses reservations, blocks overspend and config resets', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-budget-test-'));
  const config = { limit: 10_000_000, openingUsed: 3_000_000, reserve: { heygen: 4_000_000, qwen_asr: 1_000_000 } };
  const budget = new StudioPaidBudget(root, () => config);
  try {
    assert.equal(budget.status('heygen').remainingCny, 7);
    await budget.reserve('heygen', 'A:request1');
    await new StudioPaidBudget(root, () => config).reserve('heygen', 'A:request1');
    assert.equal(budget.status('heygen').remainingCny, 3);
    await assert.rejects(budget.reserve('heygen', 'B:request2'), /余额不足/);
    await budget.reserve('qwen_asr', 'B:audio1');
    assert.equal(budget.status('qwen_asr').remainingCny, 2);
    config.limit = 20_000_000;
    assert.equal(budget.status('heygen').allowed, false);
    await assert.rejects(budget.reserve('heygen', 'new'), /配置已改变/);
    config.limit = 10_000_000;
    fs.writeFileSync(path.join(root, 'ledger.json'), '{corrupt');
    assert.equal(budget.status('heygen').allowed, false);
    await assert.rejects(budget.reserve('heygen', 'new'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('short photo job reserves its explicit estimate while preserving the administrator ceiling', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-photo-budget-test-'));
  const config = { limit: 5_000_000, openingUsed: 0, reserve: { heygen: 10_000_000, qwen_asr: 1_000_000 } };
  const budget = new StudioPaidBudget(root, () => config);
  try {
    assert.equal(budget.status('heygen').allowed, false);
    assert.equal(budget.status('heygen', 4).allowed, true);
    await budget.reserve('heygen', 'one-second', 4);
    assert.equal(budget.status('heygen', 4).remainingCny, 1);
    await budget.reserve('heygen', 'one-second', 4);
    await assert.rejects(budget.reserve('heygen', 'one-second', 3), /已变化/);
    await assert.rejects(budget.reserve('heygen', 'another', 4), /余额不足/);
    await assert.rejects(budget.reserve('heygen', 'oversize', 11), /超过管理员上限/);
    await budget.releaseRejected('heygen', 'one-second');
    assert.equal(budget.status('heygen', 4).remainingCny, 5);
    await budget.releaseRejected('heygen', 'one-second');
    await budget.reserve('heygen', 'another', 4);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('unconfigured budget fails closed without creating a ledger', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-budget-empty-'));
  try {
    const budget = new StudioPaidBudget(root, () => { throw new Error('未核对历史费用'); });
    assert.equal(budget.status('heygen').allowed, false);
    await assert.rejects(budget.reserve('heygen', 'r1'), /历史费用/);
    assert.equal(fs.existsSync(path.join(root, 'ledger.json')), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('studio exemption is exact, config-free, validates explicit estimates, and never writes the shared ledger', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-budget-exempt-'));
  const previous = process.env.INTERNAL_BUDGET_EXEMPT_TENANT_IDS;
  const exemptTenant = 'local_tenant_customer_aurelia_beauty';
  process.env.INTERNAL_BUDGET_EXEMPT_TENANT_IDS = exemptTenant;
  let configReads = 0;
  const budget = new StudioPaidBudget(root, () => {
    configReads += 1;
    throw new Error('预算未配置');
  });
  try {
    assert.deepEqual(budget.status('heygen', undefined, exemptTenant), {
      allowed: true, remainingCny: null, reservationCny: null, reason: '', budgetExempt: true,
    });
    assert.deepEqual(budget.status('heygen', 4, exemptTenant), {
      allowed: true, remainingCny: null, reservationCny: 4, reason: '', budgetExempt: true,
    });
    await budget.reserve('heygen', 'exempt-request-with-default-estimate', undefined, exemptTenant);
    await budget.reserve('heygen', 'exempt-request', 4, exemptTenant);
    assert.equal(configReads, 0, 'an exempt request must not read environment/admin budget configuration');
    assert.equal(fs.existsSync(path.join(root, 'ledger.json')), false,
      'an exempt request must not create or consume the shared ledger');

    assert.equal(budget.status('heygen', 1, `${exemptTenant}-child`).allowed, false,
      'tenant prefixes must not inherit another tenant exemption');
    await assert.rejects(budget.reserve('heygen', 'ordinary-request', 1, `${exemptTenant}-child`), /预算未配置/);

    for (const invalid of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.equal(budget.status('heygen', invalid, exemptTenant).allowed, false);
      await assert.rejects(budget.reserve('heygen', `invalid-estimate:${String(invalid)}`, invalid, exemptTenant), /预占金额无效/);
    }
  } finally {
    if (previous === undefined) delete process.env.INTERNAL_BUDGET_EXEMPT_TENANT_IDS;
    else process.env.INTERNAL_BUDGET_EXEMPT_TENANT_IDS = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('exact exempt tenant remains available when studio budget environment is absent; ordinary tenants fail closed', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-budget-missing-env-'));
  const exemptTenant = 'local_tenant_customer_aurelia_beauty';
  const keys = [
    'INTERNAL_BUDGET_EXEMPT_TENANT_IDS',
    'STUDIO_PAID_BUDGET_CNY',
    'STUDIO_PAID_OPENING_USED_CNY',
    'STUDIO_HEYGEN_RESERVE_CNY',
    'STUDIO_ASR_RESERVE_CNY',
  ] as const;
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  process.env.INTERNAL_BUDGET_EXEMPT_TENANT_IDS = exemptTenant;
  const budget = new StudioPaidBudget(root);
  try {
    assert.equal(budget.status('heygen', undefined, exemptTenant).allowed, true);
    await budget.reserve('heygen', 'missing-env-exempt', undefined, exemptTenant);
    assert.equal(fs.existsSync(path.join(root, 'ledger.json')), false);

    const ordinaryStatus = budget.status('heygen', undefined, 'ordinary-tenant');
    assert.equal(ordinaryStatus.allowed, false);
    assert.match(ordinaryStatus.reason, /预算须显式配置/);
    await assert.rejects(budget.reserve('heygen', 'missing-env-ordinary', undefined, 'ordinary-tenant'), /预算须显式配置/);
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});
