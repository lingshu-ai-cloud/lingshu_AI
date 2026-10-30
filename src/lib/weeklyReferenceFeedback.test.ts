import assert from 'node:assert/strict';
import test from 'node:test';
import type { SocialInspirationCollectionRun } from '../../shared/contracts/socialContentWorkflow';
import type { DigitalEmployeeOverview } from './digitalEmployees';
import { weeklyPlanExecutionLabel, weeklyReferenceCollectionFeedback } from './weeklyReferenceFeedback';
const run = (status: SocialInspirationCollectionRun['status'], extra: Partial<SocialInspirationCollectionRun> = {}) => ({ status, error: null, failureDetails: [], ...extra } as SocialInspirationCollectionRun);

test('failed source receipts never become successful collection feedback', () => {
  const message = weeklyReferenceCollectionFeedback({ run: run('failed', { error: 'TikTok crawl failed: isolated_test_network_blocked', stopReason: 'daily_collection_limit_reached' }) });
  assert.match(message, /采集失败.*网络隔离/);
  assert.doesNotMatch(message, /已发起采集|已完成|达到当日/);
  assert.match(weeklyReferenceCollectionFeedback({ run: run('failed') }), /采集失败/);
});
test('in-progress, unknown, skipped, partial and terminal collection outcomes stay distinct', () => {
  for (const status of ['queued', 'running'] as const) assert.match(weeklyReferenceCollectionFeedback({ run: run(status) }), /仍在处理中/);
  assert.match(weeklyReferenceCollectionFeedback({}), /结果无法确认.*不要重复提交/);
  assert.match(weeklyReferenceCollectionFeedback({ skipped: true }), /未启动/);
  assert.match(weeklyReferenceCollectionFeedback({ run: run('partial') }), /部分完成.*仍需完成分析/);
  assert.match(weeklyReferenceCollectionFeedback({ run: run('succeeded') }), /采集已完成.*重新核验/);
  assert.match(weeklyReferenceCollectionFeedback({ run: run('stopped') }), /没有取得合格参考/);
});
test('persisted old waiting runs are not described as currently producing', () => {
  const base = { goal: { id: 'g', status: 'active' }, plan: { id: 'p' }, run: { id: 'r', status: 'waiting_external' }, tasks: [] } as unknown as DigitalEmployeeOverview;
  assert.equal(weeklyPlanExecutionLabel(base), '周计划等待执行');
  assert.equal(weeklyPlanExecutionLabel({ ...base, tasks: [{ run_id: 'r', status: 'blocked' }] } as DigitalEmployeeOverview), '周计划需要处理');
  assert.equal(weeklyPlanExecutionLabel({ ...base, tasks: [{ run_id: 'r', kind: 'production', status: 'running' }] } as DigitalEmployeeOverview), '周计划正在生产');
  assert.equal(weeklyPlanExecutionLabel({ ...base, run: { ...base.run!, status: 'succeeded' } }), '周计划已完成');
});

test('missing, unconfirmed and confirmed plans have distinct global labels', () => {
  const base = { goal: null, run: null, tasks: [] } as unknown as DigitalEmployeeOverview;
  assert.equal(weeklyPlanExecutionLabel(null), '周计划状态待确认');
  assert.equal(weeklyPlanExecutionLabel(base), '周计划待生成');
  assert.equal(weeklyPlanExecutionLabel({ ...base, goal: { status: 'draft' } } as DigitalEmployeeOverview), '周计划待确认');
  assert.equal(weeklyPlanExecutionLabel({ ...base, goal: { status: 'approved' } } as DigitalEmployeeOverview), '周计划待启动');
});
