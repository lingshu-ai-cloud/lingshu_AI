import assert from 'node:assert/strict';
import test from 'node:test';
import { copyFile } from 'node:fs/promises';
import path from 'node:path';
import { outputFixture } from './output-status.fixture.js';
import { createStarter198Repository } from '../../server/starter198/repository.js';
import { createSocialSceneReworkIntent } from '../../server/starter198/socialContentSceneRework.js';
import { socialRequestHash } from '../../server/starter198/socialContentValidation.js';
import { DurableContentExecutionWorker } from '../../server/contentExecution/durableQueue.js';
import { reworkFrozenRenderManifest } from '../../server/starter198/socialContentSceneReworkWorker.js';
import { recoverSocialSceneReworkCompletions } from '../../server/starter198/socialContentSceneReworkCompletionRecovery.js';

test('page-internal offset resumes a second actual OutputPort job and preserves both owned-file deliveries on repeat', async () => {
  const x = await outputFixture();
  const repository = createStarter198Repository(x.f.store);
  let worker: DurableContentExecutionWorker | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const secondRunId = 'rework-run-offset-second';
    await x.f.store.create('users', { id: 'second-owner', tenantId: 't', role: 'admin', active: true });
    const secondIntent = createSocialSceneReworkIntent(x.f.context.cache, 'second-owner', ['scene-cta'], secondRunId);
    const firstRun = x.f.tables.workflow_runs!.find(row => row.id === x.input.job.runId)!;
    const authorization = structuredClone((firstRun.starter_context as any).sceneReworkAuthorization);
    const { recordHash: _oldHash, ...authorizationPayload } = authorization;
    const secondAuthorization = { ...authorizationPayload, actorUserId: 'second-owner', executionRunId: secondRunId, operationId: secondIntent.operationId };
    await x.f.store.create('workflow_runs', { id: secondRunId, tenant_id: 't', status: 'running', starter_context: {
      sceneReworkAuthorization: { ...secondAuthorization, recordHash: socialRequestHash(secondAuthorization) },
    } });
    const second = await x.f.service.createIntent({ tenantId: 't', taskId: 'content', runId: 'run', parentArtifactId: 'artifact',
      actorUserId: 'second-owner', executionRunId: secondRunId, affectedSceneIds: ['scene-cta'], changeKind: 'visual_asset' });
    assert.notEqual(second.job.id, x.input.job.id);
    assert.notEqual(second.intent.operationId, x.input.intent.operationId);
    const checkpoint = x.f.tables.starter_social_scene_rework_intents!.find(row => row.operation_id === x.input.intent.operationId)!.execution as any;
    const { hash: _checkpointHash, ...checkpointPayload } = checkpoint;
    const secondCheckpoint = { ...checkpointPayload, operationId: second.intent.operationId };
    const secondRow = x.f.tables.starter_social_scene_rework_intents!.find(row => row.operation_id === second.intent.operationId)!;
    await x.f.store.update('starter_social_scene_rework_intents', secondRow.id, { execution: { ...secondCheckpoint, hash: socialRequestHash(secondCheckpoint) } });
    Object.assign(x.f.tables.content_execution_jobs!.find(row => row.id === x.input.job.id)!, { status: 'queued', worker_id: '', lease_expires_at: '' });
    x.f.tables.durable_operation_leases = x.f.tables.durable_operation_leases!.filter(row => row.id !== 'live');
    let executions = 0, completedCallbacks = 0;
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const settled = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
    worker = new DurableContentExecutionWorker({ dataStore: x.f.store, dataAuthority: 'local', execute: async job => {
      executions++;
      const intent = job.id === second.job.id ? second.intent : x.input.intent;
      const manifest = reworkFrozenRenderManifest(x.f.context.cache.renderInput.manifest, intent, x.input.supply,
        x.f.context.baseline.scenes.map(scene => scene.sceneId));
      const output = await x.port({ ...x.input, job, intent, manifest });
      const file = x.f.tables.starter_social_content_files!.find(row => `socialfile:${row.file_id}` === output.fileRef)!;
      const ownedPath = path.join(path.dirname(x.f.local), `${output.sha256}.mp4`);
      await copyFile(x.input.outputPath, ownedPath);
      Object.assign(file, { storage_kind: 'local', storage_key: path.relative(path.resolve('data/social-content-sources'), ownedPath) });
      const run = await x.f.store.getById('workflow_runs', job.runId);
      const receipt = { operationId: intent.operationId, jobId: job.id, executionRunId: job.runId, ...output };
      await x.f.store.update('workflow_runs', job.runId, { starter_context: { ...run!.starter_context as object,
        sceneReworkOutput: { ...receipt, recordHash: socialRequestHash(receipt) } } });
    }, onSucceeded: async () => { if (++completedCallbacks === 2) resolve(); },
    onBlocked: async (_job, error) => { reject(error); }, onRetry: async (_job, error) => { reject(error); } });
    await worker.drain();
    await Promise.race([settled, new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(Error('two_actual_output_jobs_timeout')), 10000); })]);
    clearTimeout(timeout); worker.stop();
    assert.equal(executions, 2);
    const jobs = x.f.tables.content_execution_jobs!.filter(row => row.status === 'succeeded').sort((a, b) => a.id.localeCompare(b.id));
    assert.equal(jobs.length, 2);
    const deliveries = jobs.map(job => ({ job, run: x.f.tables.workflow_runs!.find(row => row.id === job.run_id)! }));
    for (const { job, run } of deliveries) {
      assert.ok(job.completed_at); assert.equal(run.status, 'running');
      const output = (run.starter_context as any).sceneReworkOutput;
      assert.equal(output.jobId, job.id); assert.ok(output.artifactId); assert.ok(output.fileRef);
    }
    assert.notEqual((deliveries[0]!.run.starter_context as any).sceneReworkOutput.artifactId,
      (deliveries[1]!.run.starter_context as any).sceneReworkOutput.artifactId);
    const before = JSON.stringify(x.f.tables.starter_social_content_artifacts);
    const first = await recoverSocialSceneReworkCompletions({ repository, dataAuthority: 'local', maxRows: 1, pageSize: 10 });
    assert.equal(first.recovered, 1); assert.equal(first.failed, 0);
    assert.deepEqual(first.nextCursor, { page: 1, offset: 1 });
    assert.equal(deliveries[0]!.run.status, 'completed'); assert.equal(deliveries[1]!.run.status, 'running');
    const next = await recoverSocialSceneReworkCompletions({ repository, dataAuthority: 'local', maxRows: 1, pageSize: 10, cursor: first.nextCursor! });
    assert.equal(next.recovered, 1); assert.equal(next.failed, 0); assert.equal(next.nextCursor, null);
    assert.equal(deliveries[1]!.run.status, 'completed');
    const timestamps = deliveries.map(item => item.run.completed_at);
    const again = await recoverSocialSceneReworkCompletions({ repository, dataAuthority: 'local', pageSize: 10 });
    assert.equal(again.recovered, 0); assert.equal(again.skipped, 2); assert.equal(again.failed, 0);
    assert.deepEqual(deliveries.map(item => item.run.completed_at), timestamps);
    assert.equal(JSON.stringify(x.f.tables.starter_social_content_artifacts), before);
    assert.equal(executions, 2, 'completion recovery never produces again');
  } finally {
    if (timeout) clearTimeout(timeout);
    worker?.stop();
    await x.f.cleanup();
  }
});
