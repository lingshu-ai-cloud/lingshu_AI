import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import EnterpriseSalesStylePanel from './EnterpriseSalesStylePanel';
import type { useEnterpriseSalesStyle } from './useEnterpriseSalesStyle';

const noOp = () => {};
const controller: ReturnType<typeof useEnterpriseSalesStyle> = {
  styleDistilling: false,
  styleMessage: '',
  updateSalesStyleField: noOp,
  deleteSalesStyleField: noOp,
  updateTabooPhrases: noOp,
  deleteTabooPhrases: noOp,
  distillSalesStyle: async () => {},
};

test('learned evidence, manual lock, taboo phrases and samples remain visible', () => {
  const html = renderToStaticMarkup(<EnterpriseSalesStylePanel controller={controller} styleProfile={{
    learnedFromCount: 3,
    greeting_style: { value: '您好', evidence: '真实回复 #1', manual: true },
    taboo_phrases: { value: ['最低价', '保证交期'], evidence: '审核记录', manual: true },
    sample_pairs: [{ trigger: '价格？', final: '请告知数量。' }],
  }} />);
  assert.match(html, /3 次真实回复/);
  assert.match(html, /人工锁定/);
  assert.match(html, /真实回复 #1/);
  assert.match(html, /最低价，保证交期/);
  assert.match(html, /买家：价格？/);
  assert.match(html, /定稿：请告知数量。/);
});

test('learning state remains in parent controller across tab changes', () => {
  const page = readFileSync(new URL('../EnterprisePage.tsx', import.meta.url), 'utf8');
  const hook = readFileSync(new URL('./useEnterpriseSalesStyle.ts', import.meta.url), 'utf8');
  assert.match(page, /const salesStyle = useEnterpriseSalesStyle\(/);
  assert.ok(page.indexOf('const salesStyle = useEnterpriseSalesStyle(') < page.indexOf("knowledgeView === 'salesStyle'"));
  assert.match(page, /<EnterpriseSalesStylePanel styleProfile=\{profile\.salesStyleProfile\} controller=\{salesStyle\}/);
  assert.match(hook, /\/api\/overseas\/enterprise\/style-profile\/distill/);
});
