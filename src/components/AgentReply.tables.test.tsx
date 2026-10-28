import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import AgentReply from './AgentReply';
import { readAssistantMarkdownTable } from '../../shared/assistantMarkdownTable';
import { splitAssistantReply } from '../../shared/assistantReadableReply';

const broken = '平台 | 本周已发布 | 待发布\n| --- | --- | --- |\n\nInstagram | 0条 | 4条\n\nTikTok | 0条 | 3条';
test('optional edge pipes and blank lines render all business rows within one real table', () => {
  const html = renderToStaticMarkup(<AgentReply content={broken} presentation="operations"/>);
  assert.equal((html.match(/<table /gu) ?? []).length,1);
  assert.equal((html.match(/<tbody><tr/gu) ?? []).length,1);
  assert.equal((html.match(/<td /gu) ?? []).length,6);
  for (const text of ['Instagram','TikTok','4条','3条']) assert.ok(html.includes(text));
  assert.doesNotMatch(html,/<p[^>]*>[^<]*\|/u);
});
test('presentation folding never separates headers from long data rows or truncates cells at full stops', () => {
  const longCell = '已完成素材准备。仍等待企业确认选题与上线时间。'.repeat(25);
  const content = `当前状态：\n本周任务等待确认。\n\n| 事项 | 状态 |\n| --- | --- |\n| 素材准备 | ${longCell} |\n| 发布安排 | 尚未发布。先确认渠道。 |`;
  for (const presentation of ['operations','analytics'] as const) {
    const parts = splitAssistantReply(content,{presentation});
    assert.equal(parts.summary,content); assert.deepEqual(parts.details,[]);
    const html = renderToStaticMarkup(<AgentReply content={content} presentation={presentation}/>);
    assert.match(html,/尚未发布。先确认渠道。/);
    assert.match(html,/已完成素材准备。仍等待企业确认选题与上线时间。/);
    assert.equal((html.match(/<table /gu) ?? []).length,1);
  }
});
test('streamed row can omit its last pipe and unfinished table shows a single in-table placeholder', () => {
  const initial = '| 平台 | 状态 |\n| --- | --- |';
  const pending = renderToStaticMarkup(<AgentReply content={initial}/>);
  assert.match(pending,/表格内容整理中/);
  const html = renderToStaticMarkup(<AgentReply content={`${initial}\n| TikTok | 连接中`}/>);
  assert.match(html,/<td[^>]*>TikTok<\/td>/); assert.match(html,/连接中/);
  assert.doesNotMatch(html,/表格内容整理中/);
});
test('escaped pipes stay inside cells and prose with a literal pipe is never guessed into a table', () => {
  const parsed = readAssistantMarkdownTable(['| 对象 | 内容 |','| --- | --- |','| 产品 | A \\| B |'],0)!;
  assert.deepEqual(parsed.rows,[['产品','A | B']]);
  const html = renderToStaticMarkup(<AgentReply content="可以选择 A | B，之后确认。"/>);
  assert.doesNotMatch(html,/<table/); assert.match(html,/A \| B/);
});
test('operations drops its two workspace buttons while unrelated navigation and draft suggestions remain', () => {
  const operations = renderToStaticMarkup(<AgentReply content="本周尚未发布，先确认排期。" presentation="operations"/>);
  assert.doesNotMatch(operations,/查看经营总览|查看内容任务|相关工作区/);
  const analytics = renderToStaticMarkup(<AgentReply content="本周有三条询盘。" presentation="analytics"/>);
  assert.match(analytics,/打开经营总览/);
  const content = renderToStaticMarkup(<AgentReply content="准备制作内容。" presentation="content"/>);
  assert.match(content,/打开内容制作/);
});

const recoveredBusinessCheck = "| 维度         | 状态   | 依据说明 |\n|--------------|--------|----------|\n| **账号连接** | 阻塞   | `social_accounts` 与 `youtube_accounts` 均为空数组；无任一平台账号完成授权或绑定。 |\n| **内容供给** | 需关注 | 共 6 条内容任务在 `starter_social_content_tasks` 中，其中 2 条卡在 `asset_review`（素材审核中），1 条 `producing`（制作中），3 条 `plan_review`（方案待审）；但**无已通过审核的成品内容**。 |\n| **发布节奏** | 阻塞   | `starter_social_publications` 记录数为 0；无任何内容完成发布登记，**尚未迈出公域触达第一步**。 |\n| **询盘处理** | 阻塞   | `starter_quote_inquiries` 扫描记录数为 0；**本周无报价类询盘流入，无待处理线索**。 |\n| **客户跟进** | 阻塞   | `customers.authorizedReturnedProfiles: 0`，`usableLiveProfiles: 0`；**无已授权客户档案，WhatsApp 私域承接无法启动**。 |\n| **投放状态** | 阻塞   | `ads.taskCount: 0`，无投流任务同步；**未配置广告计划，无预算、无渠道、无曝光数据**。 |";
test('the exact recovered business-check table renders all six historical rows instead of an empty header and loose pipes', () => {
  const parts = splitAssistantReply(recoveredBusinessCheck,{presentation:'operations'});
  assert.equal(parts.summary,recoveredBusinessCheck);
  assert.deepEqual(parts.details,[]);
  const html = renderToStaticMarkup(<AgentReply content={recoveredBusinessCheck} presentation="operations"/>);
  assert.equal((html.match(/<table /gu) ?? []).length,1);
  assert.equal((html.match(/<td /gu) ?? []).length,18);
  for (const text of ['账号连接','内容供给','发布节奏','询盘处理','客户跟进','投放状态']) assert.ok(html.includes(text),text);
  assert.doesNotMatch(html,/<p[^>]*>[^<]*\||表格内容整理中|查看经营总览|查看内容任务/u);
});
