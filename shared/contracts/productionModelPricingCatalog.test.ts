import assert from 'node:assert/strict';
import test from 'node:test';
import { estimateQwenVisionUsd, findProductionPriceEntry, PRODUCTION_MODEL_ESTIMATE_SAFETY_FACTOR,
  PRODUCTION_MODEL_PRICE_CATALOG, productionPriceToEstimatedUsd } from './productionModelPricingCatalog.js';

test('production models use reviewed fixed catalogue entries and conservative unit estimates', () => {
  assert.equal(findProductionPriceEntry({ provider: 'wan', model: 'wan2.6-i2v-flash', stage: 'video' })?.meters[0]?.nativePrice, 0.15);
  assert.equal(findProductionPriceEntry({ provider: 'heygen', model: 'orca', stage: 'tts' }), null);
  assert.equal(PRODUCTION_MODEL_PRICE_CATALOG.seedreamPro.meters.find(meter => meter.unit === 'outputImages')?.nativePrice, 0.6);
  assert.equal(productionPriceToEstimatedUsd(PRODUCTION_MODEL_PRICE_CATALOG.wan26Silent720p.meters[0]!), 0.02841);
  assert.equal(PRODUCTION_MODEL_ESTIMATE_SAFETY_FACTOR, 1.25);
});

test('Qwen vision keeps token accounting but freezes tier and buffered USD estimate', () => {
  const low = estimateQwenVisionUsd({ model: 'qwen3-vl-plus', inputTokens: 32_000, outputTokens: 2_000 });
  assert.equal(low.tier.inputCnyPerMillion, 1);
  assert.equal(low.officialCny, 0.052);
  assert.equal(low.estimatedUsd, 0.009849);
  const high = estimateQwenVisionUsd({ model: 'qwen3-vl-plus', inputTokens: 200_000, outputTokens: 4_096 });
  assert.equal(high.tier.inputCnyPerMillion, 3);
  assert.equal(high.estimatedUsd, 0.13691);
  assert.throws(() => estimateQwenVisionUsd({ model: 'qwen3-vl-plus', inputTokens: 300_000, outputTokens: 1 }), /tier_missing/);
});
