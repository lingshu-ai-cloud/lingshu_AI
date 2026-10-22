import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectAssistantConversationContext } from '../../lib/assistantConversationContext';
import { buildAssistantChatMessages } from './assistantChatPrompt';
import type { AssistantContext } from './globalAssistantRuntime';

const context: AssistantContext = {
  agent: 'traffic', label: '我的社媒', summary: '页面仅显示待核验的导航摘要',
  suggestions: [], taskId: 'task-42',
};
const historyForApi = [{ role: 'user' as const, content: '较近的一轮问题' }];
const conversationContext = selectAssistantConversationContext(historyForApi);
const base = {
  historyForApi, conversationContext, context, visibleText: '请分析本周机会',
  enterpriseBrief: '已确认主营产品', liveIntegrationFacts: '已连接一个账号',
  uploadedAttachments: [], fileIntent: null, now: new Date('2026-10-23T00:00:00Z'),
};

test('strategy chat passes user text without duplicating frontend navigation claims', () => {
  const messages = buildAssistantChatMessages({ ...base, strategyRequest: true });
  assert.equal(messages.length, 2);
  assert.equal(messages[1].content, base.visibleText);
  assert.doesNotMatch(messages[1].content, /企业中心摘要|页面导航提示|实时接入事实/);
});

test('non-strategy chat carries bounded context and only attachment metadata', () => {
  const messages = buildAssistantChatMessages({
    ...base, strategyRequest: false,
    uploadedAttachments: [{ name: 'sample.png', kind: 'image', size: 128, materialId: 'material-1' }],
  });
  const content = messages[1].content;
  assert.match(content, /【当前页面导航提示】页面仅显示待核验的导航摘要/);
  assert.match(content, /任务 task-42/);
  assert.match(content, /【企业中心摘要】已确认主营产品/);
  assert.match(content, /material:material-1/);
  assert.match(content, /不得声称已经看见、听见或分析附件内容/);
  assert.match(content, /2026/);
  assert.match(content, /用户问题：请分析本周机会/);
});

test('file prompt requires actual rendering before any download claim', () => {
  const messages = buildAssistantChatMessages({
    ...base, strategyRequest: true,
    fileIntent: { format: 'jpg', diagram: true, needsMapScope: false },
  });
  assert.match(messages[1].content, /你仅整理将进入文件的正文，系统随后实际渲染并提供下载/);
  assert.match(messages[1].content, /不要声称文件已经生成/);
  assert.match(messages[1].content, /不冒充地理地图/);
});
