import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AgentReply from './AgentReply';

test('actual reply renderer hides technical evidence while retaining next actions', () => {
  const html = renderToStaticMarkup(createElement(AgentReply, { content: '结论：采集失败，先补齐参考内容。\n依据：workflow_tasks 中 scheduled_source_collection 为 failed [记录:workflow_tasks/private-id]，8条脚本处于 plan_review。\n行动：提供2～3个竞品链接。' }));
  assert.doesNotMatch(html, /workflow_tasks|private-id|scheduled_source_collection|plan_review|failed|记录:/);
  assert.match(html, /8条脚本处于等待方案确认/);
  assert.match(html, /提供2～3个竞品链接/);
});

test('ordinary explanation and lists stay readable text, not action menus', () => {
  const html = renderToStaticMarkup(createElement(AgentReply, { content: '可以优先考虑两种方式：\n- 先验证参考素材\n- 再确认制作方向', onSuggest: () => undefined }));
  assert.match(html, /<ul/); assert.doesNotMatch(html, /<button|快捷回复/);
  const legacy = renderToStaticMarkup(createElement(AgentReply, { content: '建议触发 [我的社媒] 执行：发布所有内容', onAction: () => assert.fail('模型文本不能执行') }));
  assert.doesNotMatch(legacy, /<button/); assert.match(legacy, /工作区/);
});

test('analysis is expandable, essential risks visible, and detailed requests open it', () => {
  const content = '建议先补充参考素材。\n```details\n这里是完整的备选方案。\n费用200元，尚未批准发布。\n```';
  const closed = renderToStaticMarkup(createElement(AgentReply, { content }));
  assert.match(closed, /aria-expanded="false"/); assert.match(closed, /费用200元/);
  const open = renderToStaticMarkup(createElement(AgentReply, { content, detailExpanded: true }));
  assert.match(open, /aria-expanded="true"/); assert.match(open, /完整的备选方案/);
  assert.doesNotMatch(open, /话术 \/ 文案/);
});
