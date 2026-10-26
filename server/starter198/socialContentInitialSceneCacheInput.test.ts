import assert from 'node:assert/strict';
import test from 'node:test';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { sceneReworkHandoff } from './socialContentSceneRework.fixture.js';
import { buildInitialSocialSceneCacheInput } from './socialContentInitialSceneCacheInput.js';
import { prepared } from './socialContentSceneReworkService.fixture.js';
import { initialSceneCacheInputFingerprint, initialSceneSourceHashes, persistInitialSocialSceneCache } from './socialContentInitialSceneCache.js';
import { socialRequestHash } from './socialContentValidation.js';

function input(kind: 'reference' | 'original') {
  const reference = sceneReworkHandoff('cache-input-task');
  assert.equal(reference.schemaVersion, 'social-content-production-handoff.v3');
  if (reference.schemaVersion !== 'social-content-production-handoff.v3') throw Error('reference_fixture_required');
  const referenceAnalysis = {
    analysisId: reference.sourceAnalysis.analysisId, version: reference.sourceAnalysis.version,
    referenceSourceId: reference.sourceAnalysis.referenceSourceId, status: 'ready', durationSeconds: 6,
    coverage: { ...reference.directorBrief.referenceAnalysis!, fullTimelineCovered: true },
    shots: reference.shotTraces.map(trace => ({ shotId: trace.sourceAnalysisRef!.referenceShotId,
      startSeconds: trace.sourceAnalysisRef!.startSeconds, endSeconds: trace.sourceAnalysisRef!.endSeconds })),
  } as any;
  const directorBrief = structuredClone(reference.directorBrief);
  if (kind === 'original') {
    directorBrief.referenceAnalysis = null;
    directorBrief.referenceMode = null;
    directorBrief.replicationJobRef = null;
    directorBrief.referenceEvidence = [];
    for (const scene of directorBrief.scenes) scene.referenceShotId = null;
  }
  const workflow = {
    schemaVersion: 'social-content-agent-workflow.v2', stage: 'production_ready',
    contentPlanId: 'content-plan', videoTaskId: 'cache-input-task', weeklyPackage: {},
    adHocBusinessContext: null, discoveryBrief: null, inspirationHandoffs: [],
    directorBrief, executionPlan: structuredClone(reference.executionPlan),
    executionPlanReview: structuredClone(reference.executionPlanReview), productionResult: null,
  } as any;
  const scenes = directorBrief.scenes.map(scene => ({ sceneId: scene.sceneId }));
  return {
    tenantId: 'tenant', taskId: 'cache-input-task', runId: 'run', productionResultId: 'result', workflow,
    referenceAnalysis: kind === 'reference' ? referenceAnalysis : null,
    plan: { planVersion: '3', shots: scenes.map(scene => ({ shotId: scene.sceneId })) } as any,
    baseline: { version: '3', scenes } as any,
    execution: { shots: scenes.map(scene => ({ sceneId: scene.sceneId, assetId: `asset-${scene.sceneId}` })) } as any,
    assets: [], contentHandoff: { scenes } as any, manifest: { timeline: scenes }, voicePath: '/voice.wav',
    bgmUrl: null, report: { schemaVersion: 'initial-scene-quality.v1' } as any,
    coverSha256: 'cover', renderSha256: 'render', captionCues: [], adaptedScript: 'copy', timeline: scenes,
  };
}

test('original production builds the existing cache input with explicit authored source lineage', () => {
  const cache = buildInitialSocialSceneCacheInput(input('original'));
  assert.equal(cache.handoff.schemaVersion, 'social-content-production-handoff.v4');
  assert.equal(cache.handoff.sourceAnalysis, null);
  assert.equal(cache.handoff.sourceContract.kind, 'original_scene');
  assert.ok(cache.handoff.shotTraces.every(trace => trace.sourceAnalysisRef === null));
  assert.deepEqual(cache.productionSceneIds, cache.baseline.scenes.map(scene => scene.sceneId));
});

