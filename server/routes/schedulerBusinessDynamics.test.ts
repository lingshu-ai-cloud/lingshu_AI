import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { currencyForMarket, parseBusinessSignals } from './schedulerBusinessDynamics.js';

test('business market currency mapping remains stable after extraction', () => {
  assert.equal(currencyForMarket('沙特阿拉伯'), 'SAR');
  assert.equal(currencyForMarket('United Kingdom'), 'GBP');
  assert.equal(currencyForMarket('未知市场'), 'USD');
});

test('external intelligence only attaches a declared source and normalizes risk', () => {
  const sources = [{ title: 'Market bulletin', url: 'https://example.com/bulletin', publisher: 'Example', publishedAt: '2026-10-22', market: '沙特' }];
  const result = parseBusinessSignals('reply: {"executiveSummary":"复核报价","signals":[{"sourceIndex":1,"title":"关税动态","risk":"unsupported"},{"sourceIndex":2,"title":"无来源主张","risk":"high"}]}', sources);
  assert.equal(result.summary, '复核报价');
  assert.deepEqual(result.signals.map(signal => ({ title: signal.title, risk: signal.risk, url: signal.sourceUrl })), [
    { title: '关税动态', risk: 'medium', url: 'https://example.com/bulletin' },
  ]);
  assert.deepEqual(parseBusinessSignals('invalid json', sources), { summary: 'invalid json', signals: [] });
});

test('scheduler routes consume the extracted business snapshot without changing endpoint behavior', () => {
  const routes = readFileSync(new URL('./scheduler.ts', import.meta.url), 'utf8');
  assert.match(routes, /import \{ businessDynamicsReport, getBusinessDynamicsSnapshot \} from '\.\/schedulerBusinessDynamics\.js'/);
  assert.match(routes, /const snapshot = await getBusinessDynamicsSnapshot\(tenantId, forceRefresh\)/);
  assert.match(routes, /const snapshot = await getBusinessDynamicsSnapshot\(task\.tenantId, true\)/);
});
