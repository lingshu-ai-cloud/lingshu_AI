import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

test('报价能力保持嵌入客服会话且禁止自动发送', () => {
  const card = read('src/components/customers/QuoteSkillCard.tsx');
  const conversion = read('src/components/ConversionPage.tsx');
  const conversationSkill = read('src/components/customers/ConversationQuoteSkill.tsx');
  const api = read('src/lib/quoteSkillApi.ts');
  assert.match(conversion, /<ConversationQuoteSkill[\s\S]*?customer=/, '报价能力必须嵌入当前会话');
  assert.match(conversationSkill, /<QuoteSkillCard[\s\S]*?onInsertReply=/, '会话报价入口必须把回复写回当前编辑框');
  assert.doesNotMatch(conversion, /报价中心|quote-center|page=quote/i, '不得增加独立报价入口');
  assert.match(card, /正式报价属于 L4 高风险动作，系统不会自动发送/, '界面必须明确人工确认边界');
  assert.match(card, /quoteSkillApi\.confirm\(draft\.id, draft\.revision\)/, '确认必须携带当前版本');
  assert.match(card, /onInsertReply\(result\.reply\)/, '报价回复只能进入编辑框');
  assert.doesNotMatch(card, /onSend|sendReply|sendMessage|fetch\([^)]*whatsapp/i, '报价卡不得调用发送动作');
  assert.match(api, /expectedRevision/, '报价更新必须使用乐观并发版本');
});
