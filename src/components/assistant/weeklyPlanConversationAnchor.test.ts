import assert from 'node:assert/strict';
import test from 'node:test';
import type { Message } from '../../appSession';
import { weeklyPlanConversationAnchor } from './weeklyPlanConversationAnchor';

test('weekly plan card stays after the plan reply when later conversation continues', () => {
  const messages: Message[] = [
    { role: 'user', content: '请帮我创建本周计划' },
    { role: 'assistant', content: '已找到并绑定可用的爆款视频与图文参考。请在同一页核对计划和预算，确认后开始运营。' },
    { role: 'user', content: '再帮我生成图文' },
    { role: 'assistant', content: '已确认，正在生成图文首版。' },
  ];
  assert.equal(weeklyPlanConversationAnchor(messages), 1);
});

test('weekly plan card follows the latest plan reply and never attaches to an unrelated thread', () => {
  const messages: Message[] = [
    { role: 'assistant', content: '已找到并绑定可用的爆款视频与图文参考。请核对计划。' },
    { role: 'assistant', content: '已在当前窗口打开本周计划。请核对预算。' },
  ];
  assert.equal(weeklyPlanConversationAnchor(messages), 1);
  assert.equal(weeklyPlanConversationAnchor([{ role: 'assistant', content: '正在生成图文首版。' }]), -1);
  assert.equal(weeklyPlanConversationAnchor([{ role: 'user', content: messages[0]!.content }]), -1);
});
