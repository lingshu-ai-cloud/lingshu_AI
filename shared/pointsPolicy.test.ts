import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LEGACY_PRODUCT_POINT_PRICE_BOOK_VERSION,
  PRODUCT_FEATURE_POINT_RATES,
  PRODUCT_POINT_SECTIONS,
  pointsForQuantity,
  pointsForSeconds,
  productPointRate,
} from './pointsPolicy.js';

test('product feature seconds use stable user-facing rates', () => {
  assert.equal(pointsForSeconds(productPointRate('digital-human-video'), 8), 43_200);
  assert.equal(pointsForSeconds(productPointRate('aigc-video-generation'), 5), 40_000);
  assert.equal(pointsForSeconds(productPointRate('material-library-reuse'), 17), 0);
});

test('non-video functions settle by successful product output instead of model calls', () => {
  assert.equal(pointsForQuantity(productPointRate('weekly-operating-plan'), 1), 3_000);
  assert.equal(pointsForQuantity(productPointRate('reply-draft-generation'), 3), 900);
  assert.equal(pointsForQuantity(productPointRate('knowledge-document-structuring'), 2), 2_000);
  assert.throws(() => pointsForQuantity(productPointRate('business-diagnosis'), -1), /invalid_points_quantity/);
});

test('legacy reservations remain pinned to the v1 price book', () => {
  assert.equal(pointsForQuantity(productPointRate('weekly-operating-plan', LEGACY_PRODUCT_POINT_PRICE_BOOK_VERSION), 1), 30);
  assert.equal(pointsForSeconds(productPointRate('digital-human-video', LEGACY_PRODUCT_POINT_PRICE_BOOK_VERSION), 8), 432);
});

test('visible pricing is organized by product section and contains no provider dimension', () => {
  assert.deepEqual(PRODUCT_POINT_SECTIONS.map(section => section.id), [
    'business_operations',
    'insight_planning',
    'content_production',
    'traffic_growth',
    'customer_service',
    'knowledge_assistant',
  ]);
  assert.equal(new Set(PRODUCT_FEATURE_POINT_RATES.map(rate => rate.id)).size, PRODUCT_FEATURE_POINT_RATES.length);
  assert.equal(PRODUCT_FEATURE_POINT_RATES.filter(rate => rate.id === 'material-library-reuse' && rate.current).length, 1);
  for (const section of PRODUCT_POINT_SECTIONS) {
    assert.ok(PRODUCT_FEATURE_POINT_RATES.some(rate => rate.section === section.id), `${section.label} must have at least one priced product function`);
  }
  assert.equal(PRODUCT_FEATURE_POINT_RATES.some(rate => 'provider' in rate || 'service' in rate || 'mode' in rate), false);
});
