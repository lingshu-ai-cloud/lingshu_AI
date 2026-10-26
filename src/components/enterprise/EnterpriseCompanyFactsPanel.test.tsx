import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import EnterpriseCompanyFactsPanel from './EnterpriseCompanyFactsPanel';

test('company and market facts retain the three required company fields', () => {
  const html = renderToStaticMarkup(<EnterpriseCompanyFactsPanel
    company={{ name: '示例企业', industry: '机械设备', companyType: '工厂', mainMarkets: '北美', primaryLanguages: '英语', founded: '', description: '' }}
    marketCompleted={true}
    companyCompleted={true}
    highlighted={false}
    onFieldChange={() => {}}
  />);
  for (const label of ['企业基本资料', '公司名称', '行业类目', '企业类型', '主营业务', '公司简介（选填）']) {
    assert.ok(html.includes(label));
  }
  assert.doesNotMatch(html, /成立年份|目标市场与语言/);
});

test('parent still owns the company profile and save state', () => {
  const page = readFileSync(new URL('../EnterprisePage.tsx', import.meta.url), 'utf8');
  assert.match(page, /<EnterpriseCompanyFactsPanel[\s\S]*?company=\{profile\.company\}/);
  assert.match(page, /onFieldChange=\{set\('company'\)\}/);
  assert.match(page, /useEnterpriseProfileLifecycle\(/);
});
