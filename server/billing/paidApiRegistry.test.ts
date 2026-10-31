import assert from 'node:assert/strict';
import test from 'node:test';
import { developerApiEconomicsSnapshot, paidApiInventory } from './paidApiRegistry.js';

test('paid API inventory is complete, unique and never exposes credential values', () => {
  const env = {
    OPENAI_API_KEY: 'top-secret-openai',
    DASHSCOPE_API_KEY: 'top-secret-qwen',
    HEYGEN_API_KEY: 'top-secret-heygen',
    HEYGEN_ESTIMATED_CNY_PER_SECOND: '0.8',
  } as NodeJS.ProcessEnv;
  const items = paidApiInventory(env);
  assert.equal(new Set(items.map(item => item.id)).size, items.length);
  for (const id of [
    'openai-responses-images', 'qwen-text-vl-search', 'qwen-speech', 'wan-video',
    'gemini-multimodal', 'google-veo', 'heygen-avatar', 'minimax-speech',
    'seedream-image', 'seedance-video', 'runway-act-two', 'apify-collection',
    'volcengine-assets-voice', 'google-translation',
    'generic-digital-human', 'object-storage', 'un-comtrade',
  ]) assert.ok(items.some(item => item.id === id), `${id} missing`);
  const json = JSON.stringify(items);
  assert.doesNotMatch(json, /top-secret/);
  assert.equal(items.find(item => item.id === 'openai-responses-images')?.credentialState, 'configured');
  assert.equal(items.find(item => item.id === 'gemini-multimodal')?.credentialState, 'missing');
  assert.equal(items.find(item => item.id === 'google-translation')?.credentialState, 'tenant_scoped');
});

test('snapshot exposes both ledgers without converting provider cost into customer charges', () => {
  const snapshot = developerApiEconomicsSnapshot({ HEYGEN_ESTIMATED_CNY_PER_SECOND: '0.8' } as NodeJS.ProcessEnv);
  assert.equal(snapshot.rules.internalCostPointsPerCny, 1_000);
  assert.equal(snapshot.rules.customerProductPointScale, 100);
  assert.match(snapshot.rules.separationRule, /不随供应商或模型切换/);
  assert.equal(
    snapshot.apis.find(item => item.id === 'heygen-avatar')?.estimates[0]?.internalCostPoints,
    800,
  );
  assert.equal(snapshot.productPointRates.find(rate => rate.id === 'weekly-operating-plan')?.points, 3_000);
});
