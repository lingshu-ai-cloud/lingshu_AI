import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createExternalReplyAdapter } from './externalReply.js';
import type { DataStore, Record_ } from '../storage/datastore.js';
const row: Record_ = { id: 'task-a', tenant_id: 'tenant-a', task_version: 4, status: 'blocked', output: { checkpoint: 'render', preservedScenes: ['scene-1'] } };
const dataStore = { getById: async () => row } as unknown as DataStore;
const base = { tenantId: 'tenant-a', userId: 'user-a', targetId: 'task-a', expectedVersion: '4', idempotencyKey: 'command-a', kind: 'dependency_retry' as const, payload: { mode: 'failed_step' } };
test('structured retry retains scope and version without instruction', async () => {
  let called: unknown;
  const adapter = createExternalReplyAdapter({ dataStore, retryTask: async input => { called = input; return { runId: 'run-a' }; } });
  const result = await adapter.execute(base);
  assert.equal(result.status, 'running');
  assert.deepEqual(called, { tenantId: 'tenant-a', userId: 'user-a', taskId: 'task-a', expectedTaskVersion: '4', rerunDownstream: false });
  const detail = await adapter.detail({ tenantId: 'tenant-a', targetId: 'task-a', type: 'resume' });
  assert.equal(detail.subjectVersion, '4');
  assert.equal(detail.resume?.checkpoint, 'render');
});
test('tenant, stale version and invalid scope reject before executor', async () => {
  let calls = 0;
  const adapter = createExternalReplyAdapter({ dataStore, retryTask: async () => { calls++; } });
  await assert.rejects(adapter.execute({ ...base, tenantId: 'tenant-b' }), /subject_not_found/);
  await assert.rejects(adapter.execute({ ...base, expectedVersion: '3' }), /version_conflict/);
  await assert.rejects(adapter.execute({ ...base, payload: { mode: 'all' } }), /retry_mode_invalid/);
  assert.equal(calls, 0);
});
test('running task does not offer or execute another retry', async () => {
  const adapter = createExternalReplyAdapter({ dataStore: { getById: async () => ({ ...row, status: 'running' }) } as unknown as DataStore });
  const detail = await adapter.detail({ tenantId: 'tenant-a', targetId: 'task-a', type: 'resume' });
  assert.equal(detail.actionOptions.every(option => !option.enabled), true);
  await assert.rejects(adapter.execute(base), /task_not_retryable/);
});
test('reply requires explicit human approval and reports accepted as unconfirmed', async () => {
  let calls = 0;
  const conversation = {
    getConversationDetail: async () => ({ conversation: { id: 'conv-a', tenant_id: 'tenant-a', updated_at: 'v2' }, drafts: [], messages: [], outbound: [] }),
    sendDraft: async () => { calls++; return { id: 'out-a', status: 'accepted_unconfirmed' }; },
  } as unknown as NonNullable<Parameters<typeof createExternalReplyAdapter>[0]>['conversation'];
  const adapter = createExternalReplyAdapter({ conversation });
  const input = { ...base, targetId: 'conv-a', expectedVersion: 'v2', kind: 'conversation_reply_send' as const, payload: { draftId: 'draft-a' } };
  await assert.rejects(adapter.execute(input), /human_approval_required/);
  assert.equal(calls, 0);
  const result = await adapter.execute({ ...input, payload: { ...input.payload, humanApproved: true } });
  assert.equal(result.deliveryConfirmed, false);
  assert.equal(result.status, 'accepted_unconfirmed');
});
