import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { quoteCardSvg, quoteNumber, renderQuoteCard } from './card.js';
import type { QuoteSkillDraft } from './types.js';

function draft(): QuoteSkillDraft {
  return {
    schemaVersion: 1,
    revision: 3,
    version: 2,
    id: 'quote-card-test',
    customerId: 'buyer-1',
    customerName: 'Alex Morgan',
    customerNameSource: 'whatsapp_profile',
    customerLanguage: '中文',
    sellerName: 'Acme Manufacturing',
    status: 'confirmed',
    intentScore: 90,
    productName: 'CNC aluminum bracket',
    sku: 'CAB-6061',
    quantity: 500,
    unit: '件',
    material: '6061-T6 aluminum',
    deliveryDate: '',
    destination: 'Los Angeles',
    incoterm: 'FOB',
    packaging: 'Export cartons',
    drawingVersion: 'B2',
    unitPrice: 12,
    currency: 'USD',
    subtotal: 6000,
    leadTime: '20 days',
    paymentTerms: '30% deposit, balance before shipment',
    validityDays: 15,
    missingFields: [],
    blockers: [],
    evidence: [],
    matchedProduct: null,
    pricingExplanation: [],
    clarificationQuestions: [],
    humanConfirmationRequired: true,
    confirmedBy: 'user-1',
    confirmedAt: '2026-09-14T08:00:00.000Z',
    createdAt: '2026-09-14T07:00:00.000Z',
    updatedAt: '2026-09-14T08:00:00.000Z',
  };
}

test('报价图片卡默认使用英文客户文案并输出标准 PNG', async () => {
  const input = draft();
  const svg = quoteCardSvg(input);
  assert.match(svg, />QUOTATION</);
  assert.match(svg, />CONFIRMED QUOTATION</);
  assert.match(svg, />500 pcs</);
  assert.doesNotMatch(svg, />报价单</);
  const safeFallbackSvg = quoteCardSvg({ ...input, customerName: 'Alex · 内部重点跟进', customerNameSource: 'safe_fallback' });
  assert.match(safeFallbackSvg, />Customer</);
  assert.doesNotMatch(safeFallbackSvg, /内部重点跟进/);
  assert.equal(quoteNumber(input), 'QT-20260914-879595');

  const bytes = await renderQuoteCard(input);
  const metadata = await sharp(bytes).metadata();
  assert.equal(metadata.format, 'png');
  assert.equal(metadata.width, 1200);
  assert.equal(metadata.height, 900);
});
