import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assertAddonPremium,
  evaluateUnitEconomics,
  internalCostPointsFromCny,
  providerCostCny,
  providerCostPoints,
} from './privateUnitEconomics.js';

const plan = {
  planId: 'professional-monthly',
  monthlyPriceCny: 200,
  allocations: {
    business_operations: 2_000,
    insight_planning: 4_000,
    content_production: 10_000,
    traffic_growth: 1_000,
    customer_service: 1_500,
    knowledge_assistant: 1_500,
  },
} as const;

test('add-on points must be more expensive than monthly package points', () => {
  const result = assertAddonPremium({ plan, addons: [{ sku: 'addon-1k', sellingPriceCny: 20, points: 1_000 }] });
  assert.equal(result.planCnyPerPoint, 0.01);
  assert.equal(result.addonCnyPerPoint['addon-1k'], 0.02);
  assert.throws(
    () => assertAddonPremium({ plan, addons: [{ sku: 'bad-addon', sellingPriceCny: 10, points: 1_000 }] }),
    /addon_premium_required/,
  );
});

test('provider currency cost and gross margin stay in a private calculation', () => {
  const cost = providerCostCny({
    amount: 2, currency: 'USD', cnyPerCurrencyUnit: 7.1,
    fxSource: 'audited-daily-rate', fxQuotedAt: '2026-10-20T00:00:00.000Z',
  });
  assert.equal(cost, 14.2);
  assert.equal(internalCostPointsFromCny(cost), 14_200);
  assert.equal(providerCostPoints({
    amount: 2, currency: 'USD', cnyPerCurrencyUnit: 7.1,
    fxSource: 'audited-daily-rate', fxQuotedAt: '2026-10-20T00:00:00.000Z',
  }), 14_200);
  assert.deepEqual(evaluateUnitEconomics({ deliveredPoints: 1_000, sellingCnyPerPoint: 0.02, providerCostCny: cost }), {
    recognizedRevenueCny: 20,
    providerCostCny: 14.2,
    grossProfitCny: 5.8,
    grossMarginRatio: 0.29,
  });
});
