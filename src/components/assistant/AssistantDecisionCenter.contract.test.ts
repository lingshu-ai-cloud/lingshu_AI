import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./AssistantDecisionCenter.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('./assistantDecisionCenter.css', import.meta.url), 'utf8');

test('assistant is a one-card decision surface with chat only in the empty state', () => {
  assert.match(source, /feed\?\.items\[0\]/, 'only the first priority item is selected');
  assert.match(source, /!loading && !first && !error[\s\S]*问灵小枢/, 'chat is offered only after the decision queue is empty');
  assert.doesNotMatch(source, /AgentExecutionStatus|RunEvent|Timeline|执行记录|事件日志/, 'execution history must stay in the workbench');
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
