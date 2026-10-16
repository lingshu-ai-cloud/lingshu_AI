import assert from 'node:assert/strict';
import test from 'node:test';
import {
  externalContentProjectRecoveryDue,
  isRecoverableExternalPublishingWait,
} from './runtimeOrchestrator.js';

test('publishing recovery only wakes an external connection preflight', () => {
  const task = (checks: Array<{ key: string; ready: boolean }>, dataStatus = 'preflight_blocked') => ({
    task_key: 'content_release_approval',
    status: 'waiting_human',
    output: { dataStatus, preflight: { checks } },
  });
  assert.equal(isRecoverableExternalPublishingWait(task([
    { key: 'publishing_oauth_configuration', ready: false },
  ])), true);
  assert.equal(isRecoverableExternalPublishingWait(task([
    { key: 'publishing_account_connections', ready: false },
  ])), true);
  assert.equal(isRecoverableExternalPublishingWait(task([
    { key: 'selected_publishing_accounts', ready: false },
  ])), false, 'a stale plan selection still needs an explicit plan correction');
  assert.equal(isRecoverableExternalPublishingWait(task([
    { key: 'publishable_outputs', ready: false },
  ])), false, 'missing content must not be mistaken for an OAuth recovery');
  assert.equal(isRecoverableExternalPublishingWait(task([
    { key: 'publishing_oauth_configuration', ready: false },
  ], 'autonomy_blocked')), false, 'policy waits never wake automatically');
});

test('provider-account recovery honors run lineage and retry backoff', () => {
  const now = new Date('2026-10-14T00:00:00.000Z');
  const taskIds = new Set(['production-task']);
  const project = (automation: Record<string, unknown>, overrides: Record<string, unknown> = {}) => ({
    status: 'draft',
    spec: {
      workflowRunId: 'run',
      workflowTaskId: 'production-task',
      automation: { stage: 'blocked', status: 'blocked', ...automation },
      ...overrides,
    },
  });
  assert.equal(externalContentProjectRecoveryDue(project({
    blocker: '账户欠费，请充值后重试',
    retryAfter: '2026-10-13T23:59:00.000Z',
  }), 'run', taskIds, now), true);
  assert.equal(externalContentProjectRecoveryDue(project({
    autoRecheckExternal: true,
    blocker: 'invalid api key',
    retryAfter: '2026-10-14T00:15:00.000Z',
  }), 'run', taskIds, now), false, 'retries stay bounded while the provider remains unavailable');
  assert.equal(externalContentProjectRecoveryDue(project({
    blocker: '视频画面质检未通过',
  }), 'run', taskIds, now), false, 'deterministic quality failures need an explicit repair');
  assert.equal(externalContentProjectRecoveryDue(project({
    blocker: '鉴权失败',
  }, { workflowRunId: 'another-run' }), 'run', taskIds, now), false, 'another run can never wake this workflow');
  assert.equal(externalContentProjectRecoveryDue({
    ...project({ blocker: '鉴权失败' }), status: 'completed',
  }, 'run', taskIds, now), false, 'completed production is never reopened');
});