test('reference production keeps the existing v3 handoff and scene mapping', () => {
  const cache = buildInitialSocialSceneCacheInput(input('reference'));
  assert.equal(cache.handoff.schemaVersion, 'social-content-production-handoff.v3');
  assert.ok(cache.handoff.sourceAnalysis);
  assert.ok(cache.handoff.shotTraces.every(trace => trace.sourceAnalysisRef));
});

test('cache input refuses a final scene missing from the approved execution plan', () => {
  const value = input('original');
  value.contentHandoff.scenes.push({ sceneId: 'unapproved-scene' });
  assert.throws(() => buildInitialSocialSceneCacheInput(value), /scene_cache_execution_scene_missing:unapproved-scene/);
});

test('original production persists and reads back through the existing scene rework cache', async () => {
  const f = await prepared();
  const handoff = f.handoff;
  const directorBrief = structuredClone(handoff.directorBrief);
  directorBrief.referenceAnalysis = null;
  directorBrief.referenceMode = null;
  directorBrief.replicationJobRef = null;
  directorBrief.referenceEvidence = [];
  for (const scene of directorBrief.scenes) scene.referenceShotId = null;
  const workflow = { schemaVersion: 'social-content-agent-workflow.v2', stage: 'production_ready',
    contentPlanId: 'plan', videoTaskId: 'content', weeklyPackage: {}, adHocBusinessContext: null,
    discoveryBrief: null, inspirationHandoffs: [], directorBrief,
    executionPlan: handoff.executionPlan, executionPlanReview: handoff.executionPlanReview, productionResult: null } as any;
  const artifact = f.tables.starter_social_content_artifacts![0]!;
  const content = artifact.content as Record<string, any>;
  const report = { schemaVersion: 'initial-scene-quality.v1', visual: { passed: true, failures: [] },
    scenes: { passed: true, issues: [], checkedScenes: f.context.baseline.scenes.length }, audio: { ok: true, error: null } } as any;
  const sourceManifest = f.context.cache.renderInput.sourceManifest;
  const cacheInput = buildInitialSocialSceneCacheInput({ tenantId: 't', taskId: 'content', runId: 'run',
    productionResultId: f.result.productionResultId, workflow, referenceAnalysis: null,
    plan: f.context.plan, baseline: f.context.baseline, execution: content.assetSupplyExecution,
    assets: [f.context.cache.scenes[0]!.result.asset],
    contentHandoff: { scenes: f.context.baseline.scenes.map(scene => ({ sceneId: scene.sceneId })) } as any,
    manifest: sourceManifest, voicePath: f.local, bgmUrl: null, report,
    coverSha256: 'cover', renderSha256: 'render', captionCues: [], adaptedScript: 'copy',
    timeline: f.context.baseline.scenes.map(scene => ({ sceneId: scene.sceneId })) });
  content.technicalQualityReport = report;
  content.initialSceneSourceHashes = await initialSceneSourceHashes(cacheInput);
  content.initialSceneCacheInput = initialSceneCacheInputFingerprint(cacheInput);
  artifact.content_hash = socialRequestHash({ resourceRef: artifact.resource_ref, content });
  f.tables.starter_social_production_handoffs = [];
  f.tables.starter_social_production_receipts = [];
  try {
    const saved = await persistInitialSocialSceneCache({ ...cacheInput, repository: f.repository, artifactId: 'artifact' });
    const read = await f.service.readCache({ tenantId: 't', taskId: 'content', runId: 'run', parentArtifactId: 'artifact' });
    assert.equal(saved.cache.recordHash, read.cache.recordHash);
    assert.equal(read.cache.scenes.length, f.context.baseline.scenes.length);
    assert.equal(cacheInput.handoff.schemaVersion, 'social-content-production-handoff.v4');
  } finally {
    await rm(path.resolve('data/social-content-scene-cache', socialRequestHash(['t', 'content', 'run', 'artifact'])), { recursive: true, force: true });
    await f.cleanup();
  }
});
