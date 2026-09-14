import test from 'node:test';
import assert from 'node:assert/strict';
import { applyQuoteDraftPatch, buildQuoteDraft, catalogProductsFromEnterprise, composeQuoteReply, quoteIntentScore } from './engine.js';

const product = {
  sku: 'CNC-6061-01',
  name: '铝合金传动轴支架',
  material: '6061-T6',
  unit: '件',
  unitPrice: 40,
  currency: 'CNY',
  moq: 100,
  leadTime: '15天',
  priceSource: '企业产品目录',
  attributes: {},
};

test('识别报价意图并从对话与目录构建可核验草稿', () => {
  assert.ok(quoteIntentScore('Please quote 500 pcs, material 6061-T6, delivery within 20 days') >= 80);
  const draft = buildQuoteDraft({
    customerId: 'customer-1',
    customerName: 'ACME',
    productHint: '铝合金传动轴支架',
    messages: ['Please quote 500 pcs, material 6061-T6, delivery within 20 days, destination Shanghai, FOB'],
    products: [product],
    rules: { leadTime: '20天', paymentTerms: '30% deposit' },
  });
  assert.equal(draft.status, 'ready_for_review');
  assert.equal(draft.sku, product.sku);
  assert.equal(draft.quantity, 500);
  assert.equal(draft.unitPrice, 40);
  assert.equal(draft.subtotal, 20_000);
  assert.equal(draft.humanConfirmationRequired, true);
});

test('没有可信价格时阻止确认并允许人工补价', () => {
  const initial = buildQuoteDraft({
    customerId: 'customer-2',
    customerName: 'Buyer',
    productHint: 'custom bracket',
    messages: ['Can you quote 50 pcs custom bracket?'],
    products: [],
    rules: {},
  });
  assert.equal(initial.status, 'needs_clarification');
  assert.equal(initial.productName, 'custom bracket');
  assert.ok(initial.blockers.some(item => item.includes('单价')));
  const updated = applyQuoteDraftPatch(initial, {
    material: '7075',
    unitPrice: 12.5,
    destination: 'Shanghai',
    incoterm: 'FOB',
    deliveryDate: '20 days',
    paymentTerms: '30% deposit, balance before shipment',
  });
  assert.equal(updated.status, 'ready_for_review');
  assert.equal(updated.subtotal, 625);
  assert.ok(updated.pricingExplanation.some(item => item.includes('人工填写')));
  assert.ok(!updated.pricingExplanation.some(item => item.includes('价格待人工填写')));
  const confirmed = { ...updated, status: 'confirmed' as const };
  assert.match(composeQuoteReply(confirmed), /USD|CNY/);
  assert.match(composeQuoteReply(confirmed), /50/);
  assert.match(composeQuoteReply(confirmed), /50 pcs/);
});

test('人工更换产品时清除旧目录价，防止价格串用', () => {
  const initial = buildQuoteDraft({
    customerId: 'customer-3',
    customerName: 'Buyer',
    productHint: product.name,
    messages: ['Please quote 500 pcs in 6061-T6'],
    products: [product],
    rules: {},
  });
  assert.equal(initial.unitPrice, 40);
  const changed = applyQuoteDraftPatch(initial, { productName: '另一款支架' });
  assert.equal(changed.matchedProduct, null);
  assert.equal(changed.unitPrice, null);
  assert.equal(changed.status, 'needs_clarification');
});

test('按客户语言生成中文报价回复', () => {
  const draft = buildQuoteDraft({
    customerId: 'customer-4',
    customerName: '王经理',
    customerLanguage: '中文',
    productHint: product.name,
    messages: ['请报价 500 件，材料 6061-T6，交期 20 天'],
    products: [product],
    rules: {},
  });
  const reply = composeQuoteReply({ ...draft, status: 'confirmed' });
  assert.match(reply, /王经理，您好/);
  assert.match(reply, /产品小计/);
  assert.ok(draft.clarificationQuestions.every(question => /[\u4e00-\u9fff]/.test(question)));
});

test('价格区间不得被误识别为确定单价', () => {
  const [rangeProduct, exactProduct] = catalogProductsFromEnterprise([
    { name: '区间价产品', priceRange: '$5 - $500 USD' },
    { name: '确定价产品', retailPrice: 'USD 42.50', attributes: { leadTimeDays: 15 } },
  ]);
  assert.equal(rangeProduct.unitPrice, null);
  assert.equal(exactProduct.unitPrice, 42.5);
  assert.equal(exactProduct.currency, 'USD');
  assert.equal(exactProduct.leadTime, '15 days');
});
