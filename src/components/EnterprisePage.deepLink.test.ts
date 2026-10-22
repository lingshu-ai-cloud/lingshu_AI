import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { resolveEnterpriseProductsDeepLink } from './EnterprisePage.js';

test('enterprise product deep-link only resolves a unique exact product name', () => {
  const deepLink = { productName: '精华液 A', materialIds: ['asset-1'], contentItemId: 'content-1' };
  assert.deepEqual(resolveEnterpriseProductsDeepLink([{ name: '面霜 B' }, { name: '精华液 A' }], deepLink), {
    productIndex: 1,
    reason: 'exact_unique',
  });
  assert.deepEqual(resolveEnterpriseProductsDeepLink([{ name: '精华液 A' }, { name: '精华液 A' }], deepLink), {
    productIndex: null,
    reason: 'ambiguous',
  });
  assert.deepEqual(resolveEnterpriseProductsDeepLink([{ name: '精华液升级款' }], deepLink), {
    productIndex: null,
    reason: 'not_found',
  });
});

test('application passes sanitized task context and enterprise page explains material fallback honestly', () => {
  const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  const pageSlotSource = readFileSync(new URL('../AppPageSlot.tsx', import.meta.url), 'utf8');
  const enterpriseSource = readFileSync(new URL('./EnterprisePage.tsx', import.meta.url), 'utf8');
  const productPanelSource = readFileSync(new URL('./enterprise/EnterpriseProductPanel.tsx', import.meta.url), 'utf8');
  assert.match(appSource, /normalizeEnterpriseProductsDeepLink\(detail\)/);
  assert.match(appSource, /<AppPageSlot[^>]*enterpriseProductsDeepLink/s);
  assert.match(pageSlotSource, /<EnterprisePage productsDeepLink=\{enterpriseProductsDeepLink\}/);
  assert.match(enterpriseSource, /setKnowledgeView\('products'\)/);
  assert.match(enterpriseSource, /setProductPage\(Math\.floor\(productIndex \/ PAGE_SIZE\) \+ 1\)/);
  assert.match(enterpriseSource, /<EnterpriseProductPanel[\s\S]*?productsDeepLink=\{productsDeepLink\}/);
  assert.match(productPanelSource, /不会把素材 ID 伪装成页内文件定位/);
  assert.match(productPanelSource, /未能可靠定位任务产品/);
  assert.match(productPanelSource, /data-content-item-id=\{productsDeepLink\.contentItemId/);
});

test('enterprise facts page omits deprecated social discovery fields and explanations', () => {
  const enterpriseSource = readFileSync(new URL('./EnterprisePage.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(enterpriseSource, /<Field label="海外平台经验">/);
  assert.doesNotMatch(enterpriseSource, /社媒发现范围不在企业中心重复维护/);
});
