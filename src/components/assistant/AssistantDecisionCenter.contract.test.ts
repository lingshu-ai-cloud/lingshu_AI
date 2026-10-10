import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./AssistantDecisionCenter.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('./assistantDecisionCenter.css', import.meta.url), 'utf8');

test('assistant is a one-card decision surface with chat only in the detail empty state', () => {
  assert.match(source, /feed\?\.items\[0\]/, 'only the first priority item is selected');
  assert.match(source, /!loading && !first && !error[\s\S]*问灵小枢/, 'chat is offered only after the decision queue is empty');
  assert.doesNotMatch(source, /AgentExecutionStatus|RunEvent|Timeline|执行记录|事件日志/, 'execution history must stay in the workbench');
});

test('summary variant is a real-feed bubble that opens the separate detail page', () => {
  assert.match(source, /AssistantDecisionCenterVariant = 'summary' \| 'detail'/);
  assert.match(source, /variant\?: AssistantDecisionCenterVariant/);
  assert.match(source, /onOpenDetail\?: \(\) => void/);
  assert.match(source, /if \(variant === 'summary'\)[\s\S]*if \(!first && !error\) return null/, 'an empty feed must not reserve summary space');
  assert.match(source, /card\.kind === 'plan_start' \|\| card\.kind === 'plan_adjustment'[\s\S]*请确认本周的内容计划/, 'weekly plan summaries use the requested plain-language title');
  assert.match(source, /<DecisionSummary card=\{first\} total=\{feed\?\.total \|\| 1\} onOpenDetail=\{onOpenDetail\}/, 'the real first feed card drives the summary bubble');
  assert.match(source, /className="assistant-decision-summary"[\s\S]*onClick=\{onOpenDetail\}/, 'summary click only opens detail and never executes an action');
  assert.match(styles, /\.assistant-decision-summary[\s\S]*min-height: 44px/);
  assert.match(styles, /background: var\(--ls-action-gradient\)/, 'summary uses the shared blue-violet action gradient');
  assert.match(styles, /\.assistant-decision-summary:focus-visible[\s\S]*outline:/, 'summary bubble keeps a visible keyboard focus state');
});

test('assistant uses shared Ant controls and the single branded primary action', () => {
  assert.match(source, /from 'antd'/);
  assert.match(source, /<LsBrandAction/);
  assert.match(source, /App\.useApp\(\)/, 'feedback must use the themed Ant context');
  assert.match(source, /<Popconfirm[\s\S]*确认退回修改/, 'reject keeps an accessible confirmation');
  assert.match(styles, /min-height: 44px/, 'touch actions meet the minimum target size');
  assert.match(styles, /prefers-reduced-motion: reduce/, 'system motion preference is respected');
});

test('required rejection notes stay visible and block incomplete decisions', () => {
  assert.match(source, /action\.requiresNote && !note\.trim\(\)/);
  assert.match(source, /退回修改时请填写具体原因/);
});

test('the shell can use the real backend feed for badges without inventing a count', () => {
  assert.match(source, /onFeedChange\?: \(feed: AssistantDecisionFeed\) => void/);
  assert.match(source, /if \(feed\) onFeedChange\?\.\(feed\)/);
  assert.doesNotMatch(source, /onFeedChange\?\.\(\{[^}]*total:/, 'loading never emits a fabricated queue');
});

test('refresh keeps the current card and late requests cannot replace newer state', () => {
  assert.match(source, /\{first \? \([\s\S]*<DecisionCard/);
  assert.match(source, /sequence !== requestSequence\.current/);
  assert.match(source, /actionController\.current\?\.abort\(\)/);
  assert.match(source, /if \(!first \|\| actionPending\.current\) return/);
  assert.doesNotMatch(styles, /\.ant-/, 'decision styling uses owned classes, not Ant internals');
});
