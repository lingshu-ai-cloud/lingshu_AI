import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import EnterpriseBizRulesPanel from './EnterpriseBizRulesPanel';

const noOp = () => {};

test('quotation boundary and shared product documents remain explicit', () => {
  const html = renderToStaticMarkup(<EnterpriseBizRulesPanel
    bizRules={{ quoteMode: 'human_only', bargainPolicy: 'limited', priceRange: '$5 - $500', moq: '50 件', samplePolicy: '', paymentTerms: '', leadTime: '' }}
    products={[{ name: '精华液 A', documents: [{ name: '检测报告.pdf', type: 'application/pdf', size: 100, updatedAt: '2026-10-22' }] }]}
    completed={false}
    highlighted={false}
    onChange={noOp}
  />);
  assert.match(html, /等待人工报价/);
  assert.match(html, /AI 不回复价格，也不发送/);
  assert.match(html, /不会自动发给客户/);
  assert.match(html, /检测报告\.pdf/);
  assert.match(html, /同一文件不重复上传/);
  assert.match(html, /有限让步/);
});

test('page owns business-rule mutation and persistence', () => {
  const page = readFileSync(new URL('../EnterprisePage.tsx', import.meta.url), 'utf8');
  const lifecycle = readFileSync(new URL('./useEnterpriseProfileLifecycle.ts', import.meta.url), 'utf8');
  assert.match(page, /const setBizRule = \(field: keyof BizRules, value: string\)/);
  assert.match(page, /<EnterpriseBizRulesPanel[\s\S]*?bizRules=\{profile\.bizRules\}[\s\S]*?onChange=\{setBizRule\}/);
  assert.match(page, /useEnterpriseProfileLifecycle\(/);
  assert.match(lifecycle, /const handleSave = async/);
});
