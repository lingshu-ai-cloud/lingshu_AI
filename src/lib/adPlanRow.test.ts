import assert from 'node:assert/strict';
import test from 'node:test';
import { planAdvice, planLiveEntries, planStatusText } from './adPlanRow';
import type { PlatformAdTask } from './platformAds';
import type { MetaPlanAuditEntry } from '../../shared/metaPlanAudit';
import type { PlanOperatingData } from '../components/useAdPlanOperatingData';
const task = { id: 'a', version: 3, status: 'active' } as PlatformAdTask;
const entry: MetaPlanAuditEntry = {
  executionId: 'e', connectionId: 'c', accountId: '1', accountName: 'A', currency: 'CNY', timezone: 'UTC',
  campaignId: '1', adsetId: '2', creativeId: '3', adId: '4', pageId: '5', videoId: '6', linkUrl: '',
  objective: '', optimizationGoal: '', destinationType: '', billingEvent: '', spendCap: 500, dailyBudget: 20,
  startsAt: '', endsAt: '', countries: ['CA'], platforms: ['facebook'], campaignStatus: 'PAUSED', adsetStatus: 'PAUSED',
  adStatus: 'PAUSED', adEffectiveStatus: 'PAUSED', issues: [], bindingId: '', sha256: '', mapping: 'unmapped', checks: [],
};
const data: PlanOperatingData = { errors: [], audit: { taskId: 'a', taskVersion: 3, checkedAt: '2026-10-25', pendingCount: 0, truncated: false, entries: [entry] } };
test('provider status wins over local status, and incomplete or stale readbacks never look current', () => {
  assert.equal(planStatusText(task, data), '已暂停');
  for (const patch of [{ taskId: 'b' }, { taskVersion: 2 }, { pendingCount: 1 }, { truncated: true }]) assert.equal(planLiveEntries(task, { ...data, audit: { ...data.audit!, ...patch } }).length, 0);
  assert.equal(planStatusText(task, { ...data, audit: { ...data.audit!, pendingCount: 1 } }), '执行结果待核对');
  assert.equal(planStatusText(task), '状态待回传');
});
test('several resources with different status stay separate', () => {
  assert.equal(planStatusText(task, { ...data, audit: { ...data.audit!, entries: [...data.audit!.entries, { ...data.audit!.entries[0], adEffectiveStatus: 'ACTIVE' }] } }), '多组投放状态');
});
test('AI suggestion uses saved decisions, and marks initial planning advice rather than implying live optimization', () => {
  const initial = { ...task, proposal: { rationale: '创建建议', generatedAt: '2026-10-01' } } as PlatformAdTask;
  assert.equal(planAdvice(initial, { errors: [], runs: [] }).detail, '创建时建议，非实时决策');
  assert.equal(planAdvice(task, { errors: ['AI 记录读取失败'] }).text, 'AI 建议读取失败');
  assert.equal(planAdvice(task, { errors: [], runs: [{ reason: '旧建议', createdAt: '2026-10-01' }, { reason: '新建议', createdAt: '2026-10-25', status: 'OBSERVING' }] }).text, '新建议');
});

import { metricQueryError, planMetricView } from './adPlanMetricState';
import type { PlanOperatingMetrics } from '../components/AdPlanManagement';
const report = { source: 'provider', currency: 'CNY', reportedAt: '2026-10-25', spend: null, impressions: null, clicks: null, results: null, costPerResult: null, metricLabel: '消息会话' } as PlanOperatingMetrics;
test('empty platform reports stay separate from a valid zero result', () => {
  assert.equal(planMetricView(task, { errors: [], metrics: report }).state, 'empty');
  const zero = planMetricView(task, { errors: [], metrics: { ...report, results: 0 } });
  assert.equal(zero.state, 'ready'); assert.equal(zero.title, '消息会话 0');
});
test('only verified unexecuted drafts show not launched; incomplete audits stay unknown', () => {
  const draft = { ...task, status: 'draft' } as PlatformAdTask;
  const d = { ...data, audit: { ...data.audit!, entries: [] }, metrics: { ...report, status: 'not_ready', source: 'none' } };
  assert.equal(planMetricView(draft, d).title, '尚未投放');
  for (const patch of [{ taskVersion: 2 }, { pendingCount: 1 }, { truncated: true }]) assert.equal(planMetricView(draft, { ...d, audit: { ...d.audit, ...patch } }).title, '尚无可核验报告');
});
test('query failure preserves last data semantics and maps actionable causes without declaring ad failure', () => {
  const failure = metricQueryError(Object.assign(new Error('provider rate limited'), { code: 'RATE_LIMIT', status: 503 }));
  assert.equal(failure.summary, '平台请求暂时受限'); assert.equal(failure.message, 'provider rate limited');
  assert.equal(planMetricView(task, { errors: [], metricsError: failure }).state, 'error');
  const cached = planMetricView(task, { errors: [], metrics: { ...report, results: 6 }, metricsError: failure });
  assert.equal(cached.title, '消息会话 6'); assert.equal(cached.stale, true); assert.match(cached.note, /上次数据/);
  assert.equal(metricQueryError(Object.assign(new Error('login'), { status: 401 })).summary, '登录状态需要更新');
  assert.equal(metricQueryError(new TypeError('Failed to fetch')).code, 'NETWORK_ERROR');
});
