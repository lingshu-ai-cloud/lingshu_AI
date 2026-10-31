import assert from 'node:assert/strict';
import test from 'node:test';
import { safeMetaIssueText } from './metaIssueText.js';

test('provider issue details stay concise and do not expose URLs or credentials', () => {
  assert.equal(safeMetaIssueText('付款异常 https://example.test/?access_token=secret'), '付款异常 [链接]');
  assert.equal(safeMetaIssueText('access_token=secret\n需要处理'), '[已隐藏] 需要处理');
  assert.equal(safeMetaIssueText(null), '');
  assert.equal(safeMetaIssueText('x'.repeat(400)).length, 300);
});
