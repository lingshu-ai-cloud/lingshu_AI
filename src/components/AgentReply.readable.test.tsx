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

test('source footer and legacy source cards are quietly collapsed, independently of expanded analysis', () => {
  const content = '分析结果。\n\n总体结论：可用于初步估算，实际结算需核验银行报价。\n\n信息来源（查询时间：2026/10/25 06:45:25，北京时间）：\n- [每日参考汇率](https://www.exchangerate-api.com)';
  const sources = [{ title: '每日参考汇率', uri: 'https://www.exchangerate-api.com' }];
  const html = renderToStaticMarkup(createElement(AgentReply, { content, sources, detailExpanded: true }));
  assert.match(html, /总体结论/); assert.match(html, /数据和信息来源/);
  assert.match(html, /aria-expanded="false"/); assert.doesNotMatch(html, /每日参考汇率|06:45:25|参考来源/);
  const legacy = renderToStaticMarkup(createElement(AgentReply, { content: '总体结论：本轮资料尚未核验，不能据此确认最新动态。', sources }));
  assert.match(legacy, /数据和信息来源/); assert.doesNotMatch(legacy, /每日参考汇率/);
});

test('source-like text in code is preserved; no-source replies do not gain an empty disclosure', async () => {
  const { splitReplySourceFooter } = await import('./AgentReply');
  const code = '```copy\n信息来源（查询时间：示例）：\n正文示例\n```';
  assert.equal(splitReplySourceFooter(code).body, code);
  const html = renderToStaticMarkup(createElement(AgentReply, { content: '总体结论：任务等待人工处理。' }));
  assert.doesNotMatch(html, /数据和信息来源/);
});

test('fixed bare source links are actionable inside expanded details', () => {
  const content = '已找到官方动态。\n```details\n固定采集栏目：https://personal-care-hygiene.basf.com/global/de/news-releases、https://www.fda.gov/cosmetics/cosmetics-news-events、https://about.fb.com/news/tag/reels/\n```';
  const html = renderToStaticMarkup(createElement(AgentReply, { content, detailExpanded: true }));
  assert.match(html, /aria-label="打开原文：BASF 个护原料"/);
  assert.match(html, /href="https:\/\/www.fda.gov\/cosmetics\/cosmetics-news-events"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.doesNotMatch(html, /视频预览|<iframe|<video/);
});

test('details inherit source trust and video previews load only after a click', () => {
  const content = '有一条参考视频。\n```details\n[发布会视频](https://media.example/event.mp4)\n```';
  const sources = [{ title: '发布会视频', uri: 'https://media.example/event.mp4' }];
  const html = renderToStaticMarkup(createElement(AgentReply, { content, sources, detailExpanded: true }));
  assert.match(html, /aria-label="打开原文：发布会视频"/);
  assert.match(html, /aria-label="预览视频：发布会视频"/);
  assert.doesNotMatch(html, /<iframe|<video/);
  const untrusted = renderToStaticMarkup(createElement(AgentReply, { content, detailExpanded: true }));
  assert.doesNotMatch(untrusted, /href=|视频预览/);
});
