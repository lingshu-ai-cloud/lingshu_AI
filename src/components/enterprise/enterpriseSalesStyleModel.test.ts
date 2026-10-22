import assert from 'node:assert/strict';
import test from 'node:test';
import type { SalesStyleProfile } from './enterpriseProfileTypes';
import { deleteSalesStyleField, deleteTabooPhrases, updateSalesStyleField, updateTabooPhrases } from './enterpriseSalesStyleModel';

const original: SalesStyleProfile = {
  learnedFromCount: 3,
  greeting_style: { value: '您好', evidence: '真实回复 #1', manual: false },
  taboo_phrases: { value: ['最低价'], evidence: '审核记录', manual: false },
  sample_pairs: [{ trigger: '价格？', final: '请告知数量。' }],
};

test('manual style edit retains evidence and does not mutate the learned profile', () => {
  const updated = updateSalesStyleField(original, 'greeting_style', '您好，欢迎咨询');
  assert.deepEqual(updated.greeting_style, { value: '您好，欢迎咨询', evidence: '真实回复 #1', manual: true });
  assert.equal(updated.learnedFromCount, 3);
  assert.equal(original.greeting_style?.value, '您好');
  assert.equal(deleteSalesStyleField(updated, 'greeting_style').greeting_style, undefined);
  assert.equal(updated.greeting_style?.manual, true);
});

test('taboo phrase edit normalizes separators, retains evidence, and deletion is explicit', () => {
  const updated = updateTabooPhrases(original, '最低价，马上下单\n保证交期、  ');
  assert.deepEqual(updated.taboo_phrases, {
    value: ['最低价', '马上下单', '保证交期'], evidence: '审核记录', manual: true,
  });
  assert.equal(deleteTabooPhrases(updated).taboo_phrases, undefined);
  assert.deepEqual(original.taboo_phrases?.value, ['最低价']);
});
