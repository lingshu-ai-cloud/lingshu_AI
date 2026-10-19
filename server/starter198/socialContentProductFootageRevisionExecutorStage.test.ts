import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LangGraphTestStore } from '../../scripts/langgraphTestStore.js';
import { admitContentExecutionJob, controlContentExecutionJob,
  stageBlockedFootageRevisionJob } from '../contentExecution/durableQueue.js';

test('frozen revision executor identity persists blocked across restart, replay and generic retry', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'footage-blocked-executor-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'store.json'), store = new LangGraphTestStore(file);
  await store.create('starter_social_content_tasks', { id: 'task-row', tenant_id: 'tenant',
    task_id: 'task', run_id: 'new-run', brief: { _productFootageRevision: { sourceRunId: 'old-run' } } });
  const checkpoint = { version: '1', inputHash: 'a'.repeat(64),
    payload: { executor: 'langgraph', inputHash: 'a'.repeat(64), planVersion: '9' },
    updatedAt: new Date().toISOString() };
  const input = { dataStore: store, tenantId: 'tenant', taskId: 'task', runId: 'new-run',
    userId: 'owner', taskType: 'social_content_weekly', assertAuthority: async () => {},
    checkpoints: { 'social.executor': checkpoint,
      'content.production_bridge': { version: '1', inputHash: checkpoint.inputHash,
        payload: { planVersion: '9', inputHash: checkpoint.inputHash }, updatedAt: checkpoint.updatedAt } } };
  await assert.rejects(stageBlockedFootageRevisionJob({ ...input,
    assertAuthority: async () => { throw Error('rights_revoked'); } }), /rights_revoked/);
  assert.equal((await store.list('content_execution_jobs', { where: { tenant_id: 'tenant' } })).totalItems, 0);
  const first = await stageBlockedFootageRevisionJob(input);
  assert.equal(first.status, 'blocked');
  assert.equal(first.providerReceipts.length, 0);
  const restarted = new LangGraphTestStore(file);
  const replay = await stageBlockedFootageRevisionJob({ ...input, dataStore: restarted,
    checkpoints: { ...input.checkpoints, 'social.executor': { ...checkpoint,
      updatedAt: new Date(Date.now() + 1000).toISOString() } } });
  assert.equal(replay.id, first.id);
  await assert.rejects(stageBlockedFootageRevisionJob({ ...input, dataStore: restarted,
    checkpoints: { ...input.checkpoints, 'social.executor': { ...checkpoint,
      inputHash: 'b'.repeat(64) } } }), /stage_conflict/);
  await assert.rejects(admitContentExecutionJob({ dataStore: restarted,
    tenantId: 'tenant', taskId: 'task', runId: 'new-run', userId: 'owner',
    taskType: 'social_content_weekly' }), /footage_revision_admission_required/);
  await assert.rejects(controlContentExecutionJob({ dataStore: restarted,
    tenantId: 'tenant', jobId: first.id, action: 'retry' }), /footage_revision_admission_required/);
  const rows = await restarted.list('content_execution_jobs', { where: { tenant_id: 'tenant' } });
  assert.equal(rows.totalItems, 1);
  assert.equal(rows.items[0]?.status, 'blocked');
});
