import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./ConversionPage.tsx', import.meta.url), 'utf8');
const chatSource = readFileSync(new URL('./customers/ConversionChatThread.tsx', import.meta.url), 'utf8');
const creatorStyles = readFileSync(new URL('../styles/creator-workspace.css', import.meta.url), 'utf8');
const railSource = readFileSync(new URL('./customers/ConversionCustomerRail.tsx', import.meta.url), 'utf8');

test('AI draft suggestion is rendered as a compact editable chat bubble', () => {
  assert.match(chatSource, /data-draft-suggestion className="[^"]*w-fit[^"]*max-w-\[90%\][^"]*rounded-2xl/);
  assert.match(chatSource, /autoSize=\{\{ minRows: 1, maxRows: 6 \}\}/);
  assert.doesNotMatch(chatSource, /autoSize=\{\{ minRows: 4, maxRows: 10 \}\}/);
});

test('conversation chrome stays concise and readable in the dark workspace', () => {
  assert.doesNotMatch(chatSource, /只在演示沙盘里推进，不会发送到真实平台。/);
  assert.doesNotMatch(chatSource, /报价知识尚未完善，价格相关内容需人工确认。/);
  assert.match(chatSource, /isBuyer \? 'text-text-primary' : 'text-white'/);
  assert.match(chatSource, /isBuyer \? 'border-border-bright text-text-secondary' : 'border-white\/20 text-white\/80'/);
  assert.match(railSource, /flex min-w-0 flex-1 flex-col gap-1[\s\S]{0,500}data-testid="large-order-warning-tag"/);
  assert.match(creatorStyles, /data-lingshu-appearance='dark'[\s\S]*\.ls-messenger-bubble--inbound\s*\{[^}]*background:\s*var\(--color-surface-2\);[^}]*color:\s*var\(--color-text-primary\);/);
});

test('customer rail keeps profile facts and expandable work sections', () => {
  assert.match(railSource, /data-testid="customer-profile-facts"/);
  for (const label of ['跟进', '需求', '归因', 'CustomerProfileTags', '客户画像与跟进依据']) assert.ok(railSource.includes(label), `missing ${label}`);
  assert.match(railSource, /Avatar size=\{32\}/);
  assert.ok(railSource.includes('AI 回复'));
  for (const label of ['影音内容、文件和链接', '客户与销售工作台', '隐私设置与支持']) assert.ok(!railSource.includes(label), `removed ${label} disclosure`);
  assert.doesNotMatch(source, /<CustomerWorkspaceTools/);

});

test('conversation workspace keeps tablet columns and exposes mobile list-chat-profile navigation', () => {
  assert.match(source, /aria-label="会话区域导航"/);
  for (const label of ['会话列表', '当前对话', '客户资料']) assert.ok(source.includes(label), `missing ${label} mobile navigation`);
  assert.match(source, /mobilePanel === 'list' \? ' is-active' : ''/);
  assert.match(source, /mobilePanel === 'chat' \? ' is-active' : ''/);
  assert.match(source, /mobilePanel === 'profile' \? ' is-active' : ''/);
});
