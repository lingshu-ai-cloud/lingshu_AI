import assert from 'node:assert/strict';
import test from 'node:test';
import { prepared } from './socialContentSceneReworkService.fixture.js';
import { createStarter198Repository } from './repository.js';
import { readSocialSceneReworkAvailability, readSocialSceneReworkStatus } from './socialContentSceneReworkRead.js';

test('availability exposes actual scene failures without local media locations or supplier payloads', async () => {
  const f = await prepared();
  try {
    await f.service.saveCache(f.context);
    const item = await readSocialSceneReworkAvailability({ repository: createStarter198Repository(f.store),
      tenantId: 't', taskId: 'content', parentArtifactId: 'artifact' });
    assert.equal(item.sourceRunId, 'run');
    assert.equal(item.productionWorkspaceBinding, null);
    assert.equal(item.productionWorkspaceGap, 'social_workspace_binding_missing');
    assert.deepEqual(item.scenes.map(scene => scene.status), ['passed', 'failed']);
    assert.equal(JSON.stringify(item).includes(f.local), false);
    assert.equal('renderInput' in item, false);
    assert.equal('plan' in item, false);
    await assert.rejects(readSocialSceneReworkAvailability({ repository: createStarter198Repository(f.store),
      tenantId: 'foreign', taskId: 'content', parentArtifactId: 'artifact' }));
  } finally { await f.cleanup(); }
});

test('finished repair remains readonly observable without supplier access; actor and authorization drift reject', async () => {
  const f = await prepared();
  try {
    await f.service.saveCache(f.context);
    const result = await f.service.createIntent({ tenantId: 't', taskId: 'content', runId: 'run', executionRunId: 'rework-run',
      parentArtifactId: 'artifact', actorUserId: 'owner', affectedSceneIds: ['scene-cta'], changeKind: 'visual_asset' });
    const run = f.tables.workflow_runs!.find(row => row.id === 'rework-run')!;
    run.status = 'succeeded';
    f.tables.content_execution_jobs![0]!.status = 'succeeded';
    const input = { repository: createStarter198Repository(f.store), tenantId: 't', taskId: 'content',
      actorUserId: 'owner', operationId: result.intent.operationId };
    const before = JSON.stringify(f.tables);
    const item = await readSocialSceneReworkStatus(input);
    assert.equal(item.jobStatus, 'succeeded');
    assert.equal(item.runStatus, 'succeeded');
    assert.equal(JSON.stringify(f.tables), before);
    await assert.rejects(readSocialSceneReworkStatus({ ...input, actorUserId: 'other' }), /intent_scope/);
    (run.starter_context as any).sceneReworkAuthorization.parentArtifactHash = 'forged';
    await assert.rejects(readSocialSceneReworkStatus(input), /authorization_invalid/);
  } finally { await f.cleanup(); }
});
