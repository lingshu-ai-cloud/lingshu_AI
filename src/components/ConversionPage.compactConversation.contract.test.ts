import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./ConversionPage.tsx', import.meta.url), 'utf8');

test('AI draft suggestion is rendered as a compact editable chat bubble', () => {
  assert.match(source, /data-draft-suggestion className="[^"]*w-fit[^"]*max-w-\[90%\][^"]*rounded-2xl/);
  assert.match(source, /autoSize=\{\{ minRows: 1, maxRows: 6 \}\}/);
  assert.doesNotMatch(source, /autoSize=\{\{ minRows: 4, maxRows: 10 \}\}/);
});

test('customer rail keeps profile facts and expandable work sections', () => {
  assert.match(source, /data-testid="customer-profile-facts"/);
  for (const label of ['关注产品', '客户阶段', '预估价值']) assert.ok(source.includes(label), `missing ${label} profile fact`);
  assert.match(source, /<Collapse[\s\S]*defaultActiveKey=\{\['business'\]\}/);
  for (const label of ['影音内容、文件和链接', '客户与销售工作台', '隐私设置与支持']) assert.ok(source.includes(label), `missing ${label} disclosure`);
});

test('conversation workspace keeps tablet columns and exposes mobile list-chat-profile navigation', () => {
  assert.match(source, /aria-label="会话区域导航"/);
  for (const label of ['会话列表', '当前对话', '客户资料']) assert.ok(source.includes(label), `missing ${label} mobile navigation`);
  assert.match(source, /mobilePanel === 'list' \? ' is-active' : ''/);
  assert.match(source, /mobilePanel === 'chat' \? ' is-active' : ''/);
  assert.match(source, /mobilePanel === 'profile' \? ' is-active' : ''/);
});
