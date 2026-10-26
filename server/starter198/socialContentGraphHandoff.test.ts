import assert from 'node:assert/strict';
import test from 'node:test';
import { prepared } from './socialContentSceneReworkService.fixture.js';
import { sealSocialSceneMediaCache } from './socialContentSceneRework.js';
import { readSocialGraphHandoffEvidence } from './socialContentGraphHandoff.js';
import { socialRequestHash } from './socialContentValidation.js';

test('v4 handoff reads and binds the existing artifact, handoff and scene cache without creating records', async () => {
  const f = await prepared();
  try {
    const artifact = f.tables.starter_social_content_artifacts![0]!;
    const content = artifact.content as Record<string, unknown>;
    content.productionWorkspaceSource = { type:'actual_social_render', runId:'run', outputSha256:'a'.repeat(64) };
    artifact.content_hash = socialRequestHash({ resourceRef: artifact.resource_ref, content });
    const { recordHash: _old, ...cache } = f.context.cache;
    f.context.cache = sealSocialSceneMediaCache({ ...cache, parentArtifactHash:String(artifact.content_hash) });
    await f.service.saveCache(f.context);
    const before = Object.fromEntries(Object.entries(f.tables).map(([key, rows]) => [key, rows.length]));
    const evidence = await readSocialGraphHandoffEvidence({ repository:f.repository,
      job:{tenantId:'t',taskId:'content',runId:'run'}, artifact:artifact as any,
      approvalReceipt:'approval:1', graphInputHash:'b'.repeat(64) });
    assert.deepEqual(evidence.artifactRefs, ['artifact', f.handoff.handoffId]);
    assert.equal(evidence.metadata?.handoffHash, f.handoff.recordHash);
    assert.equal(evidence.metadata?.approvalReceipt, 'approval:1');
    assert.equal(evidence.metadata?.sceneCount, f.context.cache.scenes.length);
    assert.deepEqual(Object.fromEntries(Object.entries(f.tables).map(([key, rows]) => [key, rows.length])), before);
  } finally { await f.cleanup(); }
});

test('v4 handoff fails before cache lookup when artifact lineage changed', async () => {
  const f = await prepared();
  try {
    const artifact = f.tables.starter_social_content_artifacts![0]!;
    (artifact.content as Record<string, unknown>).productionWorkspaceSource = { runId:'other-run' };
    await assert.rejects(readSocialGraphHandoffEvidence({ repository:f.repository,
      job:{tenantId:'t',taskId:'content',runId:'run'}, artifact:artifact as any,
      approvalReceipt:'approval:1', graphInputHash:'b'.repeat(64) }), /graph_handoff_artifact_lineage_invalid/);
  } finally { await f.cleanup(); }
});
