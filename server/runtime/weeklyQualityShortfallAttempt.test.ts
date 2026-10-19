import test from 'node:test';
import assert from 'node:assert/strict';
import { proposeWeeklyQualityShortfallAttempt } from './weeklyQualityShortfallAttempt.js';

const seed = () => ({
  tenantId: 'tenant', programId: 'program', packageId: 'package', packageVersion: 5,
  consumerTaskId: 'task', rootJobId: 'root', rootJobHash: 'root-hash',
  parentRunId: 'run', parentRunHash: 'run-hash', parentFinishedAt: '2026-10-18T02:00:00Z',
  scopeId: 'scope', scopeVersion: 2, scopeHash: 'scope-hash',
  currentWeekValid: true, currentScopeApproved: true, priorAttemptIds: ['prior'],
  plan: { code: 'weekly_qualified_continuation_ready', ready: true,
    source: { mode: 'momentum', platform: 'facebook', queryRef: 'foam factory', limit: 1 },
    notBefore: '2026-10-18T02:01:00Z', authorizesExecution: false as const, grantsAdditionalDailyQuota: false as const },
  capacity: { businessDate: '2026-10-18', remainingCount: 1, kind: 'normal_daily_window' as const, grantId: null },
  now: '2026-10-18T02:01:00Z',
});

test('quality shortfall proposal is immutable identity evidence, not execution or extra quota', () => {
  const input = seed(), first = proposeWeeklyQualityShortfallAttempt(input);
  assert.deepEqual(proposeWeeklyQualityShortfallAttempt(structuredClone(input)), first);
  assert.equal(first.authorizesExecution, false);
  assert.equal(first.grantsAdditionalDailyQuota, false);
  assert.equal(first.businessDate, '2026-10-18');
  assert.notEqual(proposeWeeklyQualityShortfallAttempt({ ...input, parentRunHash: 'new-parent-hash' }).attemptId, first.attemptId);
});

test('quality shortfall cannot reuse exhausted explicit grant or zero normal quota', () => {
  const input = seed();
  assert.throws(() => proposeWeeklyQualityShortfallAttempt({ ...input,
    capacity: { ...input.capacity, remainingCount: 10, kind: 'explicit_grant', grantId: 'old-grant' } }), /normal_quota_required/);
  assert.throws(() => proposeWeeklyQualityShortfallAttempt({ ...input,
    capacity: { ...input.capacity, remainingCount: 0 } }), /normal_quota_required/);
  assert.throws(() => proposeWeeklyQualityShortfallAttempt({ ...input,
    plan: { ...input.plan, source: { ...input.plan.source, limit: 2 } } }), /plan_invalid/);
});

test('quality shortfall is current-week, approved-scope and same-business-day only', () => {
  const input = seed();
  assert.throws(() => proposeWeeklyQualityShortfallAttempt({ ...input, currentWeekValid: false }), /scope_invalid/);
  assert.throws(() => proposeWeeklyQualityShortfallAttempt({ ...input, currentScopeApproved: false }), /scope_invalid/);
  assert.throws(() => proposeWeeklyQualityShortfallAttempt({ ...input, now: '2026-10-18T16:01:00Z',
    capacity: { ...input.capacity, businessDate: '2026-10-19' } }), /same_day_required/);
  assert.throws(() => proposeWeeklyQualityShortfallAttempt({ ...input, now: '2026-10-18T02:00:59Z' }), /plan_invalid/);
  assert.throws(() => proposeWeeklyQualityShortfallAttempt({ ...input,
    plan: { ...input.plan, ready: false, code: 'weekly_qualified_post_admission_pending' } }), /plan_invalid/);
});
