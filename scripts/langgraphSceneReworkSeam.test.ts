import test from 'node:test';
import assert from 'node:assert/strict';
import { outputFixture } from '../server/starter198/socialContentSceneReworkCompletionRecovery.fixture.js';
import { createStarter198Repository } from '../server/starter198/repository.js';
import { loadSocialProductionGraphApproval } from '../server/starter198/socialContentProductionGraph.js';
import { socialRequestHash } from '../server/starter198/socialContentValidation.js';

test('actual independent single-scene repair output cannot replace a paused graph review subject', async () => {
  const x = await outputFixture();
  try {
    const parent = x.f.tables.starter_social_content_artifacts![0]!;
    const expected = { artifactId: parent.artifact_id, contentHash: socialRequestHash(parent.content), version: parent.version, runId: 'run', waitingReview: true };
    const unchanged = x.input.supply.execution.shots.find(shot => shot.sceneId === 'scene-hook');
    const changed = x.input.supply.execution.shots.find(shot => shot.sceneId === 'scene-cta');
    assert.ok(unchanged); assert.ok(changed);
    assert.equal(changed.assetId, 'replacement');
    assert.equal(unchanged.assetId, x.f.context.cache.scenes[0]!.result.asset.id);
    const output = await x.port(x.input);
    assert.equal(output.parentArtifactId, String(parent.artifact_id));
    assert.equal(output.reviewStatus, 'review_required');
    const child = x.f.tables.starter_social_content_artifacts!.find(row => row.artifact_id === output.artifactId)!;
    assert.ok(child); assert.notEqual(child.artifact_id, parent.artifact_id);
    const graphJob = { tenantId: 't', taskId: 'content', runId: 'run', checkpoints: { 'social.graph_review': { version: '1', inputHash: 'frozen', payload: expected } } } as any;
    // Even an approved replacement has an independent execution run, and cannot
    // grant the old subject authority. No simulated approval is used as a success proof.
    const originalStatus = child.status; child.status = 'approved';
    parent.status = 'superseded';
    await assert.rejects(loadSocialProductionGraphApproval(createStarter198Repository(x.f.store), graphJob), /artifact_not_unique|subject_changed/);
    child.status = originalStatus;
    assert.equal(x.f.tables.starter_social_content_artifacts!.length, 2);
  } finally { await x.f.cleanup(); }
});
