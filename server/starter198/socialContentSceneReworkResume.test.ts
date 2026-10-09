import test from 'node:test';
import assert from 'node:assert/strict';
import { prepared } from './socialContentSceneReworkService.fixture.js';
import { createStarter198Repository } from './repository.js';
import { resumeSocialSceneRework } from './socialContentSceneReworkResume.js';

async function fixture() {
  const f = await prepared();
  await f.service.saveCache(f.context);
  const result = await f.service.createIntent({ tenantId: 't', taskId: 'content', runId: 'run',
    executionRunId: 'rework-run', parentArtifactId: 'artifact', actorUserId: 'owner',
    affectedSceneIds: ['scene-cta'], changeKind: 'visual_asset' });
  const row = f.tables.content_execution_jobs![0]!;
  Object.assign(row, { status: 'blocked', provider_receipts: [{ provider: 'qwen_image', requestId: 'original-paid-request',
    state: 'unknown', providerTaskId: 'original-provider-task', metadata: {},
    firstRecordedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }] });
  return { ...f, row, input: { repository: createStarter198Repository(f.store), tenantId: 't', actorUserId: 'owner',
    taskId: 'content', operationId: result.intent.operationId, expectedJobId: result.job.id } };
}

test('explicit resume of unknown supplier outcome only reconciles the original job and retains its receipt', async () => {
  const f = await fixture();
  try {
    const before = JSON.stringify(f.row.provider_receipts);
    const item = await resumeSocialSceneRework(f.input);
    assert.equal(item.jobId, f.input.expectedJobId);
    assert.equal(item.executionRunId, 'rework-run');
    assert.equal(item.jobStatus, 'reconciling');
    assert.equal(JSON.stringify(f.row.provider_receipts), before);
    assert.equal(f.tables.content_execution_jobs!.length, 1);
    assert.equal(f.tables.starter_usage_ledger?.length ?? 0, 0);
    await assert.rejects(resumeSocialSceneRework(f.input), /not_resumable/);
  } finally { await f.cleanup(); }
});

test('foreign actor, wrong job and a live worker lease cannot resume or duplicate a repair', async () => {
  const f = await fixture();
  try {
    await assert.rejects(resumeSocialSceneRework({ ...f.input, actorUserId: 'other' }), /intent_scope/);
    await assert.rejects(resumeSocialSceneRework({ ...f.input, expectedJobId: 'different' }), /resume_scope/);
    f.tables.durable_operation_leases!.push({ id: 'actual-live', tenant_id: 't', lease_scope: 'content_execution_job',
      subject_id: f.input.expectedJobId, owner_id: 'actual-worker', lease_token: 'test-lease',
      expires_at: new Date(Date.now() + 60_000).toISOString() });
    await assert.rejects(resumeSocialSceneRework(f.input), /worker_lease_active/);
    assert.equal(f.row.status, 'blocked');
    assert.equal(f.tables.content_execution_jobs!.length, 1);
  } finally { await f.cleanup(); }
});
