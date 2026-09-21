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

test('unconfigured budget fails closed without creating a ledger', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-budget-empty-'));
  try {
    const budget = new StudioPaidBudget(root, () => { throw new Error('未核对历史费用'); });
    assert.equal(budget.status('heygen').allowed, false);
    await assert.rejects(budget.reserve('heygen', 'r1'), /历史费用/);
    assert.equal(fs.existsSync(path.join(root, 'ledger.json')), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('avatar training uses its own reservation without changing video pricing or resetting the ledger', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-avatar-budget-'));
  const config = { limit: 100_000_000, openingUsed: 10_000_000, reserve: { heygen: 4_000_000, qwen_asr: 1_000_000 } };
  const budget = new StudioPaidBudget(root, () => config);
  try {
    assert.equal(budget.status('heygen', '').allowed, false);
    assert.equal(budget.status('heygen', '30').reservationCny, 30);
    assert.equal(budget.status('heygen').reservationCny, 4);
    await budget.reserve('heygen', 'presenter:first', '30');
    await budget.reserve('heygen', 'presenter:first', '30');
    assert.equal(budget.status('heygen').remainingCny, 60);
    await assert.rejects(budget.reserve('heygen', 'presenter:too-large', '61'), /余额不足/);
    await assert.rejects(budget.reserve('heygen', 'presenter:missing', ''), /预算/);
    assert.equal(budget.status('heygen').remainingCny, 60);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
