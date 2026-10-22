import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { AUTO_REPLY_SCOPE, EnterpriseAiAutonomySection, EnterpriseHandoffSafetySection } from './EnterpriseCustomerServiceSettings';

const noOp = () => {};

test('blocked automatic reply stays visually disabled and falls back to draft', () => {
  const html = renderToStaticMarkup(<EnterpriseAiAutonomySection
    autonomyHighlight={false}
    effectiveAutonomy="draft"
    configuredAutonomy="auto"
    customerServiceEnabled={true}
    customerServiceObservationFinished={true}
    partialAutoReplyAuthorized={false}
    canAutoReply={false}
    autoReplyBlockReason="请先确认部分直接回复"
    approvedFaqCount={2}
    setAutonomy={noOp}
  />);
  assert.match(html, /当前：草稿需确认/);
  assert.match(html, /请先确认部分直接回复，当前按“草稿需确认”执行/);
  assert.match(html, /已审批 2 条 · 启用要求 5 条/);
  assert.match(html, /<button[^>]*title="请先确认部分直接回复"[^>]*disabled=""[^>]*>[\s\S]*?已审批问答自动回/);
});

test('automatic reply boundaries remain explicit when eligible', () => {
  const html = renderToStaticMarkup(<EnterpriseAiAutonomySection
    autonomyHighlight={false}
    effectiveAutonomy="auto"
    configuredAutonomy="auto"
    customerServiceEnabled={true}
    customerServiceObservationFinished={true}
    partialAutoReplyAuthorized={true}
    canAutoReply={true}
    autoReplyBlockReason=""
    approvedFaqCount={5}
    setAutonomy={noOp}
  />);
  assert.equal(AUTO_REPLY_SCOPE.length, 3);
  for (const condition of AUTO_REPLY_SCOPE) assert.ok(html.includes(condition));
  assert.match(html, /物流、目录、售后、报价、折扣、付款、交期和合同均不会自动发送/);
});

test('handoff panel retains keyword, miss-streak and L4 safety controls', () => {
  const html = renderToStaticMarkup(<EnterpriseHandoffSafetySection
    handoffRules={{ keywords: ['人工', 'refund'], missStreakToDraft: 2, negativeSentiment: true }}
    handoffKeywordInput=""
    setHandoffKeywordInput={noOp}
    addHandoffKeyword={noOp}
    removeHandoffKeyword={noOp}
    setMissStreakToDraft={noOp}
    setNegativeSentiment={noOp}
  />);
  assert.match(html, /人工 ×/);
  assert.match(html, /refund ×/);
  assert.match(html, /连续未命中阈值/);
  assert.match(html, /负面情绪转人工/);
  assert.match(html, /L4 动作永不自动发送，不可配置放开/);
});

test('parent retains the automatic-reply guard and handoff persistence', () => {
  const page = readFileSync(new URL('../EnterprisePage.tsx', import.meta.url), 'utf8');
  assert.match(page, /if \(value === 'auto' && !canAutoReply\)[\s\S]*?window\.alert/);
  assert.match(page, /if \(value === 'auto' && profile\.strategy\?\.aiAutonomy !== 'auto'\)[\s\S]*?window\.confirm/);
  assert.match(page, /if \(!ok\) return;[\s\S]*?aiAutonomy: value/);
  assert.match(page, /keywords = Array\.from\(new Set\(\[\.\.\.current\.keywords, keyword\]\)\)\.slice\(0, 20\)/);
  assert.match(page, /<EnterpriseAiAutonomySection[\s\S]*?canAutoReply=\{canAutoReply\}/);
  assert.match(page, /<EnterpriseHandoffSafetySection[\s\S]*?handoffRules=\{profile\.handoffRules \?\? DEFAULT\.handoffRules!\}/);
});
