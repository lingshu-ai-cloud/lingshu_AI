import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const component = readFileSync(new URL('./DeveloperApiEconomicsCenter.tsx', import.meta.url), 'utf8');
const dashboard = readFileSync(new URL('../AdminDashboard.tsx', import.meta.url), 'utf8');
const route = readFileSync(new URL('../../../server/routes/admin.ts', import.meta.url), 'utf8');

test('developer economics center is mounted only inside the protected admin surface', () => {
  assert.match(dashboard, /DeveloperApiEconomicsCenter/);
  assert.match(dashboard, /API 与积分/);
  assert.match(route, /adminRouter\.use\(requireInternalAdmin\)/);
  assert.match(route, /adminRouter\.get\('\/api-economics'/);
  assert.match(component, /authHeader\(\)/);
  assert.match(component, /平台管理员/);
});

test('developer economics center shows both ledgers and never asks the server for secret values', () => {
  assert.match(component, /USD → CNY → 成本积分试算/);
  assert.match(component, /全系统付费 API 清单/);
  assert.match(component, /用户产品积分价格簿/);
  assert.match(component, /页面不展示任何密钥值/);
  assert.doesNotMatch(component, /apiKey|secretValue|credentialValue/);
});
