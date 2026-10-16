import assert from 'node:assert/strict';
import test from 'node:test';
import { weeklyAuthorizationRecoveryDecision } from './weeklyAuthorizationRecovery.js';

const approvedAt = '2026-10-13T13:10:49.529Z';
const invalidatedAt = '2026-10-14T01:14:26.384Z';
const base = {
  goalId: 'goal', planId: 'plan', runId: 'run', approvedAt, approvedBy: '', invalidatedAt,
  audits: [{ action: 'weekly_goal.approved', actorUserId: 'owner', targetType: 'weekly_goal', targetId: 'goal', createdAt: '2026-10-13T13:10:49.616Z', metadata: { planId: 'plan', runId: 'run' } }],
  events: [{ type: 'authorization_required', occurred_at: invalidatedAt, payload: { reason: 'package_adjusted', changedFields: ['taskExecution'] } }],
};

test('restores the exact approval actor when every invalidation was an execution-only retry', () => {
  assert.deepEqual(weeklyAuthorizationRecoveryDecision(base), {
    restore: true, actorUserId: 'owner', approvedAt, invalidatedAt,
  });
});

test('never restores across a real weekly package boundary change', () => {
  const result = weeklyAuthorizationRecoveryDecision({
    ...base,
    audits: [...base.audits, { action: 'weekly_package.updated', actorUserId: 'owner', targetType: 'weekly_plan', targetId: 'plan', createdAt: '2026-10-13T14:00:00.000Z', metadata: { runId: 'run' } }],
  });
  assert.deepEqual(result, { restore: false, reason: 'business_boundary_changed' });
});

test('never restores a mixed or untraceable invalidation history', () => {
  assert.deepEqual(weeklyAuthorizationRecoveryDecision({
    ...base,
    events: [...base.events, { type: 'authorization_required', occurred_at: '2026-10-13T15:00:00.000Z', payload: { reason: 'package_adjusted', changedFields: ['directorDecision'] } }],
  }), { restore: false, reason: 'invalidation_changed_business_boundary' });
  assert.deepEqual(weeklyAuthorizationRecoveryDecision({ ...base, audits: [] }), { restore: false, reason: 'approval_audit_not_unique' });
});

test('does nothing when a current authorization already exists', () => {
  assert.deepEqual(weeklyAuthorizationRecoveryDecision({ ...base, approvedBy: 'owner' }), { restore: false, reason: 'authorization_present' });
});
