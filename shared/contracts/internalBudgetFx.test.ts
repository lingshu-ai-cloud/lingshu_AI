import assert from 'node:assert/strict';
import test from 'node:test';
import { budgetCnyFromUsd, budgetUsdFromCny, INTERNAL_BUDGET_FX } from './internalBudgetFx.js';

test('fixed management FX converts CNY quotes to USD without a live-rate call', () => {
  assert.equal(INTERNAL_BUDGET_FX.cnyPerUsd, 6.6);
  assert.equal(budgetUsdFromCny(6.6), 1);
  assert.equal(budgetUsdFromCny(1), 0.151516);
  assert.equal(budgetCnyFromUsd(1), 6.6);
  assert.equal(Object.is(budgetUsdFromCny(0), -0), false);
  assert.throws(() => budgetUsdFromCny(-1), /amount_invalid/);
  assert.throws(() => budgetCnyFromUsd(Infinity), /amount_invalid/);
  assert.throws(() => budgetCnyFromUsd(Number.MAX_VALUE), /amount_overflow/);
});
