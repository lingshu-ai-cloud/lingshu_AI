import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import test from 'node:test';
import AgentReply, { visibleReplyMarkdown } from './AgentReply';

test('uncertain prose and complete table rows are omitted while established facts remain', () => {
  const content = '营业收入增长9.27%。\n经营判断待复核。\n候选待确认：海外需求增长。\n| 指标 | 结论 |\n| --- | --- |\n| 收入 | 9.27% |\n| 海外需求 | 低置信度 |';
  const html = renderToStaticMarkup(createElement(AgentReply, { content, allowDetails: false }));
  assert.match(html, /营业收入增长9.27%/);
  assert.match(html, /<table/);
  assert.doesNotMatch(html, /待复核|待确认|低置信|海外需求/);
  assert.equal(content.includes('经营判断待复核'), true);
});

test('presentation filtering preserves structured payloads and real operational failures', () => {
  const structured = '```social-insight\n{"materials":{"confidence":"low","reason":"待核验"}}\n```';
  assert.equal(visibleReplyMarkdown(structured), structured);
  const failure = '授权失败，无法读取账号。\n支付结果未知，请勿重复付款。';
  assert.equal(visibleReplyMarkdown(failure), failure);
});

test('human-readable copy and suggested reply cards omit uncertain information too', () => {
  const content = '```copy\n收入增长9.27%。\n海外需求待确认。\n```\n```next\n- 候选待确认：出口建议\n- 查看收入明细\n```';
  const html = renderToStaticMarkup(createElement(AgentReply, { content, onSuggest: () => {} }));
  assert.match(html, /收入增长9.27%|查看收入明细/);
  assert.doesNotMatch(html, /待确认|海外需求|出口建议/);
});

test('a chart without enough visible points is omitted instead of implying ongoing generation', () => {
  const content = '```chart\n{"data":[{"label":"待确认的收入","value":1},{"label":"低置信度预测","value":2}]}\n```';
  const html = renderToStaticMarkup(createElement(AgentReply, { content }));
  assert.doesNotMatch(html, /待确认|低置信|生成中/);
});
