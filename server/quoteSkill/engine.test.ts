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

test('后续明确 SKU 覆盖未知资料和早期泛化需求，未知 SKU 不沿用旧目录价', () => {
  const input = {
    customerId: 'messenger-live', customerName: 'Buyer', productHint: '待确认',
    messages: ['I need 2000 customized products.', 'Please quote 2000 pcs of SKU CNC-6061-01 in 6061-T6.'],
    products: [product], rules: {},
  };
  assert.equal(buildQuoteDraft(input).unitPrice, 40);
  const changed = buildQuoteDraft({ ...input, messages: [...input.messages, 'Correction: quote SKU UNKNOWN-02 instead.'] });
  assert.equal(changed.unitPrice, null);
  assert.equal(changed.matchedProduct, null);
  const budget = buildQuoteDraft({ ...input, messages: [...input.messages, 'Budget is USD 5000. Correction: budget is CNY 10,000.'] });
  assert.deepEqual(budget.customerBudget, { amount: 10000, currency: 'CNY' });
  assert.equal(budget.unitPrice, 40, '客户预算不能覆盖企业目录单价');
});

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
  assert.equal(draft.unitPriceSource, 'product_catalog');
  assert.equal(draft.subtotal, 20_000);
  assert.equal(draft.humanConfirmationRequired, true);

  const nonPriceEdit = applyQuoteDraftPatch(draft, { destination: 'Ningbo' });
  assert.equal(nonPriceEdit.unitPriceSource, 'product_catalog');
  assert.match(nonPriceEdit.pricingExplanation.join('\n'), /价格来源：企业产品目录/);

  const manualPrice = applyQuoteDraftPatch(nonPriceEdit, { unitPrice: 41 });
  assert.equal(manualPrice.unitPriceSource, 'human');
  assert.equal(manualPrice.matchedProduct?.moq, 100);
  assert.match(manualPrice.pricingExplanation.join('\n'), /价格来源：人工填写/);
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
    customerNameSource: 'whatsapp_profile',
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

