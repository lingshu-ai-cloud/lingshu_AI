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

test('summary variant is a real-feed bubble that delegates opening to the external detail modal', () => {
  assert.match(source, /AssistantDecisionCenterVariant = 'summary' \| 'detail'/);
  assert.match(source, /variant\?: AssistantDecisionCenterVariant/);
  assert.equal(source.match(/onOpenDetail\?: \(trigger\?: HTMLButtonElement \| null\) => void/g)?.length, 2, 'the shell callback and summary must both receive the trigger for focus restoration');
  assert.match(source, /if \(variant === 'summary'\)[\s\S]*if \(!first && !error\) return null/, 'an empty feed must not reserve summary space');
  assert.match(source, /card\.kind === 'plan_start' \|\| card\.kind === 'plan_adjustment'[\s\S]*请确认本周的内容计划/, 'weekly plan summaries use the requested plain-language title');
  assert.match(source, /<DecisionSummary card=\{first\} total=\{feed\?\.total \|\| 1\} onOpenDetail=\{onOpenDetail\}/, 'the real first feed card drives the summary bubble');
  const summarySource = source.slice(source.indexOf('function DecisionSummary'), source.indexOf('function DecisionCard'));
  assert.match(summarySource, /className="assistant-decision-summary"[\s\S]*onClick=\{event => onOpenDetail\?\.\(event\.currentTarget\)\}/, 'summary click delegates the trigger to the external dialog');
  assert.doesNotMatch(summarySource, /onAction|execute/, 'summary click only opens detail and never executes an action');
  assert.match(styles, /\.assistant-decision-summary[\s\S]*min-height: 44px/);
  assert.match(styles, /background: var\(--ls-action-gradient\)/, 'summary uses the shared blue-violet action gradient');
  assert.match(styles, /\.assistant-decision-summary:focus-visible[\s\S]*outline:/, 'summary bubble keeps a visible keyboard focus state');
});

test('decision content stays presentation-only and never owns the external modal', () => {
  assert.doesNotMatch(source, /\bModal\b|\bDrawer\b/, 'the global assistant shell must own the external decision dialog');
  assert.doesNotMatch(source, /setDecisionDialog|openDecisionDialog/, 'the decision content must only notify its caller through onOpenDetail');
});

test('deep-link navigation explicitly notifies the owning shell before dispatch', () => {
  assert.match(source, /onNavigate\?: \(link\?: AssistantDecisionDeepLink\) => void/, 'the owning shell needs an explicit navigation lifecycle callback');
  const actionSource = source.slice(source.indexOf('const act = useCallback'), source.indexOf("if (variant === 'summary')"));
  const navigationStart = actionSource.indexOf("if (action.mode === 'navigate' || next.outcome === 'navigation_required')");
  const navigationEnd = actionSource.indexOf('} else {', navigationStart);
  const navigationBranch = actionSource.slice(navigationStart, navigationEnd);
  assert.ok(navigationStart >= 0 && navigationBranch.indexOf('onNavigate?.(first.deepLink)') < navigationBranch.indexOf('dispatchDeepLink(first.deepLink)'), 'the shell closes before app navigation is dispatched');
  assert.match(actionSource.slice(navigationEnd, actionSource.indexOf('} catch', navigationEnd)), /requestAnimationFrame/, 'non-navigation completion restores focus inside the decision surface');
  assert.doesNotMatch(navigationBranch, /\.focus\(/, 'a closing navigation dialog must not steal focus back from the destination page');
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
  assert.match(source, /if \(!first \|\| actionPending\.current \|\| startReconciliation\) return/);
  assert.match(source, /requestSequence\.current \+= 1;[\s\S]{0,120}setLoading\(false\);[\s\S]{0,180}setFeed\(next\)/, 'a confirmed command invalidates an older feed request before applying its response');
  const antSelectorLines = styles.split('\n').filter(line => line.includes('.ant-'));
  assert.ok(antSelectorLines.length > 0 && antSelectorLines.every(line => line.includes('.ls-assistant-decision-dialog')), 'Ant internals may only be scoped below the owned external dialog class');
});

test('weekly start feedback is receipt-backed and refreshes every mounted decision surface', () => {
  assert.match(source, /action\.id === 'approve_and_start'[\s\S]{0,180}!next\.execution \|\| next\.execution\.goalId !== first\.subject\.id/, 'a start result must match the selected goal');
  assert.match(source, /assistantDecisionExecutionFeedback\(next\.execution\)[\s\S]{0,260}notifyWeeklyWorkUpdated\(\{ source: 'assistant'/, 'verified execution drives feedback and the shared refresh event');
  assert.match(source, /onActionResult\?\.\(\{ action, card: first, response: next \}\)/, 'the shell receives one result callback from the completed command');
  const refreshEffect = source.slice(source.indexOf('const refreshAfterWeeklyWorkChange'), source.indexOf("if (!active || variant !== 'summary')"));
  assert.match(refreshEffect, /void load\(\)/, 'page and assistant mutations refresh the authoritative pending feed');
  assert.match(source, /status === 'failed'[\s\S]{0,180}kind: 'error'/, 'a created but failed run is never shown as green success');
  assert.match(source, /status === 'cancelled'[\s\S]{0,180}kind: 'warning'/, 'a cancelled run remains distinct from success');
});

test('start uncertainty is reconciled without resubmitting the command', () => {
  assert.match(source, /decision_timeout'[\s\S]{0,120}'plan_start_unconfirmed'/, 'timeouts and missing receipts enter an explicit uncertain state');
  assert.match(source, /digitalEmployeeApi\.overview\(pending\.card\.subject\.id\)/, 'reconciliation is a read-only overview lookup for the same goal');
  assert.match(source, /reconciliationAttempts\.current >= 8[\s\S]{0,180}请勿重复提交/, 'reconciliation is bounded and gives a safe next step');
  assert.match(source, /window\.setInterval\(reconcileIfVisible, 15_000\)/, 'uncertain starts are checked at a restrained interval while visible');
  assert.match(source, /busyAction=\{busyAction \|\| \(\(loading \|\| startReconciliation\)/, 'an uncertain start keeps all decision actions disabled during reconciliation');
  const reconcileSource = source.slice(source.indexOf('const reconcileWeeklyStart'), source.indexOf('const act = useCallback'));
  assert.doesNotMatch(reconcileSource, /client\.execute|approveGoal|approve_and_start/, 'reconciliation never repeats the start mutation');
});

test('only stale conflicts are replaced by a silent feed refresh', () => {
  assert.match(source, /STALE_DECISION_CODES\.has\(reason\.code\)/, 'conflict handling must inspect the backend code');
  const actionSource = source.slice(source.indexOf('const act = useCallback'), source.indexOf("if (variant === 'summary')"));
  assert.match(actionSource, /setError\(visibleFailure\)[\s\S]*reason\.status === 409[\s\S]*load\(undefined, true\)/, 'a non-stale conflict keeps its real reason while refreshing the card');
});
