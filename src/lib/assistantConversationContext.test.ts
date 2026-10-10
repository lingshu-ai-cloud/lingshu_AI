import assert from 'node:assert/strict';
import { selectAssistantConversationContext, renderAssistantConversationBoundary } from './assistantConversationContext';

const history = [
  { role: 'assistant' as const, content: '启动提示，不是回答' },
  { role: 'user' as const, content: '以后预算上限 2000 元，禁止自动发布。' },
  { role: 'assistant' as const, content: '未经核验的猜测：客户已经成交' },
  { role: 'user' as const, content: '这次预算改为 1000 元' },
  { role: 'assistant' as const, content: '需要继续核验' },
];
const selected = selectAssistantConversationContext(history, { maxTurns: 1 });
assert.deepEqual(selected.messages, history.slice(3));
assert.deepEqual(selected.retainedUserInstructions, [history[1].content]);
assert.equal(selected.omittedTurns, 1);
assert.match(renderAssistantConversationBoundary(selected), /以近期输入为准/);
assert.doesNotMatch(renderAssistantConversationBoundary(selected), /客户已经成交/);
assert.deepEqual(selectAssistantConversationContext(history, { maxCharacters: 1 }).messages, []);
assert.deepEqual(selectAssistantConversationContext(history, { maxTurns: 0, instructionCharacters: 1 }).retainedUserInstructions, []);
const longUser = '不要删除资料。'.repeat(200);
assert.equal(selectAssistantConversationContext([{ role: 'user', content: longUser }]).messages[0].content, longUser);
const interrupted = selectAssistantConversationContext([
  { role: 'user', content: '正在做什么？' },
  { role: 'assistant', content: '请求失败，请稍后重试。' },
  { role: 'user', content: '重试' },
]);
assert.deepEqual(interrupted.messages.map(message => message.role), ['user', 'user']);
assert.equal(history[1].content, '以后预算上限 2000 元，禁止自动发布。');
// Simulate a long-lived workspace: storage grows while per-answer context stays bounded.
const longHistory = Array.from({ length: 300 }, (_, index) => [
  { role: 'user' as const, content: index === 0 ? '以后只允许英语，禁止自动发布。' : `第${index}轮：查看制作进度。` },
  { role: 'assistant' as const, content: `第${index}轮记录：` + '旧任务过程。'.repeat(50) },
]).flat();
const longContext = selectAssistantConversationContext(longHistory);
assert.equal(longContext.omittedTurns, 294);
assert.equal(longContext.messages.length, 12);
assert.ok(longContext.messages.reduce((sum, item) => sum + item.content.length, 0) <= 12000);
assert.deepEqual(longContext.retainedUserInstructions, ['以后只允许英语，禁止自动发布。']);
assert.equal(longHistory.length, 600);
console.log('assistant conversation context tests passed');