test('安全兜底客户名不会进入对外报价回复', () => {
  const draft = buildQuoteDraft({
    customerId: 'customer-5',
    customerName: 'CRM 内部标签：高风险客户',
    customerNameSource: 'safe_fallback',
    customerLanguage: 'English',
    productHint: product.name,
    messages: ['Please quote 500 pcs in 6061-T6'],
    products: [product],
    rules: {},
  });
  const english = composeQuoteReply({ ...draft, status: 'confirmed' });
  const chinese = composeQuoteReply({ ...draft, status: 'confirmed', customerLanguage: '中文' });
  assert.match(english, /^Hi there,/);
  assert.match(chinese, /^您好：/);
  assert.doesNotMatch(english, /CRM 内部标签|高风险客户/);
  assert.doesNotMatch(chinese, /CRM 内部标签|高风险客户/);
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

test('会话更正数量采用最新需求，交货地点不能混入后续付款或贸易术语', () => {
 const draft = buildQuoteDraft({ customerId: 'messenger-buyer', customerName: '', productHint: 'ABS-HOUSING', messages: ['Please quote 100 pcs ABS-HOUSING. Ship to Los Angeles. FOB. Budget is USD 9000.', 'Actually please quote 2000 pcs.'], products: [{ sku: 'ABS-HOUSING', name: 'ABS housing', material: 'ABS', unit: 'pcs', unitPrice: 3.8, currency: 'USD', moq: 1000, leadTime: '30 days', priceSource: 'catalog', attributes: {} }], rules: { paymentTerms: '30% deposit' } });
 assert.equal(draft.quantity, 2000);
 assert.equal(draft.destination, 'Los Angeles');
 assert.equal(draft.subtotal, 7600);
 assert.equal(draft.evidence.find(item => item.field === 'quantity')?.excerpt, '2000 pcs');
});

test('客户更换材料不能沿用目录规格价格，人工改材质也需要重新确认单价', () => {
  const input = { customerId: 'spec-buyer', customerName: '', productHint: product.sku, messages: ['Quote 500 pcs in ABS. Ship to Shanghai. FOB.'], products: [product], rules: { paymentTerms: '30% deposit' } };
  const draft = buildQuoteDraft(input);
  assert.equal(draft.unitPrice, null);
  assert.equal(draft.subtotal, null);
  assert.ok(draft.blockers.some(item => item.includes('材料与目录规格不一致')));
  const original = buildQuoteDraft({ ...input, messages: ['Quote 500 pcs in 6061-T6. Ship to Shanghai. FOB.'] });
  assert.equal(applyQuoteDraftPatch(original, { material: 'ABS' }).unitPrice, null);
  assert.equal(applyQuoteDraftPatch(original, { material: 'ABS', unitPrice: 12 }).unitPrice, 12);
  const implicit = buildQuoteDraft({ ...input, messages: ['Quote 500 pcs. Ship to Shanghai. FOB.'] });
  assert.equal(implicit.material, product.material, 'pcs must not be interpreted as PC plastic');
  assert.equal(implicit.unitPrice, product.unitPrice);
  const corrected = buildQuoteDraft({ ...input, messages: ['Quote 500 pcs in 6061-T6.', 'Actually use ABS.'] });
  assert.equal(corrected.material, 'ABS');
  assert.equal(corrected.unitPrice, null);
});

test('客户更正数量、预算、目的地和贸易术语后以最新需求生成报价', () => {
  const draft = buildQuoteDraft({
    customerId: 'corrected', customerName: 'Buyer', productHint: '待确认', products: [product], rules: {},
    messages: ['Quote 2000 pcs of SKU CNC-6061-01. Destination Germany. FOB. Budget USD 5000. Delivery within 30 days.',
      'Correction: 1500 pcs of SKU CNC-6061-01. Destination is Shanghai. DDP. Budget is USD 6000. Delivery within 45 days.'],
  });
  assert.equal(draft.quantity, 1500);
  assert.equal(draft.destination, 'Shanghai');
  assert.equal(draft.incoterm, 'DDP');
  assert.equal(draft.deliveryDate, '45 days');
  assert.deepEqual(draft.customerBudget, { amount: 6000, currency: 'USD' });
  assert.equal(draft.leadTime, product.leadTime);
});

test('客户明确 FOB 港口待确认时不能直接确认报价，改价格不能解除履约阻塞', () => {
  const draft = buildQuoteDraft({ customerId: 'port', customerName: 'Buyer', products: [product], rules: { paymentTerms: 'deposit' },
    messages: ['Quote 1500 pcs of SKU CNC-6061-01 in 6061-T6. Destination Germany. The named FOB port still needs confirmation.'] });
  assert.equal(draft.status, 'needs_clarification');
  assert.ok(draft.blockers.includes('FOB 指定装运港尚未确认'));
  assert.ok(applyQuoteDraftPatch(draft, { unitPrice: 39 }).blockers.includes('FOB 指定装运港尚未确认'));
  assert.ok(applyQuoteDraftPatch(draft, { unitPrice: 39 }).clarificationQuestions.some(question => question.includes('FOB')));
  const followup = buildQuoteDraft({ customerId: 'fob-followup', customerName: '', productHint: product.sku, products: [product], rules: { paymentTerms: '30% deposit' },
    messages: ['Quote 1500 pcs in 6061-T6. Destination Germany. The named FOB port still needs confirmation.', 'Please acknowledge receipt only.'] });
  assert.ok(followup.blockers.includes('FOB 指定装运港尚未确认'), '无关的后续消息不能解除港口待确认状态');
  for (const wording of ['remains unconfirmed', 'is not confirmed', 'is pending confirmation']) {
    const corrected = buildQuoteDraft({ customerId: 'fob-correction', customerName: '', products: [product], rules: { paymentTerms: 'deposit' },
      messages: ['Quote 1500 pcs of SKU CNC-6061-01 in 6061-T6. Destination Germany. The named FOB port still needs confirmation.',
        `Keep quantity 1500 pcs; the FOB port ${wording}.`, 'Please acknowledge receipt only.'] });
    assert.equal(corrected.status, 'needs_clarification', wording);
    assert.ok(corrected.blockers.includes('FOB 指定装运港尚未确认'), wording);
    assert.ok(applyQuoteDraftPatch(corrected, { unitPrice: 39 }).blockers.includes('FOB 指定装运港尚未确认'), wording);
  }
  for (const destination of ['France', 'Shanghai', 'FOB port', 'Shanghai port unconfirmed']) {
    assert.ok(applyQuoteDraftPatch(draft, { destination }).blockers.includes('FOB 指定装运港尚未确认'), destination);
  }
  assert.ok(!applyQuoteDraftPatch(draft, { destination: 'Shanghai port' }).blockers.includes('FOB 指定装运港尚未确认'));
});

test('客户目标交期不能变为企业参考交期，非履约编辑不能解除阻塞', () => {
  const draft = buildQuoteDraft({ customerId: 'deadline-buyer', customerName: '', productHint: product.sku, messages: ['Quote 500 pcs in 6061-T6. Ship to Shanghai. FOB. Delivery within 7 days.'], products: [{ ...product, leadTime: '' }], rules: { paymentTerms: '30% deposit' } });
  assert.equal(draft.deliveryDate, '7 days');
  assert.equal(draft.leadTime, '');
  assert.ok(draft.blockers.some(item => item.includes('目标交期')));
  assert.ok(applyQuoteDraftPatch(draft, { destination: 'Ningbo' }).blockers.some(item => item.includes('目标交期')));
  assert.equal(applyQuoteDraftPatch(draft, { leadTime: '10 days' }).status, 'ready_for_review');
  const reply = composeQuoteReply({ ...draft, status: 'confirmed' });
  assert.doesNotMatch(reply, /Reference lead time: 7 days/);
  assert.match(reply, /Requested delivery: 7 days/);
});
