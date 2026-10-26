import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import EnterpriseAdditionalSettings from './EnterpriseAdditionalSettings';
import type { Profile } from './enterpriseProfileTypes';

const noOp = () => {};
const profile: Profile = {
  company: { name: '', industry: '', mainMarkets: '', founded: '', description: '' },
  products: { categories: '', priceRange: '', moq: '', certifications: '', highlights: '' },
  brand: { tone: '', style: '', taboos: '', usp: '' },
  customers: { commonQuestions: '' },
  faq: [],
  knowledge: '',
};

test('low-frequency enterprise settings stay in one collapsed group', () => {
  const html = renderToStaticMarkup(<EnterpriseAdditionalSettings
    profile={profile}
    orderImporting={false}
    orderImportMessage=""
    onFieldChange={noOp}
    onKnowledgeChange={noOp}
    onImportOrderCsv={noOp}
  />);
  assert.match(html, /enterprise-advanced-collapse/);
  for (const label of ['经营策略', '品牌与语气', 'Agent 学习记录', '订单数据导入']) {
    assert.ok(html.includes(label), `${label} must remain available`);
  }
});

test('parent keeps profile persistence and the existing order import endpoint', () => {
  const page = readFileSync(new URL('../EnterprisePage.tsx', import.meta.url), 'utf8');
  const settings = readFileSync(new URL('./EnterpriseAdditionalSettings.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(page, /<EnterpriseAdditionalSettings/);
  assert.match(page, /<EnterpriseKnowledgeFields/);
  assert.match(page, /else set\(section\)\(field, value\)/);
  assert.match(page, /\/api\/overseas\/enterprise\/orders\/import/);
  assert.match(settings, /accept="\.csv,text\/csv"/);
  assert.match(settings, /disabled=\{orderImporting\}/);
});
