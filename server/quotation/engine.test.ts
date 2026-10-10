import assert from 'node:assert/strict';
import { calculateQuote, quoteInquiryFactsFromAi } from './engine.js';
import type { QuoteRuleSetInput } from './types.js';

const rules: QuoteRuleSetInput = {
  schemaVersion: '1.0',
  ruleSetKey: 'starter-widget',
  version: '2026-09-12.v1',
  status: 'confirmed',
  productId: 'widget',
  baseCurrency: 'USD',
  fxSnapshot: {
    id: 'fx-2026-09-12',
    asOf: '2026-09-12T00:00:00.000Z',
    rates: { USD: '1', EUR: '0.9', JPY: '150' },
    sourceRefs: ['treasury/fx/2026-09-12'],
  },
  skuRules: [{
    sku: 'SKU-A',
    requiredSpecifications: { color: ['blue', 'red'], voltage: ['220V'] },
    moq: 100,
    quantityTiers: [
      { minQuantity: 1, unitPrice: '1.005' },
      { minQuantity: 100, unitPrice: '0.90' },
      { minQuantity: 1000, unitPrice: '0.80' },
    ],
    unitCost: '0.50',
    incoterms: [
      { code: 'FOB', flatFee: '10', perUnitFee: '0.01', leadTimeDays: 20 },
      { code: 'CIF', flatFee: '20', perUnitFee: '0.02', leadTimeDays: 25 },
    ],
    shippingRules: [
      { destinationCountry: 'DE', incoterm: 'FOB', flatFee: '50', perUnitFee: '0.005' },
      { destinationCountry: '*', incoterm: 'CIF', flatFee: '80', perUnitFee: '0.01' },
    ],
    taxRateBps: 1900,
    taxBasis: 'goods_and_shipping',
    allowedPaymentTerms: ['LC', 'TT30'],
    standardLeadTimeDays: 30,
    maxDiscountBps: 500,
    minMarginBps: 3000,
    validDays: 30,
  }],
  sourceRefs: ['product/widget/confirmed-2026-09-12'],
};

const inquiry = {
  inquiryId: 'inquiry-1',
  inquiryVersion: '7',
  sku: 'sku-a',
  specifications: { voltage: '220V', color: 'red' },
  quantity: 100,
  quoteCurrency: 'eur',
  incoterm: 'fob',
  destinationCountry: 'de',
  paymentTerm: 'TT30',
  requestedDiscountBps: 500,
  quoteDate: '2026-09-12',
};

const golden = calculateQuote(rules, inquiry);
assert.equal(golden.status, 'calculated');
assert.equal(golden.executable, true);
assert.ok(golden.calculation);
assert.deepEqual({
  tier: golden.calculation.pricingTierMinQuantity,
  unit: golden.calculation.unitPrice,
  goods: golden.calculation.goodsSubtotal,
  discount: golden.calculation.discount,
  incoterm: golden.calculation.incotermFee,
  shipping: golden.calculation.shipping,
  tax: golden.calculation.tax,
  total: golden.calculation.total,
  margin: golden.calculation.marginBps,
  validity: [golden.calculation.validFrom, golden.calculation.validUntil],
}, {
  tier: 100,
  unit: { currency: 'EUR', minorUnits: '81', decimal: '0.81' },
  goods: { currency: 'EUR', minorUnits: '8100', decimal: '81.00' },
  discount: { currency: 'EUR', minorUnits: '405', decimal: '4.05' },
  incoterm: { currency: 'EUR', minorUnits: '990', decimal: '9.90' },
  shipping: { currency: 'EUR', minorUnits: '4545', decimal: '45.45' },
  tax: { currency: 'EUR', minorUnits: '2514', decimal: '25.14' },
  total: { currency: 'EUR', minorUnits: '15744', decimal: '157.44' },
  margin: 4152,
  validity: ['2026-09-12', '2026-10-12'],
});

const reordered = calculateQuote({
  ...rules,
  fxSnapshot: { ...rules.fxSnapshot, rates: { JPY: '150', EUR: '0.900', USD: '1.0' } },
}, { ...inquiry, specifications: { color: 'red', voltage: '220V' } });
assert.equal(reordered.inputHash, golden.inputHash, 'object key order must not affect the input hash');
assert.equal(reordered.calculation?.calculationHash, golden.calculation.calculationHash, 'equivalent decimal rules must replay identically');

const exactRules: QuoteRuleSetInput = {
  ...rules,
  ruleSetKey: 'exact-decimal',
  skuRules: [{
    ...rules.skuRules[0],
    moq: 1,
    requiredSpecifications: {},
    quantityTiers: [{ minQuantity: 1, unitPrice: '0.1' }],
    unitCost: '0',
    incoterms: [{ code: 'FOB', flatFee: '0.2', perUnitFee: '0' }],
    shippingRules: [{ destinationCountry: '*', incoterm: '*', flatFee: '0', perUnitFee: '0' }],
    taxRateBps: 0,
    maxDiscountBps: 0,
    minMarginBps: 0,
  }],
};
const exact = calculateQuote(exactRules, {
  ...inquiry,
  specifications: {},
  quantity: 3,
  quoteCurrency: 'USD',
  requestedDiscountBps: 0,
});
assert.equal(exact.calculation?.total.decimal, '0.50', '0.1 * 3 + 0.2 must be exact, not 0.5000000000000001');

const missing = calculateQuote(rules, { ...inquiry, quoteCurrency: undefined });
assert.equal(missing.status, 'missing_facts');
assert.equal(missing.calculation, null);
assert.ok(missing.missingFields.includes('quoteCurrency'));
assert.equal(JSON.stringify(missing).includes('minorUnits'), false, 'missing facts must not accidentally expose a partial amount');

const outsideRules = calculateQuote(rules, {
  ...inquiry,
  quantity: 50,
  requestedDiscountBps: 501,
  paymentTerm: 'NET90',
  requestedLeadTimeDays: 10,
});
assert.equal(outsideRules.status, 'exception_required');
assert.equal(outsideRules.executable, false);
assert.deepEqual(new Set(outsideRules.exceptions.map(item => item.code)), new Set([
  'below_moq',
  'discount_outside_authority',
  'payment_term_outside_authority',
  'lead_time_outside_authority',
]));

const changedVersion = calculateQuote({ ...rules, version: '2026-09-12.v2' }, inquiry);
assert.notEqual(changedVersion.ruleSetRef.hash, golden.ruleSetRef.hash);
assert.notEqual(changedVersion.calculation?.calculationHash, golden.calculation.calculationHash);

const extracted = quoteInquiryFactsFromAi({ ...inquiry, proposedPrice: '0.01', total: '1', apiKey: 'secret' }) as Record<string, unknown>;
assert.equal(extracted.proposedPrice, undefined);
assert.equal(extracted.total, undefined);
assert.equal(extracted.apiKey, undefined);
assert.equal(golden.aiBoundary.forbidden.includes('price_calculation'), true);

assert.throws(
  () => calculateQuote({ ...rules, skuRules: [{ ...rules.skuRules[0], unitCost: 0.1 as unknown as string }] }, inquiry),
  /decimal string/,
  'commercial decimals must be strings at the API boundary',
);

console.log('quotation engine passed: golden pricing, exact decimals, replay hash, missing facts, authority exceptions, and AI boundary');
