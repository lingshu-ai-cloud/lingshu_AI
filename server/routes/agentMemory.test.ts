import assert from 'node:assert/strict';
import { strategyMemoryToClient } from './agentMemory.js';

const source = {
  id: 'memory-1',
  tenant_id: 'tenant-secret',
  strategy_id: 'qualification',
  adjustment: '先确认采购数量，再讨论方案。',
  evidence_count: '7',
  status: 'active',
  source: 'real_seller_edits',
  scenario: '客户首次询价',
  signals: '["price", "quote"]',
  intent: '确认采购条件',
  strategy_steps: ['确认市场', '确认数量'],
  risk_link: 'L2',
  escalate: '客户要求正式承诺时转人工',
  created: '2026-08-01T00:00:00.000Z',
  updated: '2026-08-16T00:00:00.000Z',
  collectionId: 'must-not-leak',
};

const result = strategyMemoryToClient(source);
assert.deepEqual(result.signals, ['price', 'quote']);
assert.deepEqual(result.strategySteps, ['确认市场', '确认数量']);
assert.equal(result.evidenceCount, 7);
assert.equal('tenant_id' in result, false);
assert.equal('collectionId' in result, false);

console.log('agent memory response mapping: ok');
