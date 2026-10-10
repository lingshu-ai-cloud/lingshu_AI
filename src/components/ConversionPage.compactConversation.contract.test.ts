import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./ConversionPage.tsx', import.meta.url), 'utf8');

test('AI draft suggestion is rendered as a compact editable chat bubble', () => {
  assert.match(source, /data-draft-suggestion className="[^"]*w-fit[^"]*max-w-\[90%\][^"]*rounded-2xl/);
  assert.match(source, /autoSize=\{\{ minRows: 1, maxRows: 6 \}\}/);
  assert.doesNotMatch(source, /autoSize=\{\{ minRows: 4, maxRows: 10 \}\}/);
});

test('customer rail exposes four profile-style quick actions with expandable details', () => {
  assert.match(source, /aria-label="客户快捷操作"/);
  for (const label of ['分享', '客户主页', '关闭通知', '搜索']) assert.ok(source.includes(label), `missing ${label} quick action`);
  assert.match(source, /role="region" aria-label="客户快捷详情"/);
  assert.match(source, /quickPanel === 'share'/);
  assert.match(source, /quickPanel === 'profile'/);
  assert.match(source, /quickPanel === 'notifications'/);
  assert.match(source, /quickPanel === 'search'/);
});
