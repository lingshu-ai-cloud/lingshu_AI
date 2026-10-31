import assert from 'node:assert/strict';
import test from 'node:test';
import { compareEstimateWithReceipt, estimateDeterministicTaskUsd, normalizeProviderReceiptUsd } from './internalUsdEstimate.js';

test('deterministic seconds and images price in USD, with one fixed CNY conversion', () => {
  const result = estimateDeterministicTaskUsd([
    { id: 'video-a', quantity: 12, attempts: 2, price: { version: 'video.v1', provider: 'vendor-a', model: 'video-model',
      configuration: '720p', unit: 'second', nativeCurrency: 'CNY', nativePricePerUnit: 1.5,
      sourceRef: 'internal:video-rate', basis: 'calibrated_unit' } },
    { id: 'image-a', quantity: 3, attempts: 1, price: { version: 'image.v1', provider: 'vendor-b', model: 'image-model',
      configuration: 'standard', unit: 'image', nativeCurrency: 'USD', nativePricePerUnit: 0.25,
      sourceRef: 'internal:image-rate', basis: 'calibrated_unit' } },
  ]);
  assert.equal(result.currency, 'USD');
  assert.equal(result.estimatedUsd, 6.204546);
  assert.equal(result.items[0]?.nativeAmount, 36);
  assert.equal(result.items[0]?.estimatedUsd, 5.454546);
  assert.equal(result.items[1]?.estimatedUsd, 0.75);
  assert.equal(result.fxVersion, 'usd-cny-budget-2026-10-30.v1');
});

test('receipt retains native amount and is compared without changing points', () => {
  const receipt = normalizeProviderReceiptUsd({ amount: 7.2, currency: 'CNY', receiptRef: 'receipt-1' });
  assert.equal(receipt.nativeAmount, 7.2);
  assert.equal(receipt.usdEquivalent, 1.09091);
  assert.deepEqual(compareEstimateWithReceipt(1.2, receipt.usdEquivalent), {
    exceeded: false, differenceUsd: 0.10909, coverageRatio: 1.2 / 1.09091,
  });
  assert.equal(compareEstimateWithReceipt(1, 2).exceeded, true);
  assert.throws(() => normalizeProviderReceiptUsd({ amount: -1, currency: 'USD', receiptRef: 'receipt-1' }), /receipt_invalid/);
});

test('invalid task pricing cannot become a zero-cost quote', () => {
  assert.throws(() => estimateDeterministicTaskUsd([]), /lines_required/);
  assert.throws(() => estimateDeterministicTaskUsd([
    { id: 'image-a', quantity: 0, attempts: 1, price: { version: 'v1', provider: 'vendor', model: 'image',
      configuration: 'standard', unit: 'image', nativeCurrency: 'USD', nativePricePerUnit: 0.25,
      sourceRef: 'internal:test', basis: 'calibrated_unit' } },
  ]), /line_invalid/);
  assert.throws(() => estimateDeterministicTaskUsd([
    { id: 'image-a', quantity: 1, attempts: 1, price: { version: 'v1', provider: 'vendor', model: 'image',
      configuration: 'standard', unit: 'image', nativeCurrency: 'USD', nativePricePerUnit: 0.25,
      sourceRef: 'internal:test', basis: 'calibrated_unit' } },
    { id: 'image-a', quantity: 1, attempts: 1, price: { version: 'v1', provider: 'vendor', model: 'image',
      configuration: 'standard', unit: 'image', nativeCurrency: 'USD', nativePricePerUnit: 0.25,
      sourceRef: 'internal:test', basis: 'calibrated_unit' } },
  ]), /line_invalid/);
});
