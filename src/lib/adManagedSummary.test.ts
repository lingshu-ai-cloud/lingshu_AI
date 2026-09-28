import assert from 'node:assert/strict';
import { managedSummary, type ManagedSnapshot } from './adManagedSummary';
import type { PlatformAdTask } from './platformAds';
const tasks = [
  { managementMode: 'managed', authorization: { expiresAt: '2026-09-15T00:00:00Z' } },
  { managementMode: 'managed', authorization: { expiresAt: '2026-09-12T00:00:00Z' } },
  { managementMode: 'manual', authorization: { expiresAt: '2026-09-15T00:00:00Z' } },
  { managementMode: 'managed', authorization: null },
] as PlatformAdTask[];
const rows: ManagedSnapshot[] = [
  { approvals: [{ status: 'PENDING' }, { status: 'EXECUTED' }], executions: [{ status: 'VERIFIED' }, { status: 'UNKNOWN' }], runs: [{ status: 'FAILED' }], errors: [] },
  { approvals: [], executions: [], runs: [], errors: ['读取失败'] },
];
assert.deepEqual(managedSummary(tasks, rows, Date.parse('2026-09-14T00:00:00Z')), { authorized: 1, pending: 1, verified: 1, issues: 2 });
assert.deepEqual(managedSummary([], [], 0), { authorized: 0, pending: 0, verified: 0, issues: 0 });
assert.equal(managedSummary(tasks, [], Date.parse('2026-09-15T00:00:00Z')).authorized, 0);
console.log('Managed summary: expiry, permission/execution separation, pending status and partial failures passed');

// All fixtures are local evidence; these tests cannot invoke an advertising platform.
import { managedWorkerView, managedDecisionView, managedMetric } from './adManagedSummary';
import type { PlatformAdWorkerStatus } from '../../shared/platformAdAutomation';
const worker: PlatformAdWorkerStatus = { state: 'unknown', configuredEnabled: true, explanation: '无持久化心跳', lastStartedAt: null, lastCompletedAt: null, lastFailedAt: null, nextCheckAt: null };
assert.equal(managedWorkerView(null).state, 'unknown');
assert.equal(managedWorkerView(worker).title, '运行状态未知');
assert.equal(managedWorkerView({ ...worker, state: 'completed', configuredEnabled: false }).state, 'disabled');
assert.equal(managedWorkerView({ ...worker, state: 'stale' }).title, '运行证据已过期');
assert.equal(managedWorkerView({ ...worker, state: 'completed' }).title, '最近检查已完成');
assert.equal(managedDecisionView({ metrics: { clicks: 100, spend: 10 } }), null);
const decision = { schemaVersion: 1, ruleVersion: '2026-09-27T00:00:00Z', planVersion: 4, budgetBefore: 50, budgetAfter: 55, executionId: 'execution-1', evidence: { availability: 'available', period: 'last_7d', currency: 'USD', clicks: 100, spend: 25 } };
assert.equal(managedDecisionView({ decision })?.cpc, '0.25');
assert.equal(managedDecisionView({ decision })?.before, '50');
assert.equal(managedDecisionView({ decision })?.after, '55');
assert.equal(managedDecisionView({ decision: { ...decision, evidence: { ...decision.evidence, availability: 'unknown' } } })?.clicks, '未记录');
assert.equal(managedDecisionView({ decision: { ...decision, evidence: { ...decision.evidence, clicks: 0 } } })?.cpc, '样本不足或未记录');
assert.equal(managedMetric(null), '未记录');
assert.equal(managedMetric(Number.NaN), '未记录');
assert.equal(managedMetric(0), '0');
assert.equal(managedSummary([], [{ approvals: [], executions: [], runs: [{ status: 'EXTERNAL_CHANGE' }], errors: [] }]).issues, 1);
console.log('Managed evidence: persisted status, disabled/stale/unknown separation, legacy evidence and CPC samples passed');
