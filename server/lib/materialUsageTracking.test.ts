import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSocialMaterialUsageManifest,
  buildStudioMaterialUsageManifest,
  materialUsageSummariesFromProjects,
} from './materialUsageTracking.js';

test('completed Studio artifact records actual assignments and isolates the first-three-second hook', () => {
  const manifest = buildStudioMaterialUsageManifest({
    projectId: 'project-1',
    projectTitle: '新品短视频',
    artifactId: 'render-1',
    usedAt: '2026-10-20T08:00:00.000Z',
    spec: {
      selected: ['draft-selection-must-not-count'],
      analysisResults: { storyboard: { slots: [
        { id: 'opening', start: 0, end: 3, function: 'hook' },
        { id: 'proof', start: 3, end: 8, function: '工厂检测证明' },
      ] } },
      storyboardAssignments: { opening: 'material-hook', proof: 'material-proof' },
      storyboardSourcePlans: { proof: { firstFrameMaterialId: 'material-reference' } },
    },
  });

  assert.ok(manifest);
  assert.equal(manifest.items.some(item => item.materialId === 'draft-selection-must-not-count'), false);
  assert.deepEqual(manifest.items.find(item => item.materialId === 'material-hook')?.roles, ['three_second_hook']);
  assert.deepEqual(manifest.items.find(item => item.materialId === 'material-proof')?.roles, ['body', 'proof']);
  assert.deepEqual(manifest.items.find(item => item.materialId === 'material-reference')?.roles, ['generation_reference']);
});

test('automatic social production decodes original material refs and tracks hook responsibility', () => {
  const encoded = Buffer.from('pb-owned-hook').toString('base64url');
  const manifest = buildSocialMaterialUsageManifest({
    projectId: 'project-social',
    projectTitle: '自动生产成片',
    artifactId: 'artifact-social',
    usedAt: '2026-10-20T09:00:00.000Z',
    platform: 'tiktok',
    assetSupplyExecution: { shots: [
      { sceneId: 'S01', function: 'hook', sourceRef: `socialmaterial:${encoded}` },
      { sceneId: 'S02', function: 'proof', sourceRef: 'factory-proof' },
    ] },
    scenes: [{ sceneId: 'S01' }, { sceneId: 'S02' }],
  });

  assert.ok(manifest);
  assert.equal(manifest.platform, 'tiktok');
  assert.deepEqual(manifest.items.find(item => item.materialId === 'pb-owned-hook')?.roles, ['three_second_hook']);
  assert.deepEqual(manifest.items.find(item => item.materialId === 'factory-proof')?.roles, ['body', 'proof']);
});

test('material summaries attach verified publish metrics once and keep per-content history', () => {
  const manifest = buildStudioMaterialUsageManifest({
    projectId: 'project-1',
    projectTitle: '新品短视频',
    artifactId: 'render-1',
    usedAt: '2026-10-20T08:00:00.000Z',
    spec: {
      analysisResults: { storyboard: { slots: [{ id: 'opening', start: 0, end: 2.5 }] } },
      storyboardAssignments: { opening: 'material-hook' },
    },
  });
  assert.ok(manifest);
  const summaries = materialUsageSummariesFromProjects({
    projects: [{ id: 'project-1', title: '新品短视频', spec: { materialUsageManifests: [manifest] } }],
    publishLinks: [{ id: 'publish-1', projectId: 'project-1', platform: 'tiktok', publishedAt: '2026-10-20T10:00:00.000Z', metrics: { views: 1_000, likes: 80, comments: 10, shares: 10, leads: 4 } }],
    knownMaterialIds: ['material-hook'],
  });
  const summary = summaries.get('material-hook');

  assert.ok(summary);
  assert.equal(summary.totalUses, 1);
  assert.equal(summary.hookUses, 1);
  assert.equal(summary.publishedUses, 1);
  assert.equal(summary.metrics.views, 1_000);
  assert.equal(summary.metrics.engagementRate, 10);
  assert.equal(summary.history[0]?.metricsStatus, 'synced');
});
